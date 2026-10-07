import type { IncomingMessage, ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { agents, colonies, db, dispatches, resolved, skills, types } from './db.js';
import { ChannelError, channelReply, connectionStatus, startConnection, stopConnection, testConnection } from './connections/manager.js';
import { mergeConfig, publicConnection } from './connections/public.js';
import { channelPermissionError } from './connections/rules.js';
import { connections, threads } from './connections/store.js';
import { dispatch, liveTurn, notifyAgentsChanged, queueDepth, sendTurn, stopAgent } from './runtime.js';
import { readHistory } from './history/index.js';
import { listModels } from './models.js';
import type { Provider } from './types.js';
import { sessionStats } from './stats.js';
import { createReadStream } from 'node:fs';
import { findRepo, gitDiff, gitFile, gitImagePath, gitList, gitStatus, gitTree, isPathError } from './git.js';
import { listStashes, planSwitch, smartCancel, smartFinish, smartSwitch, stashApply, stashDetail, stashDrop, stashSave } from './gitswitch.js';
import { GitOpError, gitBlame, gitBranches, gitCommitDetail, gitCommitChanges, gitCommitDiff, gitDiscardAll, gitDiscardFile, gitDiscardHunk, gitDiscardLines, gitFetch, gitLog, gitMerge, gitMergeAbort, gitPull, gitPush, gitRebaseContinue, gitResolveContent, gitResolveSide, gitSwitch, gitUnresolve, type PullMode } from './gitops.js';

const exec = promisify(execFile);
const PROVIDERS: Record<Provider, { bin: string; label: string }> = {
  claude: { bin: 'claude', label: 'Claude Code' },
  opencode: { bin: 'opencode', label: 'OpenCode' },
  kiro: { bin: 'kiro-cli', label: 'Kiro' },
};

class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const bad = (m: string) => new HttpError(400, m);
const notFound = (m = 'Not found') => new HttpError(404, m);

async function body<T = any>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {} as T;
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw bad('Request body is not valid JSON'); }
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

let providerCache: { at: number; data: unknown } | null = null;
async function providerStatus() {
  if (providerCache && Date.now() - providerCache.at < 60_000) return providerCache.data;
  const data = await Promise.all((Object.keys(PROVIDERS) as Provider[]).map(async (id) => {
    try {
      const { stdout } = await exec(PROVIDERS[id].bin, ['--version'], { timeout: 8000 });
      return { id, label: PROVIDERS[id].label, installed: true, version: stdout.trim().split('\n')[0].slice(0, 60) };
    } catch { return { id, label: PROVIDERS[id].label, installed: false, version: '' }; }
  }));
  providerCache = { at: Date.now(), data };
  return data;
}

function validateAgentInput(p: any, partial = false) {
  if (!partial || p.name !== undefined) { if (!String(p.name ?? '').trim()) throw bad('Name is required'); }
  if (p.provider !== undefined && !(p.provider in PROVIDERS)) throw bad(`Unknown provider "${p.provider}"`);
  if (p.role !== undefined && !['orchestrator', 'worker'].includes(p.role)) throw bad('Role must be orchestrator or worker');
  if (p.cwd && !existsSync(p.cwd)) throw bad(`Folder does not exist: ${p.cwd}`);
  if (p.colony_id && !colonies.get(p.colony_id)) throw bad('That colony no longer exists');
}

type Handler = (ctx: { req: IncomingMessage; res: ServerResponse; params: string[]; url: URL }) => Promise<unknown> | unknown;
const routes: [string, RegExp, Handler][] = [];
const route = (method: string, path: string, h: Handler) =>
  routes.push([method, new RegExp('^' + path.replace(/:[^/]+/g, '([^/]+)') + '$'), h]);

route('GET', '/api/health', () => ({ ok: true }));
route('GET', '/api/providers', () => providerStatus());
route('GET', '/api/providers/:p/models', async ({ params }) => {
  if (!(params[0] in PROVIDERS)) throw notFound('Unknown provider');
  return listModels(params[0] as Provider);
});

// ---- agents ----
route('GET', '/api/agents', () => agents.list().map((a) => ({ ...a, queued: queueDepth(a.id), live: !!liveTurn(a.id) })));
route('POST', '/api/agents', async ({ req }) => {
  const p = await body(req);
  validateAgentInput(p);
  if (agents.byName(p.name)) throw bad(`An agent named "${p.name}" already exists`);
  const a = agents.create({ ...p, name: p.name.trim(), cwd: p.cwd ?? '' });
  if (!a.effective.cwd) { agents.remove(a.id); throw bad('Choose a working folder, or put the agent in a colony that provides one.'); }
  notifyAgentsChanged();
  return a;
});
route('GET', '/api/agents/:id', ({ params }) => agents.get(params[0]) ?? (() => { throw notFound('Agent not found'); })());
route('PATCH', '/api/agents/:id', async ({ req, params }) => {
  const p = await body(req);
  validateAgentInput(p, true);
  const cur = agents.get(params[0]); if (!cur) throw notFound('Agent not found');
  if (p.name && p.name.toLowerCase() !== cur.name.toLowerCase() && agents.byName(p.name)) throw bad(`An agent named "${p.name}" already exists`);
  // Changing provider invalidates the native session pointer. (A changed folder is detected when the next turn starts.)
  // All-or-nothing: a change that would leave a linked agent in Plan mode is rolled back.
  const a = db.transaction(() => {
    const u = agents.update(params[0], p)!;
    const why = channelPermissionError(u.id); if (why) throw bad(why);
    return u;
  })();
  if (p.provider && p.provider !== cur.provider) agents.setSession(a, null);
  if (!agents.get(a.id)!.effective.cwd) throw bad('Choose a working folder, or keep inheriting the colony’s folder.');
  notifyAgentsChanged();
  return agents.get(params[0]);
});
route('DELETE', '/api/agents/:id', ({ params }) => {
  stopAgent(params[0]);
  if (!agents.remove(params[0])) throw notFound('Agent not found');
  notifyAgentsChanged();
  return { ok: true };
});
route('POST', '/api/agents/:id/messages', async ({ req, params }) => {
  const a = agents.get(params[0]); if (!a) throw notFound('Agent not found');
  const { prompt } = await body(req);
  if (!String(prompt ?? '').trim()) throw bad('Message is empty');
  void sendTurn(a.id, String(prompt)).catch((e) => console.error('[turn]', e));
  return { accepted: true };
});
route('POST', '/api/agents/:id/stop', ({ params }) => ({ stopped: stopAgent(params[0]) }));
route('POST', '/api/agents/:id/new-session', ({ params }) => {
  const a = agents.get(params[0]); if (!a) throw notFound('Agent not found');
  stopAgent(a.id); agents.setSession(a, null); notifyAgentsChanged();
  return { ok: true };
});
route('POST', '/api/agents/:id/resume-session', async ({ req, params }) => {
  const a = agents.get(params[0]); if (!a) throw notFound('Agent not found');
  const { session_id } = await body(req);
  if (!agents.sessions(a.id).some((s) => s.session_id === session_id && s.kind !== 'delegation')) throw bad('Only the agent’s own conversations can be made current. Delegated sessions are read-only.');
  agents.setSession(a, session_id); notifyAgentsChanged();
  return { ok: true };
});
route('GET', '/api/agents/:id/history', ({ params, url }) => {
  const a = agents.get(params[0]); if (!a) throw notFound('Agent not found');
  const sid = url.searchParams.get('session') ?? a.session_id;
  if (sid && sid !== a.session_id && !agents.sessions(a.id).some((s) => s.session_id === sid)) throw bad('That session does not belong to this agent');
  return { session_id: sid, messages: readHistory(resolved(a), sid) };
});
route('GET', '/api/agents/:id/stats', ({ params, url }) => {
  const a = agents.get(params[0]); if (!a) throw notFound('Agent not found');
  const sid = url.searchParams.get('session') ?? a.session_id;
  if (sid && sid !== a.session_id && !agents.sessions(a.id).some((s) => s.session_id === sid)) throw bad('That session does not belong to this agent');
  return sessionStats(readHistory(resolved(a), sid));
});
route('GET', '/api/agents/:id/live', ({ params }) => liveTurn(params[0]));
route('GET', '/api/agents/:id/sessions', ({ params }) => agents.sessions(params[0]));

// ---- read-only git explorer (scoped to the agent's effective folder) ----
const agentCwd = (id: string) => { const a = agents.get(id); if (!a) throw notFound('Agent not found'); return resolved(a).cwd; };
const gitSafe = async <T,>(fn: () => Promise<T>): Promise<T> => { try { return await fn(); } catch (e) { if (isPathError(e) || e instanceof GitOpError) throw bad(e.message); throw e; } };
const qpath = (url: URL) => { const p = url.searchParams.get('path'); if (!p) throw bad('path is required'); return p; };

route('GET', '/api/agents/:id/git/status', ({ params }) => gitStatus(agentCwd(params[0])));
route('GET', '/api/agents/:id/git/ls', ({ params, url }) => gitSafe(() => gitList(agentCwd(params[0]), qpath(url))));
route('GET', '/api/agents/:id/git/tree', ({ params }) => gitTree(agentCwd(params[0])));
route('GET', '/api/agents/:id/git/diff', ({ params, url }) => gitSafe(() => gitDiff(agentCwd(params[0]), qpath(url), url.searchParams.get('old') ?? undefined)));
route('GET', '/api/agents/:id/git/file', ({ params, url }) => gitSafe(() => gitFile(agentCwd(params[0]), qpath(url))));
route('GET', '/api/agents/:id/git/raw', async ({ params, url, res }) => {
  const img = await gitSafe(() => gitImagePath(agentCwd(params[0]), qpath(url)));
  // Served only as an inert image: no sniffing, and a sandbox policy so an SVG can never run scripts.
  res.writeHead(200, { 'content-type': img.type, 'content-length': img.size, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'" });
  createReadStream(img.abs).pipe(res);
});

// ---- git history and actions (writes: commit, pull, push, fetch, branches) ----
/** The API allows any origin (it is a local tool), so writes also check that the request comes from a local page. */
function localOnly(req: IncomingMessage) {
  const origin = req.headers.origin; if (!origin) return;
  let host = ''; try { host = new URL(origin).hostname; } catch { /* invalid */ }
  const own = String(req.headers.host ?? '').replace(/:\d+$/, '');
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host) && host !== own) throw new HttpError(403, 'Git actions are only allowed from the local app');
}
const gitWrite = (path: string, fn: (cwd: string, b: any) => Promise<unknown>) =>
  route('POST', `/api/agents/:id/git/${path}`, async ({ req, params }) => { localOnly(req); const b = await body(req); return gitSafe(() => fn(agentCwd(params[0]), b)); });

route('GET', '/api/agents/:id/git/log', ({ params, url }) => gitSafe(() => gitLog(agentCwd(params[0]), Number(url.searchParams.get('skip') ?? 0))));
route('GET', '/api/agents/:id/git/commit', ({ params, url }) => gitSafe(() => gitCommitDetail(agentCwd(params[0]), url.searchParams.get('sha') ?? '')));
route('GET', '/api/agents/:id/git/commit-diff', ({ params, url }) => gitSafe(() => gitCommitDiff(agentCwd(params[0]), url.searchParams.get('sha') ?? '', qpath(url), url.searchParams.get('old') ?? undefined)));
route('GET', '/api/agents/:id/git/blame', ({ params, url }) => gitSafe(() => gitBlame(agentCwd(params[0]), qpath(url))));
// Smart switch: what would happen, plus which other agents are working in the same repository right now (a switch
// moves their files too).
route('GET', '/api/agents/:id/git/switch-plan', async ({ params, url }) => {
  const cwd = agentCwd(params[0]);
  const plan = await gitSafe(() => planSwitch(cwd, url.searchParams.get('branch') ?? ''));
  const here = await findRepo(cwd);
  const others: { id: string; name: string }[] = [];
  if (here.ok) for (const a of agents.list()) {
    if (a.id === params[0] || !(a.status === 'running' || liveTurn(a.id))) continue;
    const there = await findRepo(resolved(a).cwd);
    if (there.ok && there.repo.root === here.repo.root) others.push({ id: a.id, name: a.name });
  }
  return { ...plan, others, selfRunning: agents.get(params[0])?.status === 'running' };
});
route('GET', '/api/agents/:id/git/stashes', ({ params }) => gitSafe(() => listStashes(agentCwd(params[0]))));
route('GET', '/api/agents/:id/git/stash', ({ params, url }) => gitSafe(() => stashDetail(agentCwd(params[0]), url.searchParams.get('sha') ?? '')));
route('GET', '/api/agents/:id/git/branches', ({ params }) => gitSafe(() => gitBranches(agentCwd(params[0]))));
gitWrite('commit', (cwd, b) => gitCommitChanges(cwd, String(b.message ?? ''), Array.isArray(b.paths) ? b.paths.map(String) : []));
gitWrite('fetch', (cwd) => gitFetch(cwd));
gitWrite('pull', (cwd, b) => gitPull(cwd, (['ff-only', 'merge', 'rebase'].includes(b.mode) ? b.mode : 'ff-only') as PullMode));
gitWrite('push', (cwd) => gitPush(cwd));
gitWrite('switch', (cwd, b) => gitSwitch(cwd, String(b.branch ?? ''), !!b.create));
gitWrite('merge', (cwd, b) => gitMerge(cwd, String(b.branch ?? '')));
gitWrite('merge-abort', (cwd) => gitMergeAbort(cwd));
gitWrite('switch-smart', (cwd, b) => smartSwitch(cwd, String(b.branch ?? '')));
gitWrite('smart-finish', (cwd) => smartFinish(cwd));
gitWrite('smart-cancel', (cwd) => smartCancel(cwd));
gitWrite('stash-save', (cwd, b) => stashSave(cwd, String(b.message ?? '')));
gitWrite('stash-apply', (cwd, b) => stashApply(cwd, String(b.sha ?? ''), !!b.pop));
gitWrite('stash-drop', (cwd, b) => stashDrop(cwd, String(b.sha ?? '')));
gitWrite('discard', (cwd, b) => gitDiscardFile(cwd, String(b.path ?? ''), b.oldPath ? String(b.oldPath) : undefined));
gitWrite('discard-hunk', (cwd, b) => gitDiscardHunk(cwd, String(b.path ?? ''), Number(b.index), String(b.header ?? '')));
gitWrite('discard-lines', (cwd, b) => gitDiscardLines(cwd, String(b.path ?? ''), Number(b.index), String(b.header ?? ''), Array.isArray(b.lines) ? b.lines.map(Number) : []));
gitWrite('discard-all', (cwd) => gitDiscardAll(cwd));
gitWrite('rebase-continue', (cwd) => gitRebaseContinue(cwd));
gitWrite('resolve-side', (cwd, b) => gitResolveSide(cwd, String(b.path ?? ''), b.side));
gitWrite('resolve', (cwd, b) => gitResolveContent(cwd, String(b.path ?? ''), String(b.content ?? ''), !!b.keepMarkers));
gitWrite('unresolve', (cwd, b) => gitUnresolve(cwd, String(b.path ?? '')));

// ---- sessions across all managed agents ----
route('GET', '/api/sessions', () => {
  const byAgent = new Map(agents.list().map((a) => [a.id, a]));
  return agents.allSessions().map((s) => {
    const a = byAgent.get(s.agent_id)!;
    const msgs = readHistory({ provider: s.provider, cwd: s.cwd, session_id: s.session_id }, s.session_id);
    const first = msgs.find((m) => m.role === 'user')?.blocks.find((b) => b.type === 'text');
    const st = sessionStats(msgs);
    return {
      ...s, current: a.session_id === s.session_id, message_count: msgs.length,
      usage: st.usage, cost: st.cost, tool_calls: st.toolCalls, model: st.models[0]?.model ?? null,
      preview: first && first.type === 'text' ? first.text.slice(0, 160) : '',
    };
  });
});

// ---- skills ----
route('GET', '/api/skills', () => skills.list());
route('GET', '/api/skills/usage', () => skills.usage());
route('POST', '/api/skills', async ({ req }) => {
  const p = await body(req);
  if (!String(p.name ?? '').trim()) throw bad('Name is required');
  try { return skills.create({ name: p.name.trim(), description: p.description ?? '', content: p.content ?? '' }); }
  catch { throw bad(`A skill named "${p.name}" already exists`); }
});
route('PATCH', '/api/skills/:id', async ({ req, params }) => {
  const p = await body(req);
  try { return skills.update(params[0], p) ?? (() => { throw notFound('Skill not found'); })(); }
  catch (e) { if (e instanceof HttpError) throw e; throw bad(`A skill named "${p.name}" already exists`); }
});
route('DELETE', '/api/skills/:id', ({ params }) => { if (!skills.remove(params[0])) throw notFound('Skill not found'); return { ok: true }; });

// ---- agent types ----
route('GET', '/api/types', () => types.list());
route('POST', '/api/types', async ({ req }) => {
  const p = await body(req);
  if (!String(p.name ?? '').trim()) throw bad('Name is required');
  if (!(p.provider in PROVIDERS)) throw bad('Pick a provider');
  try { return types.create({ ...p, name: p.name.trim() }); } catch { throw bad(`A type named "${p.name}" already exists`); }
});
route('PATCH', '/api/types/:id', async ({ req, params }) => {
  const t = types.update(params[0], await body(req)); if (!t) throw notFound('Type not found'); return t;
});
route('DELETE', '/api/types/:id', ({ params }) => { if (!types.remove(params[0])) throw notFound('Type not found'); return { ok: true }; });
route('POST', '/api/types/:id/spawn', async ({ req, params }) => {
  const t = types.get(params[0]); if (!t) throw notFound('Type not found');
  const p = await body(req);
  validateAgentInput({ name: p.name, cwd: p.cwd, colony_id: p.colony_id });
  if (agents.byName(p.name)) throw bad(`An agent named "${p.name}" already exists`);
  const a = agents.create({
    name: p.name.trim(), description: p.description ?? t.description, role: t.role, type_id: t.id, provider: t.provider, model: t.model,
    system_prompt: t.system_prompt, permission: t.permission, cwd: p.cwd ?? '', skill_ids: t.skill_ids, colony_id: p.colony_id ?? null,
  });
  if (!a.effective.cwd) { agents.remove(a.id); throw bad('Choose a working folder, or put the agent in a colony that provides one.'); }
  notifyAgentsChanged();
  return a;
});

// ---- colonies ----
function validateColony(p: any, partial = false) {
  if (!partial || p.name !== undefined) { if (!String(p.name ?? '').trim()) throw bad('Name is required'); }
  if (p.cwd && !existsSync(p.cwd)) throw bad(`Folder does not exist: ${p.cwd}`);
}
route('GET', '/api/colonies', () => colonies.list());
route('POST', '/api/colonies', async ({ req }) => {
  const p = await body(req); validateColony(p);
  if (colonies.list().some((c) => c.name.toLowerCase() === p.name.trim().toLowerCase())) throw bad(`A colony named "${p.name}" already exists`);
  const c = colonies.create({ ...p, name: p.name.trim() });
  notifyAgentsChanged();
  return c;
});
route('PATCH', '/api/colonies/:id', async ({ req, params }) => {
  const p = await body(req); validateColony(p, true);
  const cur = colonies.get(params[0]); if (!cur) throw notFound('Colony not found');
  if (p.name && p.name.toLowerCase() !== cur.name.toLowerCase() && colonies.list().some((c) => c.name.toLowerCase() === p.name.trim().toLowerCase())) throw bad(`A colony named "${p.name}" already exists`);
  const c = db.transaction(() => {
    const u = colonies.update(params[0], p.name ? { ...p, name: p.name.trim() } : p)!;
    for (const id of u.agent_ids) { const why = channelPermissionError(id); if (why) throw bad(why); }
    return u;
  })();
  notifyAgentsChanged();
  return c;
});
route('DELETE', '/api/colonies/:id', ({ params }) => {
  if (!colonies.remove(params[0])) throw notFound('Colony not found');
  notifyAgentsChanged();
  return { ok: true };
});

// ---- external connections ----
const KINDS = ['telegram', 'slack'] as const;
const REQUIRED: Record<string, string[]> = { telegram: ['token'], slack: ['bot_token', 'app_token'] };
function validateConnection(kind: string, config: Record<string, any>, agentId: string | null | undefined, enabled: boolean) {
  const missing = (REQUIRED[kind] ?? []).filter((k) => typeof config[k] !== 'string' || !config[k].trim());
  if (missing.length) throw bad(`Missing: ${missing.join(', ')}`);
  if (config.on_silent !== undefined && !['notice', 'send_text', 'ignore'].includes(config.on_silent)) throw bad('on_silent must be notice, send_text or ignore');
  if (agentId) {
    const a = agents.get(agentId); if (!a) throw bad('That agent no longer exists');
    if (enabled && a.effective.permission === 'plan') throw bad(`"${a.name}" is in Plan mode and cannot reply. Give it "Edit files" permission first.`);
  }
}
const cleanAllowed = (v: unknown) => (Array.isArray(v) ? v : []).map((u: any) => ({ id: String(u?.id ?? '').trim(), name: u?.name ? String(u.name) : undefined, admin: !!u?.admin })).filter((u) => u.id);

route('GET', '/api/connections', () => connections.list().map(publicConnection));
route('POST', '/api/connections', async ({ req }) => {
  const p = await body(req);
  if (!KINDS.includes(p.kind)) throw bad(`Kind must be one of: ${KINDS.join(', ')}`);
  const name = String(p.name ?? '').trim(); if (!name) throw bad('Name is required');
  if (connections.list().some((c) => c.name.toLowerCase() === name.toLowerCase())) throw bad(`A connection named "${name}" already exists`);
  const config = mergeConfig({}, p.config); const enabled = p.enabled !== false;
  validateConnection(p.kind, config, p.agent_id, enabled);
  const c = connections.create({ kind: p.kind, name, agent_id: p.agent_id || null, config, allowed: cleanAllowed(p.allowed), enabled });
  await startConnection(c.id); notifyAgentsChanged();
  return publicConnection(connections.get(c.id)!);
});
route('PATCH', '/api/connections/:id', async ({ req, params }) => {
  const p = await body(req);
  const cur = connections.get(params[0]); if (!cur) throw notFound('Connection not found');
  const name = p.name !== undefined ? String(p.name).trim() : cur.name; if (!name) throw bad('Name is required');
  if (name.toLowerCase() !== cur.name.toLowerCase() && connections.list().some((c) => c.name.toLowerCase() === name.toLowerCase())) throw bad(`A connection named "${name}" already exists`);
  const config = mergeConfig(cur.config, p.config);
  const agent_id = p.agent_id !== undefined ? (p.agent_id || null) : cur.agent_id;
  const enabled = p.enabled !== undefined ? !!p.enabled : cur.enabled;
  validateConnection(cur.kind, config, agent_id, enabled);
  connections.update(cur.id, { name, config, agent_id, enabled, allowed: p.allowed !== undefined ? cleanAllowed(p.allowed) : cur.allowed });
  await startConnection(cur.id); notifyAgentsChanged();
  return publicConnection(connections.get(cur.id)!);
});
route('DELETE', '/api/connections/:id', async ({ params }) => {
  await stopConnection(params[0]);
  if (!connections.remove(params[0])) throw notFound('Connection not found');
  notifyAgentsChanged();
  return { ok: true };
});
route('POST', '/api/connections/:id/restart', async ({ params }) => {
  if (!connections.get(params[0])) throw notFound('Connection not found');
  await startConnection(params[0]);
  return { status: connectionStatus(params[0]) };
});
route('POST', '/api/connections/:id/test', async ({ params }) => {
  if (!connections.get(params[0])) throw notFound('Connection not found');
  try { return { ok: true, detail: await testConnection(params[0]) }; } catch (e) { throw bad(e instanceof Error ? e.message : String(e)); }
});
route('GET', '/api/connections/:id/threads', ({ params }) => {
  if (!connections.get(params[0])) throw notFound('Connection not found');
  return threads.forConnection(params[0]);
});

// ---- orchestration ----
route('GET', '/api/orchestrators/:id/workers', ({ params }) => {
  const o = agents.get(params[0]); if (!o) throw notFound('Agent not found');
  return o.worker_ids.map((id) => agents.get(id)).filter(Boolean).map((w) => ({ name: w!.name, role: w!.role, description: w!.description, provider: w!.provider, busy: !!liveTurn(w!.id) }));
});
route('PUT', '/api/orchestrators/:id/workers', async ({ req, params }) => {
  const o = agents.get(params[0]); if (!o) throw notFound('Agent not found');
  if (o.role !== 'orchestrator') throw bad('Only orchestrators can have subagents');
  const { worker_ids } = await body(req);
  agents.setWorkers(o.id, worker_ids ?? []); notifyAgentsChanged();
  return agents.get(o.id);
});
route('POST', '/api/dispatch', async ({ req }) => {
  const { from, agent, task } = await body(req);
  if (!from || !agent || !task) throw bad('from, agent and task are required');
  try { return await dispatch(from, agent, task); } catch (e) { throw bad(e instanceof Error ? e.message : String(e)); }
});
route('POST', '/api/channel/reply', async ({ req }) => {
  const { from, text } = await body(req);
  try { return await channelReply(String(from ?? ''), String(text ?? '')); }
  catch (e) { if (e instanceof ChannelError) throw bad(e.message); throw e; }
});
route('GET', '/api/dispatches', () => dispatches.recent());

// ---- folder picker ----
route('GET', '/api/fs/dirs', ({ url }) => {
  const p = resolve(url.searchParams.get('path') || homedir());
  if (!existsSync(p) || !statSync(p).isDirectory()) throw bad('Not a folder');
  let entries: string[] = [];
  try {
    entries = readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules').map((d) => d.name).sort((a, b) => a.localeCompare(b));
  } catch { /* unreadable */ }
  return { path: p, parent: p === '/' ? null : dirname(p), dirs: entries.map((n) => ({ name: n, path: join(p, n) })) };
});

export async function handle(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url ?? '/', 'http://localhost');
  for (const [m, re, h] of routes) {
    if (m !== req.method) continue;
    const match = re.exec(url.pathname);
    if (!match) continue;
    try {
      const out = await h({ req, res, params: match.slice(1).map(decodeURIComponent), url });
      if (res.headersSent) return; // the handler streamed its own response
      return json(res, 200, out ?? null);
    } catch (e) {
      if (e instanceof HttpError) return json(res, e.status, { error: e.message });
      console.error('[api]', e);
      return json(res, 500, { error: 'Unexpected server error' });
    }
  }
  json(res, 404, { error: 'No such route' });
}
