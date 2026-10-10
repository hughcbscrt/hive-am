import type { IncomingMessage, ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { agents, colonies, db, dispatches, resolved, skills, types } from './db.js';
import { ChannelError, SendError, channelMute, channelReply, channelSendFile, connectionStatus, startConnection, stopConnection, testConnection } from './connections/manager.js';
import { mergeConfig, publicConnection } from './connections/public.js';
import { channelPermissionError } from './connections/rules.js';
import { validVision } from './connections/vision.js';
import { NOTEBOOK_MAX, NotebookError, notebooks } from './skills/notebook.js';
import { NOTEBOOK_SKILL_ID } from './skills/defaults.js';
import { WakeError, listWakeups, removeWakeup, scheduleWake } from './wake.js';
import { WatchError, cancelWatchFor, createWatch, pendingWatches, removeWatch } from './watch.js';
import { ScheduleError, cancelFor, createSchedule, listAll, listFor, removeSchedule, runsOf, setEnabled } from './schedules.js';
import { syncChannelSkill } from './connections/channel-skill.js';
import { connections, threads } from './connections/store.js';
import { dispatch, liveIsDirect, liveOrigin, liveTurn, notifyAgentsChanged, queueDepth, sendTurn, stopAgent } from './runtime.js';
import { mcpCaps } from './instructions.js';
import { readHistory } from './history/index.js';
import { listModels } from './models.js';
import type { Provider } from './types.js';
import { sessionStats } from './stats.js';
import { summaryOf } from './sessions-summary.js';
import { emptyUsage } from './pricing.js';
import { createReadStream } from 'node:fs';
import { findRepo, gitDiff, gitFile, gitImagePath, gitList, gitStatus, gitTree, isPathError } from './git/repo.js';
import { listStashes, planSwitch, smartCancel, smartFinish, smartSwitch, stashApply, stashDetail, stashDrop, stashSave } from './git/switch.js';
import { gitCompare, gitCompareDiff, gitGrep, gitImageAt, gitRefs } from './git/browse.js';
import { GitOpError, gitBlame, gitBranchCreate, gitBranchDelete, gitRefFile, gitBranches, gitCommitDetail, gitCommitChanges, gitCommitDiff, gitDiscardAll, gitDiscardFile, gitDiscardHunk, gitDiscardLines, gitFetch, gitLog, gitMerge, gitMergeAbort, gitPull, gitPush, gitRebaseContinue, gitResolveContent, gitResolveSide, gitSwitch, gitTagFile, gitTagTree, gitTags, gitUnresolve, type PullMode } from './git/ops.js';

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
  // A long conversation is sent in pieces: `limit` keeps only the newest messages (the browser would freeze rendering thousands).
  const all = readHistory(resolved(a), sid), limit = Number(url.searchParams.get('limit'));
  return { session_id: sid, total: all.length, messages: limit > 0 && all.length > limit ? all.slice(-limit) : all };
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

route('GET', '/api/agents/:id/git/log', ({ params, url }) => gitSafe(() => {
  const by = url.searchParams.get('by');
  return gitLog(agentCwd(params[0]), Number(url.searchParams.get('skip') ?? 0), {
    path: url.searchParams.get('path') ?? undefined, q: url.searchParams.get('q') ?? undefined, ref: url.searchParams.get('ref') ?? undefined,
    by: by === 'author' || by === 'content' ? by : 'message',
  });
}));
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
route('GET', '/api/agents/:id/git/refs', ({ params }) => gitSafe(() => gitRefs(agentCwd(params[0]))));
route('GET', '/api/agents/:id/git/compare', ({ params, url }) => gitSafe(() => gitCompare(agentCwd(params[0]), url.searchParams.get('base') ?? '', url.searchParams.get('head') ?? '')));
route('GET', '/api/agents/:id/git/compare-diff', ({ params, url }) => gitSafe(() => gitCompareDiff(agentCwd(params[0]), url.searchParams.get('base') ?? '', url.searchParams.get('head') ?? '', qpath(url), url.searchParams.get('old') ?? undefined)));
route('GET', '/api/agents/:id/git/grep', ({ params, url }) => gitSafe(() => gitGrep(agentCwd(params[0]), url.searchParams.get('q') ?? '', url.searchParams.get('case') === '1')));
route('GET', '/api/agents/:id/git/ref-file', ({ params, url }) => gitSafe(() => gitRefFile(agentCwd(params[0]), url.searchParams.get('ref') ?? '', qpath(url))));
route('GET', '/api/agents/:id/git/raw-at', async ({ params, url, res }) => {
  const img = await gitSafe(() => gitImageAt(agentCwd(params[0]), url.searchParams.get('ref') ?? '', qpath(url)));
  res.writeHead(200, { 'content-type': img.type, 'content-length': img.bytes.length, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'" });
  res.end(img.bytes);
});
route('GET', '/api/agents/:id/git/tags', ({ params }) => gitSafe(() => gitTags(agentCwd(params[0]))));
route('GET', '/api/agents/:id/git/tag-tree', ({ params, url }) => gitSafe(() => gitTagTree(agentCwd(params[0]), url.searchParams.get('tag') ?? '')));
route('GET', '/api/agents/:id/git/tag-file', ({ params, url }) => gitSafe(() => gitTagFile(agentCwd(params[0]), url.searchParams.get('tag') ?? '', qpath(url))));
route('GET', '/api/agents/:id/git/branches', ({ params }) => gitSafe(() => gitBranches(agentCwd(params[0]))));
gitWrite('commit', (cwd, b) => gitCommitChanges(cwd, String(b.message ?? ''), Array.isArray(b.paths) ? b.paths.map(String) : []));
gitWrite('fetch', (cwd) => gitFetch(cwd));
gitWrite('pull', (cwd, b) => gitPull(cwd, (['ff-only', 'merge', 'rebase'].includes(b.mode) ? b.mode : 'ff-only') as PullMode));
gitWrite('push', (cwd) => gitPush(cwd));
gitWrite('switch', (cwd, b) => gitSwitch(cwd, String(b.branch ?? ''), !!b.create));
gitWrite('branch-create', (cwd, b) => gitBranchCreate(cwd, String(b.branch ?? ''), String(b.from ?? '')));
gitWrite('branch-delete', (cwd, b) => gitBranchDelete(cwd, String(b.branch ?? ''), !!b.force));
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

// ---- skills ----
const checkLoad = (v: unknown) => { if (v !== undefined && v !== 'always' && v !== 'on_demand') throw bad('load must be always or on_demand'); };
route('GET', '/api/skills', () => skills.list());
route('GET', '/api/skills/usage', () => skills.usage());
route('POST', '/api/skills', async ({ req }) => {
  const p = await body(req);
  if (!String(p.name ?? '').trim()) throw bad('Name is required');
  checkLoad(p.load);
  try { return skills.create({ name: p.name.trim(), description: p.description ?? '', content: p.content ?? '', load: p.load }); }
  catch { throw bad(`A skill named "${p.name}" already exists`); }
});
route('PATCH', '/api/skills/:id', async ({ req, params }) => {
  const p = await body(req);
  checkLoad(p.load);
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
    system_prompt: t.system_prompt, permission: t.permission, cwd: p.cwd ?? '', skill_ids: t.skill_ids, skill_loads: t.skill_loads, colony_id: p.colony_id ?? null,
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
  if (config.effort !== undefined && !["", "low", "medium", "high"].includes(config.effort)) throw bad('effort must be empty, low, medium or high');
  if (config.on_silent !== undefined && !['notice', 'send_text', 'ignore'].includes(config.on_silent)) throw bad('on_silent must be notice, send_text or ignore');
  if (config.group_mode !== undefined && !['mention', 'open'].includes(config.group_mode)) throw bad('group_mode must be mention or open');
  if (config.vision !== undefined && config.vision !== null && !validVision(config.vision)) throw bad('vision must be { provider, model } or empty');
  if (config.chats !== undefined && (!Array.isArray(config.chats) || config.chats.length > 50)) throw bad('chats must be a list of at most 50 groups');
  if (config.aliases !== undefined && (!Array.isArray(config.aliases) || config.aliases.length > 10)) throw bad('aliases must be a list of at most 10 names');
  if (agentId) {
    const a = agents.get(agentId); if (!a) throw bad('That agent no longer exists');
    if (enabled && a.effective.permission === 'plan') throw bad(`"${a.name}" is in Plan mode and cannot reply. Give it "Edit files" permission first.`);
  }
}
/** Group ids and alias names from the form: trimmed, de-duplicated, blanks dropped. */
function cleanGroupConfig(config: Record<string, any>) {
  if (Array.isArray(config.chats)) {
    const seen = new Set<string>();
    config.chats = config.chats.map((c: any) => ({ id: String(c?.id ?? '').trim(), name: c?.name ? String(c.name).trim() : undefined })).filter((c: any) => c.id && !seen.has(c.id) && seen.add(c.id));
  }
  if (Array.isArray(config.aliases)) config.aliases = [...new Set(config.aliases.map((x: any) => String(x).trim()).filter(Boolean))];
  return config;
}
const cleanAllowed = (v: unknown) => (Array.isArray(v) ? v : []).map((u: any) => ({ id: String(u?.id ?? '').trim(), name: u?.name ? String(u.name) : undefined, admin: !!u?.admin })).filter((u) => u.id);

route('GET', '/api/connections', () => connections.list().map(publicConnection));
route('POST', '/api/connections', async ({ req }) => {
  const p = await body(req);
  if (!KINDS.includes(p.kind)) throw bad(`Kind must be one of: ${KINDS.join(', ')}`);
  const name = String(p.name ?? '').trim(); if (!name) throw bad('Name is required');
  if (connections.list().some((c) => c.name.toLowerCase() === name.toLowerCase())) throw bad(`A connection named "${name}" already exists`);
  const config = cleanGroupConfig(mergeConfig({}, p.config)); const enabled = p.enabled !== false;
  validateConnection(p.kind, config, p.agent_id, enabled);
  const c = connections.create({ kind: p.kind, name, agent_id: p.agent_id || null, config, allowed: cleanAllowed(p.allowed), enabled });
  syncChannelSkill(c.agent_id);
  await startConnection(c.id); notifyAgentsChanged();
  return publicConnection(connections.get(c.id)!);
});
route('PATCH', '/api/connections/:id', async ({ req, params }) => {
  const p = await body(req);
  const cur = connections.get(params[0]); if (!cur) throw notFound('Connection not found');
  const name = p.name !== undefined ? String(p.name).trim() : cur.name; if (!name) throw bad('Name is required');
  if (name.toLowerCase() !== cur.name.toLowerCase() && connections.list().some((c) => c.name.toLowerCase() === name.toLowerCase())) throw bad(`A connection named "${name}" already exists`);
  const config = cleanGroupConfig(mergeConfig(cur.config, p.config));
  const agent_id = p.agent_id !== undefined ? (p.agent_id || null) : cur.agent_id;
  const enabled = p.enabled !== undefined ? !!p.enabled : cur.enabled;
  validateConnection(cur.kind, config, agent_id, enabled);
  connections.update(cur.id, { name, config, agent_id, enabled, allowed: p.allowed !== undefined ? cleanAllowed(p.allowed) : cur.allowed });
  syncChannelSkill(cur.agent_id, agent_id);
  await startConnection(cur.id); notifyAgentsChanged();
  return publicConnection(connections.get(cur.id)!);
});
route('DELETE', '/api/connections/:id', async ({ params }) => {
  await stopConnection(params[0]);
  const gone = connections.get(params[0]);
  if (!connections.remove(params[0])) throw notFound('Connection not found');
  syncChannelSkill(gone?.agent_id);
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
route('PATCH', '/api/connections/:id/threads/:threadId', async ({ req, params }) => {
  const th = threads.get(params[1]);
  if (!th || th.connection_id !== params[0]) throw notFound('Thread not found');
  const p = await body(req);
  if (typeof p.muted === 'boolean') threads.setMuted(th.id, p.muted);
  return threads.get(th.id);
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
// `skill_read`: the text of one of the skills the agent has, loaded when it needs it.
route('POST', '/api/skills/read', async ({ req }) => {
  const { from, name } = await body(req);
  const agent = agents.get(String(from ?? '')); if (!agent) throw bad('Unknown agent');
  const mine = resolved(agent).skill_ids.map((id) => skills.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
  const want = String(name ?? '').trim().toLowerCase();
  const s = mine.find((x) => x.name.toLowerCase() === want);
  if (!s) throw bad(`No skill named "${name}". Your skills: ${mine.map((x) => x.name).join(', ') || '(none)'}.`);
  return { name: s.name, content: s.content.trim() };
});

// ---- notebook ----
/** Who a note came from, so it can be audited: the date plus, for chat turns, where and who. */
function noteSource(agentId: string): string {
  const day = new Date().toISOString().slice(0, 10), o = liveOrigin(agentId);
  return o ? `${day} · ${o.platform}: ${o.userName}` : day;
}
function notebookAgent(from: unknown) {
  const agent = agents.get(String(from ?? '')); if (!agent) throw bad('Unknown agent');
  if (!mcpCaps(resolved(agent)).includes('memory')) throw bad('This agent does not have the Notebook skill.');
  return agent;
}
const nbSafe = <T>(fn: () => T): T => { try { return fn(); } catch (e) { if (e instanceof NotebookError) throw bad(e.message); throw e; } };
const nbView = (n: { content: string; version: number }) => ({ content: n.content, version: n.version, size: n.content.length, max: NOTEBOOK_MAX });
route('POST', '/api/notebook/read', async ({ req }) => { const { from } = await body(req); return nbView(notebooks.get(notebookAgent(from).id)); });
route('POST', '/api/notebook/add', async ({ req }) => {
  const { from, section, note } = await body(req); const a = notebookAgent(from);
  const r = nbSafe(() => notebooks.add(a.id, String(section ?? ''), String(note ?? ''), noteSource(a.id), liveIsDirect(a.id)));
  return { added: r.added, note: r.note, ...nbView(r.notebook) };
});
route('POST', '/api/notebook/rewrite', async ({ req }) => {
  const { from, content, version } = await body(req); const a = notebookAgent(from);
  return { added: true, ...nbView(nbSafe(() => notebooks.rewrite(a.id, String(content ?? ''), Number(version), liveIsDirect(a.id)))) };
});
route('GET', '/api/agents/:id/notebook', ({ params }) => {
  const a = agents.get(params[0]); if (!a) throw notFound('Agent not found');
  const n = notebooks.get(a.id);
  return { ...nbView(n), updated_at: n.updated_at, updated_by: n.updated_by, enabled: resolved(a).skill_ids.includes(NOTEBOOK_SKILL_ID), skill_id: NOTEBOOK_SKILL_ID };
});
route('PUT', '/api/agents/:id/notebook', async ({ req, params }) => {
  localOnly(req);
  const a = agents.get(params[0]); if (!a) throw notFound('Agent not found');
  const p = await body(req);
  const n = nbSafe(() => notebooks.edit(a.id, String(p.content ?? ''), typeof p.version === 'number' ? p.version : undefined));
  return { ...nbView(n), updated_at: n.updated_at, updated_by: n.updated_by };
});
route('POST', '/api/channel/reply', async ({ req }) => {
  const { from, text } = await body(req);
  try { return await channelReply(String(from ?? ''), String(text ?? '')); }
  catch (e) { if (e instanceof ChannelError) throw bad(e.message); throw e; }
});
route('POST', '/api/channel/send-file', async ({ req }) => {
  const { from, path, caption } = await body(req);
  try { return await channelSendFile(String(from ?? ''), String(path ?? ''), caption === undefined ? undefined : String(caption)); }
  catch (e) { if (e instanceof ChannelError || e instanceof SendError) throw bad(e.message); throw e; }
});
route('POST', '/api/channel/mute', async ({ req }) => {
  const { from, muted } = await body(req);
  try { return channelMute(String(from ?? ''), muted !== false); }
  catch (e) { if (e instanceof ChannelError) throw bad(e.message); throw e; }
});
route('POST', '/api/wake', async ({ req }) => {
  const { from, minutes, note } = await body(req);
  try { return scheduleWake(String(from ?? ''), minutes, note); }
  catch (e) { if (e instanceof WakeError) throw bad(e.message); throw e; }
});
// Recurring schedules and pending wake-ups: the agent's tools (`from` is its id) and the interface.
const scheduleGuard = <T>(fn: () => T): T => { try { return fn(); } catch (e) { if (e instanceof ScheduleError) throw bad(e.message); throw e; } };
route('POST', '/api/wake-when-done', async ({ req }) => {
  const b = await body(req);
  try { const r = createWatch(String(b.from ?? ''), b); return r; }
  catch (e) { if (e instanceof WatchError) throw bad(e.message); throw e; }
});
route('POST', '/api/schedules/create', async ({ req }) => {
  const b = await body(req);
  return scheduleGuard(() => { const r = createSchedule(String(b.from ?? ''), b); return { id: r.schedule.id, schedule: r.schedule.kind === 'every' ? `every ${r.schedule.expr} min` : `${r.schedule.expr} (${r.schedule.tz})`, next: r.next, where: r.where }; });
});
route('POST', '/api/schedules/list', async ({ req }) => { const b = await body(req); return { schedules: listFor(String(b.from ?? '')) }; });
route('POST', '/api/schedules/cancel', async ({ req }) => {
  const b = await body(req); const from = String(b.from ?? ''), id = String(b.id ?? '');
  try { cancelWatchFor(from, id); return { cancelled: true }; } catch (e) { if (!(e instanceof WatchError)) throw e; }   // not one of its watches: a schedule then
  scheduleGuard(() => cancelFor(from, id)); return { cancelled: true };
});
route('GET', '/api/schedules', () => {
  const once = listWakeups().map((w) => ({
    id: w.id, agent_id: w.agent_id, connection_id: w.connection_id, thread_id: w.thread_id, kind: 'once', expr: '', tz: '', note: w.note, enabled: true, next_due: w.due_at, created_at: w.created_at,
    last_fired_at: null, fire_count: 0, last_status: null, last_detail: null, agent_name: agents.get(w.agent_id)?.name ?? '?', place: '', description: 'once',
  }));
  const watching = pendingWatches().map((w) => ({
    id: w.id, agent_id: w.agent_id, connection_id: w.connection_id, thread_id: w.thread_id, kind: 'watch', expr: String(w.pid), tz: '', note: w.note, enabled: true, next_due: w.deadline, created_at: w.started_at,
    last_fired_at: null, fire_count: 0, last_status: null, last_detail: null, agent_name: agents.get(w.agent_id)?.name ?? '?', place: '',
    description: `process ${w.pid}${w.file ? ` · file ${w.file}` : ''}${w.log ? ` · log ${w.log}` : ''}`,
  }));
  return [...listAll(), ...once, ...watching];
});
route('GET', '/api/schedules/:id/runs', ({ params }) => runsOf(params[0]));
route('PATCH', '/api/schedules/:id', async ({ req, params }) => {
  const b = await body(req);
  return setEnabled(params[0], !!b.enabled) ?? (() => { throw notFound('Schedule not found'); })();
});
route('DELETE', '/api/schedules/:id', ({ params }) => {
  if (!removeSchedule(params[0]) && !removeWakeup(params[0]) && !removeWatch(params[0])) throw notFound('Schedule not found');
  return { ok: true };
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
