import { bus } from '../runtime.js';
import { dockerLogs, dockerState, removeDocker, restartDocker, startDocker, stopDocker } from './docker.js';
import { ObjectError, type DockerConfig, type ObjectRow, type ObjectState, type ObjectView, type ServerConfig } from './model.js';
import { forgetServer, serverLogs, serverState, startServer, stopServer } from './runner.js';
import { objectsStore } from './store.js';

export { ObjectError } from './model.js';
export { objectsStore } from './store.js';

/** Last known state of each object, refreshed in the background so listing never waits on `docker` or a port check. */
const states = new Map<string, ObjectState>();
const POLL_MS = Number(process.env.HIVE_AM_OBJECT_POLL_MS) || 3000;
const changed = () => bus.emit('msg', { kind: 'objects_changed' });
const same = (a?: ObjectState, b?: ObjectState) => !!a && !!b && a.status === b.status && a.detail === b.detail && a.pid === b.pid;

export async function stateOf(o: ObjectRow): Promise<ObjectState> {
  const s = o.kind === 'server' ? await serverState(o.id, o.config as ServerConfig) : await dockerState(o.id, o.config as DockerConfig);
  states.set(o.id, s);
  return s;
}

export async function refreshStates(): Promise<boolean> {
  const all = objectsStore.list();
  let diff = false;
  for (const id of [...states.keys()]) if (!all.some((o) => o.id === id)) { states.delete(id); diff = true; }
  await Promise.all(all.map(async (o) => { const before = states.get(o.id); const now = await stateOf(o).catch((e): ObjectState => ({ status: 'unknown', detail: e instanceof Error ? e.message : 'failed' })); states.set(o.id, now); if (!same(before, now)) diff = true; }));
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

export async function objectAction(id: string, action: unknown): Promise<ObjectView> {
  const o = get(id);
  if (action !== 'start' && action !== 'stop' && action !== 'restart') throw new ObjectError('Unknown action');
  if (o.kind === 'server') {
    const c = o.config as ServerConfig;
    if (action === 'start') await startServer(o.id, c);
    else if (action === 'stop') await stopServer(o.id, c);
    else { await stopServer(o.id, c); await startServer(o.id, c); }
  } else {
    const c = o.config as DockerConfig;
    if (action === 'start') await startDocker(o.id, c); else if (action === 'stop') await stopDocker(o.id, c); else await restartDocker(o.id, c);
  }
  await stateOf(o); changed();
  return viewOf(o);
}

export async function objectLogs(id: string, q: { tail?: number; after?: string }): Promise<{ text: string; cursor: string; reset?: boolean }> {
  const o = get(id);
  if (o.kind === 'server') return serverLogs(o.id, { tail: q.tail, after: q.after !== undefined && q.after !== '' ? Number(q.after) : undefined });
  return dockerLogs(o.id, o.config as DockerConfig, q);
}

/** Deleting an object also removes what hive-am made for it (see docker.ts for what is left alone). */
export async function removeObject(id: string): Promise<boolean> {
  const o = objectsStore.get(id); if (!o) return false;
  if (o.kind === 'server') { await stopServer(o.id, o.config as ServerConfig).catch(() => undefined); forgetServer(o.id); }
  else await removeDocker(o.id, o.config as DockerConfig);
  states.delete(id);
  const ok = objectsStore.remove(id); changed();
  return ok;
}

export const createObject = (p: Parameters<typeof objectsStore.create>[0]) => { const o = objectsStore.create(p); void stateOf(o).then(changed); changed(); return viewOf(o); };
export const updateObject = (id: string, p: Parameters<typeof objectsStore.update>[1]) => { const o = objectsStore.update(id, p); void stateOf(o).then(changed); changed(); return viewOf(o); };
