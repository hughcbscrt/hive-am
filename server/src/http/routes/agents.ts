import { createReadStream, realpathSync, statSync } from 'node:fs';
import { basename, extname, sep } from 'node:path';
import { agents, resolved } from '../../db.js';
import { inboxDir, saveUploads } from '../../connections/files.js';
import { uploadsBlock } from '../../connections/prompt.js';
import { readHistory } from '../../history/index.js';
import { liveTurn, notifyAgentsChanged, queueDepth, sendTurn, stopAgent } from '../../runtime.js';
import { sessionStats } from '../../stats.js';
import { summaryOf } from '../../sessions-summary.js';
import { emptyUsage } from '../../pricing.js';
import { agentOrFail, createAgent, removeAgent, resumeSession, sessionToRead, updateAgent } from '../../services/agents.js';
import { UPLOAD_LIMIT, body } from '../body.js';
import { HttpError, bad, notFound } from '../errors.js';
import { route } from '../router.js';
import { qpath, text, validateAgentInput } from '../validate.js';

route('GET', '/api/agents', () => agents.list().map((a) => ({ ...a, queued: queueDepth(a.id), live: !!liveTurn(a.id) })));
route('POST', '/api/agents', async ({ req }) => createAgent(validateAgentInput(await body(req))));
route('GET', '/api/agents/:id', ({ params }) => agentOrFail(params[0]));
route('PATCH', '/api/agents/:id', async ({ req, params }) => updateAgent(params[0], validateAgentInput(await body(req), true)));
route('DELETE', '/api/agents/:id', ({ params }) => { removeAgent(params[0]); return { ok: true }; });
route('POST', '/api/agents/:id/messages', async ({ req, params }) => {
  const a = agentOrFail(params[0]);
  const { prompt, files, images } = await body(req, UPLOAD_LIMIT);   // `images` is the name this field had at first
  let msg = text(prompt);
  const sent = files ?? images, hasFiles = Array.isArray(sent) && sent.length > 0;
  if (!msg.trim() && !hasFiles) throw bad('Message is empty');
  if (hasFiles) {
    try { const saved = saveUploads(a.id, sent); msg = `${msg.trim() || '(no text)'}${uploadsBlock(saved)}`; }
    catch (e) { throw bad(e instanceof Error ? e.message : 'The files could not be saved'); }
  }
  void sendTurn(a.id, msg).catch((e) => console.error('[turn]', e));
  return { accepted: true, prompt: msg };
});
// A file that was sent from the chat, for its thumbnail or download: only from this agent's inbox; pictures inline, anything else only as a download.
route('GET', '/api/agents/:id/inbox', ({ params, url, res }) => {
  const a = agentOrFail(params[0]);
  let root: string, abs: string;
  try { root = realpathSync(inboxDir(a.id)); abs = realpathSync(qpath(url)); } catch (e) { if (e instanceof HttpError) throw e; throw notFound('File not found'); }
  if (!abs.startsWith(root + sep) || !statSync(abs).isFile()) throw notFound('File not found');
  const image = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' } as Record<string, string>)[extname(abs).toLowerCase()];
  const shown = basename(abs).replace(/^(?:web-)?\d+-\d+-/, '');
  res.writeHead(200, {
    'content-type': image ?? 'application/octet-stream', 'content-length': statSync(abs).size, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff',
    'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
    ...(image ? {} : { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(shown)}` }),
  });
  createReadStream(abs).pipe(res);
});
route('POST', '/api/agents/:id/stop', ({ params }) => ({ stopped: stopAgent(params[0]) }));
route('POST', '/api/agents/:id/new-session', ({ params }) => {
  const a = agentOrFail(params[0]);
  stopAgent(a.id); agents.setSession(a, null); notifyAgentsChanged();
  return { ok: true };
});
route('POST', '/api/agents/:id/resume-session', async ({ req, params }) => {
  const a = agentOrFail(params[0]);
  resumeSession(a, (await body(req)).session_id);
  return { ok: true };
});
route('GET', '/api/agents/:id/history', ({ params, url }) => {
  const a = agentOrFail(params[0]);
  const sid = sessionToRead(a, url.searchParams.get('session'));
  // A long conversation is sent in pieces: `limit` keeps only the newest messages (the browser would freeze rendering thousands).
  const all = readHistory(resolved(a), sid), limit = Number(url.searchParams.get('limit'));
  return { session_id: sid, total: all.length, messages: limit > 0 && all.length > limit ? all.slice(-limit) : all };
});
route('GET', '/api/agents/:id/stats', ({ params, url }) => {
  const a = agentOrFail(params[0]);
  return sessionStats(readHistory(resolved(a), sessionToRead(a, url.searchParams.get('session'))));
});
route('GET', '/api/agents/:id/live', ({ params }) => liveTurn(params[0]));
route('GET', '/api/agents/:id/sessions', ({ params }) => agents.sessions(params[0]));

// ---- sessions across all managed agents ----
route('GET', '/api/sessions', () => {
  const byAgent = new Map(agents.list().map((a) => [a.id, a]));
  // Never reads a conversation here: sizes and costs come from a cache that fills in the background (`pending` rows are still being read).
  return agents.allSessions().map((s) => {
    const a = byAgent.get(s.agent_id)!;
    const { summary, fresh } = summaryOf({ provider: s.provider, cwd: s.cwd, session_id: s.session_id });
    return {
      ...s, current: a.session_id === s.session_id, pending: !fresh,
      message_count: summary?.message_count ?? 0, usage: summary?.usage ?? emptyUsage(), cost: summary?.cost ?? null,
      tool_calls: summary?.tool_calls ?? 0, model: summary?.model ?? null, preview: summary?.preview ?? '',
    };
  });
});
