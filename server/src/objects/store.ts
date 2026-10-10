import { randomUUID } from 'node:crypto';
import { colonies, db } from '../db.js';
import { ObjectError, kindOf, type HttpConfig, parseConfig, parseName, isKind, type ClusterConfig, type ObjectKind, type ObjectRow } from './model.js';

db.exec(`
CREATE TABLE IF NOT EXISTS colony_objects (
  id TEXT PRIMARY KEY, colony_id TEXT REFERENCES colonies(id) ON DELETE SET NULL,
  kind TEXT NOT NULL, name TEXT NOT NULL UNIQUE COLLATE NOCASE, config TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);`);

// The first name of a cluster was `boss`.
db.exec("UPDATE colony_objects SET kind='cluster' WHERE kind='boss'");

/** The secret values of an HTTP object stay on the server: what the interface receives has them empty (and `set` says there is one). */
export function maskConfig(o: ObjectRow): ObjectRow {
  if (o.kind !== 'http') return o;
  const c = o.config as HttpConfig; if (!c.variables) return o;
  const variables = Object.fromEntries(Object.entries(c.variables).map(([env, vars]) => [env, Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v.secret ? { value: '', secret: true, set: v.value !== '' } : v]))]));
  return { ...o, config: { ...c, variables } };
}
/** Saving a secret that was left empty keeps the value that was already stored. */
function keepSecrets(old: HttpConfig | undefined, incoming: any) {
  for (const [env, vars] of Object.entries((incoming?.variables ?? {}) as Record<string, Record<string, any>>)) {
    for (const [k, v] of Object.entries(vars ?? {})) if (v?.secret && !v.value && old?.variables?.[env]?.[k]?.secret) v.value = old.variables[env][k].value;
  }
}

const row = (r: any): ObjectRow => ({ ...r, config: JSON.parse(r.config) });

/** A cluster groups servers and containers of its own colony; nothing else, and not itself. */
function checkMembers(kind: string, colony: string | null, config: unknown, selfId?: string) {
  if (kind !== 'cluster') return;
  for (const id of (config as ClusterConfig).members) {
    const m = objectsStore.get(id);
    if (!m || m.id === selfId) throw new ObjectError('One of the objects it groups does not exist');
    if (m.kind !== 'server' && m.kind !== 'docker') throw new ObjectError(`"${m.name}" cannot be grouped: only servers and Docker containers can`);
    if ((m.colony_id ?? null) !== (colony ?? null)) throw new ObjectError(`"${m.name}" is not in the same colony as the cluster`);
  }
}

export const objectsStore = {
  list: () => (db.prepare('SELECT * FROM colony_objects ORDER BY name').all() as any[]).map(row),
  get(id: string) { const r = db.prepare('SELECT * FROM colony_objects WHERE id=?').get(id); return r ? row(r) : undefined; },
  byName(name: string) { const r = db.prepare('SELECT * FROM colony_objects WHERE name=?').get(name); return r ? row(r) : undefined; },
  create(input: { name: unknown; kind: unknown; colony_id?: unknown; config: unknown }): ObjectRow {
    const p = { ...input, kind: kindOf(input.kind) };
    if (!isKind(p.kind)) throw new ObjectError('Unknown kind of object');
    const name = parseName(p.name), config = parseConfig(p.kind, p.config);
    if (objectsStore.byName(name)) throw new ObjectError(`There is already an object named "${name}"`);
    const colony = p.colony_id ? String(p.colony_id) : null;
    if (colony && !colonies.get(colony)) throw new ObjectError('That colony no longer exists');
    checkMembers(p.kind, colony, config);
    const id = randomUUID(), now = Date.now();
    db.prepare('INSERT INTO colony_objects (id,colony_id,kind,name,config,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id, colony, p.kind, name, JSON.stringify(config), now, now);
    return objectsStore.get(id)!;
  },
  update(id: string, p: { name?: unknown; colony_id?: unknown; config?: unknown }): ObjectRow {
    const cur = objectsStore.get(id); if (!cur) throw new ObjectError('Object not found');
    const name = p.name !== undefined ? parseName(p.name) : cur.name;
    const other = objectsStore.byName(name);
    if (other && other.id !== id) throw new ObjectError(`There is already an object named "${name}"`);
    if (cur.kind === 'http' && p.config) keepSecrets(cur.config as HttpConfig, p.config);
    const config = p.config !== undefined ? parseConfig(cur.kind as ObjectKind, p.config) : cur.config;
    const colony = p.colony_id === undefined ? cur.colony_id : p.colony_id ? String(p.colony_id) : null;
    if (colony && !colonies.get(colony)) throw new ObjectError('That colony no longer exists');
    checkMembers(cur.kind, colony, config, id);
    // Moving an object to another colony takes it out of the clusters it was grouped by.
    if (colony !== cur.colony_id) objectsStore.ungroup(id);
    db.prepare('UPDATE colony_objects SET name=?, colony_id=?, config=?, updated_at=? WHERE id=?').run(name, colony, JSON.stringify(config), Date.now(), id);
    return objectsStore.get(id)!;
  },
  /** Takes an object out of every cluster that groups it. */
  ungroup(id: string) {
    for (const b of objectsStore.list().filter((x) => x.kind === 'cluster' && (x.config as ClusterConfig).members.includes(id))) {
      db.prepare('UPDATE colony_objects SET config=?, updated_at=? WHERE id=?').run(JSON.stringify({ members: (b.config as ClusterConfig).members.filter((m) => m !== id) }), Date.now(), b.id);
    }
  },
  remove(id: string) { objectsStore.ungroup(id); return db.prepare('DELETE FROM colony_objects WHERE id=?').run(id).changes > 0; },
};
