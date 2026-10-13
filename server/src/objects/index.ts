import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, agents, resolved } from '../db.js';
import { OBJECTS_SKILL_ID } from '../skills/defaults.js';
import { bus } from '../runtime.js';
import { renderTemplate, listTemplates } from './templates.js';
import { composeServiceAction, inspectDocker, recreateDocker, type DockerAction, dockerLogs, dockerState, removeDocker, restartDocker, startDocker, stopDocker } from './docker.js';
import { recordRun, listHistory, clearHistory } from './http-history.js';
import { dbColumns, dbQuery, dbSchema, dbState, dbTest, forgetDatabase } from './database.js';
import { addSaved, clearQueries, forgetQueries, listQueries, listSaved, recordQuery, removeSaved, updateSaved } from './db-history.js';
import { exportCollection, parseHttpFile, createHttpFile, exportHttp, type ExportFormat, describeHttp, dropSession, inspectHttp, readHttpFile, runHttp, scanHttp, writeHttpFile, sessionClear, sessionOf, sessionSet, sessionView } from './http.js';
import { ObjectError, parseDatabase, type ClusterConfig, type DatabaseConfig, type DockerConfig, type HttpConfig, type ObjectRow, type ObjectState, type ObjectView, type ServerConfig } from './model.js';
import { forgetServer, serverLogs, serverState, startServer, stopServer } from './runner.js';
import { forgetSupervision, resetSupervision, supervise } from './supervisor.js';
import { maskConfig, objectsStore } from './store.js';

export { ObjectError } from './model.js';
export { objectsStore } from './store.js';

/** Last known state of each object, refreshed in the background so listing never waits on `docker` or a port check. */
const states = new Map<string, ObjectState>();
const POLL_MS = Number(process.env.HIVE_AM_OBJECT_POLL_MS) || 3000;
const changed = () => bus.emit('msg', { kind: 'objects_changed' });
const same = (a?: ObjectState, b?: ObjectState) => !!a && !!b && a.status === b.status && a.detail === b.detail && a.pid === b.pid;

/** How many requests a folder has: scanning reads every file, so it is remembered for a while. */
const counts = new Map<string, { at: number; text: string; ok: boolean }>();
function httpState(o: ObjectRow): ObjectState {
  const c = o.config as HttpConfig, hit = counts.get(o.id);
  if (hit && Date.now() - hit.at < 20_000) return { status: hit.ok ? 'ready' : 'error', detail: hit.text };
  let r: { at: number; text: string; ok: boolean };
  try { const s = scanHttp(c.folder); r = { at: Date.now(), ok: true, text: `${s.files.reduce((n, f) => n + f.requests.length, 0)} requests in ${s.files.length} files` }; }
  catch (e) { r = { at: Date.now(), ok: false, text: e instanceof Error ? e.message : 'unreadable' }; }
  counts.set(o.id, r);
  return { status: r.ok ? 'ready' : 'error', detail: r.text };
}

/** A cluster is what its members are: running when all are, starting while any is, an error when one failed or only some are up. */
function clusterState(o: ObjectRow): ObjectState {
  const members = (o.config as ClusterConfig).members.map((id) => ({ row: objectsStore.get(id), state: states.get(id) })).filter((m) => m.row);
  if (!members.length) return { status: 'stopped', detail: 'no members' };
  const by = (s: string) => members.filter((m) => m.state?.status === s);
  const up = by('running').length, total = members.length;
  const names = (list: typeof members) => list.map((m) => m.row!.name).join(', ');
  if (by('error').length) return { status: 'error', detail: `${names(by('error'))} failed · ${up}/${total} running` };
  if (by('starting').length) return { status: 'starting', detail: `${up}/${total} running` };
  if (up === total) return { status: 'running', detail: `${up}/${total} running` };
  if (up === 0) return { status: 'stopped', detail: `0/${total} running` };
  return { status: 'error', detail: `only ${up}/${total} running · stopped: ${names(members.filter((m) => m.state?.status !== 'running'))}` };
}

/** The state of a server after what it is configured to do by itself (restart it, check its health, trim its log). */
async function serverStateSupervised(o: ObjectRow): Promise<ObjectState> {
  const cfg = o.config as ServerConfig;
  const base = await serverState(o.id, cfg);
  return supervise(o, cfg, base, { start: () => startServer(o.id, cfg), restart: async () => { await stopServer(o.id, cfg); await startServer(o.id, cfg); } });
}

export async function stateOf(o: ObjectRow): Promise<ObjectState> {
  const s = o.kind === 'server' ? await serverStateSupervised(o)
    : o.kind === 'docker' ? await dockerState(o.id, o.config as DockerConfig)
    : o.kind === 'http' ? httpState(o) : o.kind === 'database' ? await dbState(o.id, o.config as DatabaseConfig) : clusterState(o);
  states.set(o.id, s);
  return s;
}

export async function refreshStates(): Promise<boolean> {
  const all = objectsStore.list();
  let diff = false;
  for (const id of [...states.keys()]) if (!all.some((o) => o.id === id)) { states.delete(id); diff = true; }
  // Clusters last: they are made of what the others just reported.
  const one = async (o: ObjectRow) => { const before = states.get(o.id); const now = await stateOf(o).catch((e): ObjectState => ({ status: 'unknown', detail: e instanceof Error ? e.message : 'failed' })); states.set(o.id, now); if (!same(before, now)) diff = true; };
  await Promise.all(all.filter((o) => o.kind !== 'cluster').map(one));
  for (const o of all.filter((x) => x.kind === 'cluster')) await one(o);
  return diff;
}

export const viewOf = (o: ObjectRow, links = objectsStore.links()): ObjectView => ({ ...maskConfig(o), state: states.get(o.id) ?? { status: 'unknown', detail: 'checking…' }, agent_ids: links.get(o.id) ?? [] });
export const listObjects = (): ObjectView[] => { const links = objectsStore.links(); return objectsStore.list().map((o) => viewOf(o, links)); };

let timer: ReturnType<typeof setInterval> | undefined, busy = false;
/** Checks the objects every few seconds and tells the interface when one changed (it fetches the list again). */
export function armObjects(): void {
  if (timer) return;
  const tick = async () => { if (busy) return; busy = true; try { if (await refreshStates()) changed(); } finally { busy = false; } };
  void tick();
  timer = setInterval(() => void tick(), POLL_MS); timer.unref?.();
}

const get = (id: string): ObjectRow => objectsStore.get(id) ?? (() => { throw new ObjectError('Resource not found'); })();

/** Starts, stops or restarts one server or container. */
async function act(o: ObjectRow, action: 'start' | 'stop' | 'restart'): Promise<void> {
  if (o.kind === 'server') {
    resetSupervision(o.id);                  // a person decided: the automatic restarts start over
    const c = o.config as ServerConfig;
    if (action === 'start') await startServer(o.id, c);
    else if (action === 'stop') await stopServer(o.id, c);
    else { await stopServer(o.id, c); await startServer(o.id, c); }
  } else {
    const c = o.config as DockerConfig;
    if (action === 'start') await startDocker(o.id, c); else if (action === 'stop') await stopDocker(o.id, c); else await restartDocker(o.id, c);
  }
}

/**
 * Members of a cluster one after another: start in the order they are listed, stop in the opposite order (what depends on the others goes
 * first and last). One failing does not keep the rest from being tried; the failures are reported together.
 */
async function actOnCluster(o: ObjectRow, action: 'start' | 'stop' | 'restart'): Promise<void> {
  const members = (o.config as ClusterConfig).members.map((id) => objectsStore.get(id)).filter((m): m is ObjectRow => !!m);
  const errors: string[] = [];
  const each = async (list: ObjectRow[], what: 'start' | 'stop') => {
    for (const m of list) {
      try {
        const now = await stateOf(m);
        if (what === 'start' && (now.status === 'running' || now.status === 'starting')) continue;       // already up
        await act(m, what);
      } catch (e) { errors.push(`${m.name}: ${e instanceof Error ? e.message : 'failed'}`); }
    }
  };
  if (action === 'start') await each(members, 'start');
  else if (action === 'stop') await each([...members].reverse(), 'stop');
  else { await each([...members].reverse(), 'stop'); await each(members, 'start'); }
  if (errors.length) throw new ObjectError(errors.join(' · '));
}

export async function objectAction(id: string, action: unknown): Promise<ObjectView> {
  const o = get(id);
  if (action === 'recreate' || action === 'rebuild') {
    if (o.kind !== 'docker') throw new ObjectError('Only a Docker resource can be created again');
    try { await recreateDocker(o.id, o.config as DockerConfig, action === 'rebuild'); }
    finally { await refreshStates().catch(() => undefined); changed(); }
    return viewOf(o);
  }
  if (action !== 'start' && action !== 'stop' && action !== 'restart') throw new ObjectError('Unknown action');
  if (o.kind === 'http') throw new ObjectError('HTTP requests are not started or stopped: open them and run a request.');
  if (o.kind === 'database') throw new ObjectError('A database is not started or stopped: open it and run a query.');
  try { if (o.kind === 'cluster') await actOnCluster(o, action); else await act(o, action); }
  finally { await refreshStates().catch(() => undefined); changed(); }
  return viewOf(o);
}

/** The configuration of a container (or of one service of a compose project) as Docker reports it. */
export async function objectInspect(id: string, service?: string) {
  const o = get(id);
  if (o.kind !== 'docker') throw new ObjectError('Only a Docker resource can be inspected');
  return inspectDocker(o.id, o.config as DockerConfig, service);
}

export { listTemplates };

/** Writes the compose file of a template under the data folder and makes it a Docker object (it is not started: the first run may pull images). */
export function createFromTemplate(p: { template: unknown; name: unknown; values?: unknown; colony_id?: unknown }): ObjectView {
  const name = String(p.name ?? '').trim();
  if (!name) throw new ObjectError('The name is required');
  const compose = renderTemplate(String(p.template ?? ''), (p.values && typeof p.values === 'object' ? p.values : {}) as Record<string, unknown>);
  const slug = name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || String(p.template);
  const dir = join(DATA_DIR, 'stacks', slug);
  if (existsSync(dir)) throw new ObjectError(`There is already a stack called "${slug}"`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'docker-compose.yml');
  writeFileSync(file, compose, { encoding: 'utf8', flag: 'wx' });
  try { return createObject({ name, kind: 'docker', colony_id: (p.colony_id as string) || null, config: { mode: 'compose', file, project: `hive-${slug}` } }); }
  catch (e) { rmSync(dir, { recursive: true, force: true }); throw e; }
}

/** One service of a compose project (start, stop, restart), without touching the others. */
export async function objectServiceAction(id: string, service: unknown, action: unknown): Promise<ObjectView> {
  const o = get(id);
  if (o.kind !== 'docker') throw new ObjectError('Only a compose project has services');
  if (!['start', 'stop', 'restart', 'recreate', 'rebuild'].includes(String(action))) throw new ObjectError('Unknown action');
  try { await composeServiceAction(o.config as DockerConfig, String(service ?? ''), action as DockerAction); }
  finally { await refreshStates().catch(() => undefined); changed(); }
  return viewOf(o);
}

/**
 * The latest output. A cluster reads all its members and puts `[name]` in front of each line; its cursor is the cursors of the members
 * together (a JSON text), so a following call returns only what each of them printed since.
 */
export async function objectLogs(id: string, q: { tail?: number; after?: string }): Promise<{ text: string; cursor: string; reset?: boolean }> {
  const o = get(id);
  if (o.kind === 'http' || o.kind === 'database') return { text: '', cursor: '' };
  if (o.kind === 'cluster') {
    const members = (o.config as ClusterConfig).members.map((m) => objectsStore.get(m)).filter((m): m is ObjectRow => !!m);
    let before: Record<string, string> = {}; try { before = q.after ? JSON.parse(q.after) : {}; } catch { /* a fresh start */ }
    const per = Math.max(15, Math.ceil((q.tail ?? 300) / Math.max(1, members.length)));
    const parts = await Promise.all(members.map(async (m) => {
      const r = await objectLogs(m.id, before[m.id] !== undefined ? { after: before[m.id] } : { tail: per }).catch(() => ({ text: '', cursor: before[m.id] ?? '' }));
      return { m, r };
    }));
    const text = parts.map(({ m, r }) => r.text.split('\n').filter((l) => l.trim()).map((l) => `[${m.name}] ${l}`).join('\n')).filter(Boolean).join('\n');
    return { text, cursor: JSON.stringify(Object.fromEntries(parts.map(({ m, r }) => [m.id, r.cursor]))) };
  }
  if (o.kind === 'server') return serverLogs(o.id, { tail: q.tail, after: q.after !== undefined && q.after !== '' ? Number(q.after) : undefined });
  return dockerLogs(o.id, o.config as DockerConfig, q);
}

export const statsOf = async (id: string) => { const { objectStats } = await import('./stats.js'); return objectStats(get(id)); };

/** The requests of an HTTP object, and running one of them. */
export const httpScan = (id: string) => { const o = get(id); if (o.kind !== 'http') throw new ObjectError('That is not an HTTP resource'); return scanHttp((o.config as HttpConfig).folder, (o.config as HttpConfig).variables); };
export const httpDescribe = (id: string, file: string, index: number, env?: string) => { const o = get(id); if (o.kind !== 'http') throw new ObjectError('That is not an HTTP resource'); return describeHttp((o.config as HttpConfig).folder, file, index, env ?? (o.config as HttpConfig).env, (o.config as HttpConfig).variables, sessionOf(o.id)); };
export const httpRun = async (id: string, file: string, index: number, env?: string) => {
  const o = get(id); if (o.kind !== 'http') throw new ObjectError('That is not an HTTP resource');
  const cfg = o.config as HttpConfig, useEnv = env ?? cfg.env ?? '';
  let name = `#${index}`, method = '';
  try { const it = parseHttpFile(readHttpFile(cfg.folder, file), file).requests[index]; if (it) { name = it.name; method = it.method; } } catch { /* the run reports it */ }
  try {
    const run = await runHttp(cfg.folder, file, index, useEnv || undefined, cfg.variables, sessionOf(o.id));
    recordRun(id, { file, index, name, method, env: useEnv, run });
    return run;
  } catch (e) { recordRun(id, { file, index, name, method, env: useEnv, error: e instanceof Error ? e.message : String(e) }); throw e; }
};
export const httpDocs = (id: string, format: 'markdown' | 'postman', file?: string) => {
  const o = httpObjectOf(id);
  const hist = listHistory(id);
  return exportCollection((o.config as HttpConfig).folder, o.name, format, file || undefined, (f, i) => { const h = hist.find((x) => x.file === f && x.index === i && x.run && x.run.status < 400 && !x.run.binary); return h?.run ? { status: h.run.status, contentType: h.run.contentType, body: h.run.body } : undefined; });
};
export const httpHistory = (id: string) => { httpObjectOf(id); return listHistory(id); };
export const httpHistoryClear = (id: string) => { httpObjectOf(id); clearHistory(id); return []; };

export const httpInspect = (id: string, file: string | undefined, index: number | undefined, env?: string) => { const o = get(id); if (o.kind !== 'http') throw new ObjectError('That is not an HTTP resource'); return inspectHttp((o.config as HttpConfig).folder, file, index, env ?? (o.config as HttpConfig).env, (o.config as HttpConfig).variables, sessionOf(o.id)); };
export const httpExport = (id: string, file: string, index: number, format: ExportFormat, env?: string, redact = false) => { const o = get(id); if (o.kind !== 'http') throw new ObjectError('That is not an HTTP resource'); return exportHttp((o.config as HttpConfig).folder, file, index, format, env ?? (o.config as HttpConfig).env, (o.config as HttpConfig).variables, sessionOf(o.id), redact); };
export const httpFileRead = (id: string, file: string) => { const o = get(id); if (o.kind !== 'http') throw new ObjectError('That is not an HTTP resource'); return { file, content: readHttpFile((o.config as HttpConfig).folder, file) }; };
export const httpFileCreate = (id: string, file: string, content: string) => { const o = get(id); if (o.kind !== 'http') throw new ObjectError('That is not an HTTP resource'); return { file: createHttpFile((o.config as HttpConfig).folder, file, content) }; };
export const httpFileWrite = (id: string, file: string, content: string) => { const o = get(id); if (o.kind !== 'http') throw new ObjectError('That is not an HTTP resource'); writeHttpFile((o.config as HttpConfig).folder, file, content); return { ok: true }; };

/** The values kept while an HTTP object is used (see http.ts): look at them, set one, forget one or all. */
const httpObjectOf = (id: string) => { const o = get(id); if (o.kind !== 'http') throw new ObjectError('That is not an HTTP resource'); return o; };
const httpObject = (id: string) => { const o = get(id); if (o.kind !== 'http') throw new ObjectError('That is not an HTTP resource'); return o; };
export const httpSession = (id: string) => sessionView(httpObject(id).id);
export const httpSessionSet = (id: string, name: string, value: string) => { sessionSet(httpObject(id).id, name, value); return sessionView(id); };
export const httpSessionClear = (id: string, name?: string) => { sessionClear(httpObject(id).id, name); return sessionView(id); };

/** A database object: what its connection can show and run (see database.ts). Reading the schema or running a query uses the saved password. */
const dbOf = (id: string) => { const o = get(id); if (o.kind !== 'database') throw new ObjectError('That is not a database resource'); return { o, cfg: o.config as DatabaseConfig }; };
export const dbSchemaOf = (id: string, database?: string) => dbSchema(dbOf(id).cfg, database);
export const dbColumnsOf = (id: string, p: { database?: string; schema: string; table: string }) => dbColumns(dbOf(id).cfg, p);
export async function dbRun(id: string, p: { sql: string; database?: string }) {
  const { cfg } = dbOf(id);
  try {
    const r = await dbQuery(cfg, p);
    recordQuery(id, { sql: p.sql, database: p.database, ok: true, ms: r.ms, rows: r.columns.length ? r.rows.length : undefined, affected: r.affected });
    return r;
  } catch (e) { recordQuery(id, { sql: p.sql, database: p.database, ok: false, ms: 0, error: e instanceof Error ? e.message : 'failed' }); throw e; }
}
export const dbHistory = (id: string) => { dbOf(id); return listQueries(id); };
export const dbHistoryClear = (id: string) => { dbOf(id); clearQueries(id); return []; };
export const dbSavedList = (id: string) => { dbOf(id); return listSaved(id); };
export const dbSavedAdd = (id: string, p: { name?: unknown; sql?: unknown; database?: unknown }) => {
  dbOf(id); const name = String(p.name ?? '').trim().slice(0, 80), sql = String(p.sql ?? '');
  if (!name || !sql.trim()) throw new ObjectError('Give the query a name and some text');
  try { return addSaved(id, { name, sql, database: p.database ? String(p.database) : undefined }); } catch (e) { throw new ObjectError(e instanceof Error ? e.message : 'could not save'); }
};
export const dbSavedUpdate = (id: string, savedId: string, p: { name?: unknown; sql?: unknown; database?: unknown }) => {
  dbOf(id);
  const name = p.name === undefined ? undefined : String(p.name).trim().slice(0, 80), sql = p.sql === undefined ? undefined : String(p.sql);
  if (name === '' || (sql !== undefined && !sql.trim())) throw new ObjectError('Give the query a name and some text');
  const e = updateSaved(id, savedId, { name, sql, database: p.database === undefined ? undefined : p.database ? String(p.database) : null });
  if (!e) throw new ObjectError('Saved query not found');
  return e;
};
export const dbSavedRemove = (id: string, savedId: string) => { dbOf(id); if (!removeSaved(id, savedId)) throw new ObjectError('Saved query not found'); return listSaved(id); };
/**
 * Links agents to a resource by hand (the ones of its own colony can already look after it). An agent that does not have the "Colony resources"
 * skill gets it, because without it the tools are not offered; the ids of the agents that were given the skill come back.
 */
export function setObjectAgents(id: string, agentIds: unknown): { object: ObjectView; skillAdded: string[] } {
  const o = get(id);
  if (!Array.isArray(agentIds)) throw new ObjectError('Choose the agents');
  const ids = [...new Set(agentIds.map(String))];
  const skillAdded: string[] = [];
  for (const a of ids) {
    const ag = agents.get(a); if (!ag) throw new ObjectError('One of the agents no longer exists');
    if (!resolved(ag).skill_ids.includes(OBJECTS_SKILL_ID)) { agents.setSkills(a, [...ag.skill_ids, OBJECTS_SKILL_ID]); skillAdded.push(a); }
  }
  objectsStore.setAgents(id, ids); changed();
  return { object: viewOf(o), skillAdded };
}
/** Tries a connection before it is saved: the config comes from the form; an empty password means the one already saved (of that object). */
export async function dbTestConfig(p: { id?: unknown; config?: unknown }) {
  const raw: Record<string, unknown> = { ...((p.config ?? {}) as Record<string, unknown>) };
  if (p.id && !raw.password) { const o = objectsStore.get(String(p.id)); if (o?.kind === 'database' && (o.config as DatabaseConfig).engine === raw.engine) raw.password = (o.config as DatabaseConfig).password; }
  const cfg = parseDatabase(raw);
  const r = await dbTest(cfg);
  return r;
}

/** Deleting an object also removes what hive-am made for it (see docker.ts for what is left alone). */
export async function removeObject(id: string): Promise<boolean> {
  const o = objectsStore.get(id); if (!o) return false;
  if (o.kind === 'server') { await stopServer(o.id, o.config as ServerConfig).catch(() => undefined); forgetServer(o.id); }
  else if (o.kind === 'docker') await removeDocker(o.id, o.config as DockerConfig);
  states.delete(id); counts.delete(id); forgetSupervision(id); dropSession(id); clearHistory(id); forgetDatabase(id); forgetQueries(id);
  const ok = objectsStore.remove(id); changed();
  return ok;
}

export const createObject = (p: Parameters<typeof objectsStore.create>[0]) => { const o = objectsStore.create(p); void stateOf(o).then(changed); changed(); return viewOf(o); };
export const updateObject = (id: string, p: Parameters<typeof objectsStore.update>[1]) => { const o = objectsStore.update(id, p); forgetDatabase(id); void stateOf(o).then(changed); changed(); return viewOf(o); };
