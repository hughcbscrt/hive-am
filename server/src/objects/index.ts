import { bus } from '../runtime.js';
import { dockerLogs, dockerState, removeDocker, restartDocker, startDocker, stopDocker } from './docker.js';
import { describeHttp, httpCount, runHttp, scanHttp } from './http.js';
import { ObjectError, type BossConfig, type DockerConfig, type HttpConfig, type ObjectRow, type ObjectState, type ObjectView, type ServerConfig } from './model.js';
import { forgetServer, serverLogs, serverState, startServer, stopServer } from './runner.js';
import { objectsStore } from './store.js';

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

/** A boss is what its members are: running when all are, starting while any is, an error when one failed or only some are up. */
function bossState(o: ObjectRow): ObjectState {
  const members = (o.config as BossConfig).members.map((id) => ({ row: objectsStore.get(id), state: states.get(id) })).filter((m) => m.row);
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

export async function stateOf(o: ObjectRow): Promise<ObjectState> {
  const s = o.kind === 'server' ? await serverState(o.id, o.config as ServerConfig)
    : o.kind === 'docker' ? await dockerState(o.id, o.config as DockerConfig)
    : o.kind === 'http' ? httpState(o) : bossState(o);
  states.set(o.id, s);
  return s;
}

export async function refreshStates(): Promise<boolean> {
  const all = objectsStore.list();
  let diff = false;
  for (const id of [...states.keys()]) if (!all.some((o) => o.id === id)) { states.delete(id); diff = true; }
  // Bosses last: they are made of what the others just reported.
  const one = async (o: ObjectRow) => { const before = states.get(o.id); const now = await stateOf(o).catch((e): ObjectState => ({ status: 'unknown', detail: e instanceof Error ? e.message : 'failed' })); states.set(o.id, now); if (!same(before, now)) diff = true; };
  await Promise.all(all.filter((o) => o.kind !== 'boss').map(one));
  for (const o of all.filter((x) => x.kind === 'boss')) await one(o);
  return diff;
}

export const viewOf = (o: ObjectRow): ObjectView => ({ ...o, state: states.get(o.id) ?? { status: 'unknown', detail: 'checking…' } });
export const listObjects = (): ObjectView[] => objectsStore.list().map(viewOf);

let timer: ReturnType<typeof setInterval> | undefined, busy = false;
/** Checks the objects every few seconds and tells the interface when one changed (it fetches the list again). */
export function armObjects(): void {
  if (timer) return;
  const tick = async () => { if (busy) return; busy = true; try { if (await refreshStates()) changed(); } finally { busy = false; } };
  void tick();
  timer = setInterval(() => void tick(), POLL_MS); timer.unref?.();
}

const get = (id: string): ObjectRow => objectsStore.get(id) ?? (() => { throw new ObjectError('Object not found'); })();

/** Starts, stops or restarts one server or container. */
async function act(o: ObjectRow, action: 'start' | 'stop' | 'restart'): Promise<void> {
  if (o.kind === 'server') {
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
 * Members of a boss one after another: start in the order they are listed, stop in the opposite order (what depends on the others goes
 * first and last). One failing does not keep the rest from being tried; the failures are reported together.
 */
async function actOnBoss(o: ObjectRow, action: 'start' | 'stop' | 'restart'): Promise<void> {
  const members = (o.config as BossConfig).members.map((id) => objectsStore.get(id)).filter((m): m is ObjectRow => !!m);
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
  if (action !== 'start' && action !== 'stop' && action !== 'restart') throw new ObjectError('Unknown action');
  if (o.kind === 'http') throw new ObjectError('HTTP requests are not started or stopped: open them and run a request.');
  try { if (o.kind === 'boss') await actOnBoss(o, action); else await act(o, action); }
  finally { await refreshStates().catch(() => undefined); changed(); }
  return viewOf(o);
}

/**
 * The latest output. A boss reads all its members and puts `[name]` in front of each line; its cursor is the cursors of the members
 * together (a JSON text), so a following call returns only what each of them printed since.
 */
export async function objectLogs(id: string, q: { tail?: number; after?: string }): Promise<{ text: string; cursor: string; reset?: boolean }> {
  const o = get(id);
  if (o.kind === 'http') return { text: '', cursor: '' };
  if (o.kind === 'boss') {
    const members = (o.config as BossConfig).members.map((m) => objectsStore.get(m)).filter((m): m is ObjectRow => !!m);
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
export const httpScan = (id: string) => { const o = get(id); if (o.kind !== 'http') throw new ObjectError('That is not an HTTP object'); return scanHttp((o.config as HttpConfig).folder); };
export const httpDescribe = (id: string, file: string, index: number, env?: string) => { const o = get(id); if (o.kind !== 'http') throw new ObjectError('That is not an HTTP object'); return describeHttp((o.config as HttpConfig).folder, file, index, env ?? (o.config as HttpConfig).env); };
export const httpRun = (id: string, file: string, index: number, env?: string) => { const o = get(id); if (o.kind !== 'http') throw new ObjectError('That is not an HTTP object'); return runHttp((o.config as HttpConfig).folder, file, index, env ?? (o.config as HttpConfig).env); };

/** Deleting an object also removes what hive-am made for it (see docker.ts for what is left alone). */
export async function removeObject(id: string): Promise<boolean> {
  const o = objectsStore.get(id); if (!o) return false;
  if (o.kind === 'server') { await stopServer(o.id, o.config as ServerConfig).catch(() => undefined); forgetServer(o.id); }
  else if (o.kind === 'docker') await removeDocker(o.id, o.config as DockerConfig);
  states.delete(id); counts.delete(id);
  const ok = objectsStore.remove(id); changed();
  return ok;
}

export const createObject = (p: Parameters<typeof objectsStore.create>[0]) => { const o = objectsStore.create(p); void stateOf(o).then(changed); changed(); return viewOf(o); };
export const updateObject = (id: string, p: Parameters<typeof objectsStore.update>[1]) => { const o = objectsStore.update(id, p); void stateOf(o).then(changed); changed(); return viewOf(o); };
