import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { agents, resolved } from '../db.js';
import { mcpCaps } from '../instructions.js';
import { dbColumns, dbDdl, dbDescribe, dbExec, dbExplain, dbKill, dbQuery, dbSample, dbSchema, dbSearch, dbSessions, dbTest, isDestructive, maskSecretsInSql, assertReadOnly, type DbResult } from './database.js';
import { addSaved, clearQueries, listQueries, listSaved, recordQuery, removeSaved, updateSaved } from './db-history.js';
import { createObject, listObjects, removeObject, setObjectManager, updateObject } from './index.js';
import { ObjectError, parseDatabase, type DatabaseConfig, type ObjectView } from './model.js';
import { objectsStore } from './store.js';

/**
 * What an agent with the "Database management" skill can do with a database resource: look at its structure, run SQL, keep saved queries,
 * and, with Full access, change how it connects, create and delete database resources. The rules are enforced here, not just written in the skill:
 *  - only the databases the agent looks after (the chosen manager, or the agents of the colony when none was chosen); a foreign or unknown
 *    one looks the same as one that does not exist;
 *  - what the agent may do depends on its effective permission (see the table in `need`), and `readOnly` of the resource, a setting of the person's panel, does not apply to it;
 *  - DROP and TRUNCATE need Full access;
 *  - a password can be written but never read back: nothing that leaves here carries one.
 */
type Level = 'read' | 'write' | 'admin';
type Args = Record<string, any>;

function whoAsks(from: unknown) {
  const a = typeof from === 'string' ? agents.get(from) : undefined;
  if (!a) throw new ObjectError('Unknown agent');
  if (!mcpCaps(resolved(a)).includes('databases')) throw new ObjectError('You do not have the "Database management" skill.');
  return a;
}
type Asker = ReturnType<typeof whoAsks>;
const visibleTo = (a: { id: string; colony_id: string | null }) => (o: ObjectView) => (o.manager_id ? o.manager_id === a.id : (o.colony_id ?? null) === (a.colony_id ?? null));

function pick(a: Asker, name: unknown): ObjectView {
  const wanted = String(name ?? '').trim().toLowerCase();
  const o = listObjects().filter(visibleTo(a)).find((x) => x.name.toLowerCase() === wanted);
  if (!o) throw new ObjectError(`There is no resource named "${String(name ?? '')}" for you. Call object_db_list for the names.`);
  if (o.kind !== 'database') throw new ObjectError(`"${o.name}" is not a database resource.`);
  return o;
}
const stored = (o: ObjectView) => objectsStore.get(o.id)!.config as DatabaseConfig;

/** Permission table: read = everyone (plan too); write = acceptEdits and Full access; admin = Full access only. The permission that counts is the effective one. */
function need(a: Asker, level: Level, what: string): void {
  const p = a.effective.permission;
  if (level === 'read') return;
  if (p === 'plan') throw new ObjectError(`You are read-only: you can look at the database but not ${what}.`);
  if (level === 'admin' && p !== 'bypassPermissions') throw new ObjectError(`${what[0].toUpperCase()}${what.slice(1)} needs Full access.`);
}
const refuseDestructive = (a: Asker, sql: string) => { if (a.effective.permission !== 'bypassPermissions' && isDestructive(sql)) throw new ObjectError('DROP and TRUNCATE need Full access.'); };

const clean = (s: unknown) => maskSecretsInSql(String(s ?? ''));
const fail = (e: unknown): never => { throw e instanceof ObjectError ? new ObjectError(clean(e.message)) : new ObjectError(clean(e instanceof Error ? e.message : 'the database failed')); };

/** Runs something that touches the data and leaves the record a person can read: the history of the resource and a line in the server log. */
async function audited<T extends { ms?: number; rows?: unknown[][]; columns?: unknown[]; affected?: number }>(a: Asker, o: ObjectView, sql: string, database: string | undefined, run: () => Promise<T>): Promise<T> {
  const text = maskSecretsInSql(sql);
  console.log(`[hive-am] ${a.name} ran ${text.replace(/\s+/g, ' ').trim().slice(0, 200)}`);
  try {
    const r = await run();
    recordQuery(o.id, { sql: text, database, ok: true, ms: r.ms ?? 0, rows: r.columns?.length ? r.rows?.length : undefined, affected: r.affected, by: a.name });
    return r;
  } catch (e) {
    const msg = clean(e instanceof Error ? e.message : 'failed');
    recordQuery(o.id, { sql: text, database, ok: false, ms: 0, error: msg, by: a.name });
    return fail(e);
  }
}

const database = (args: Args) => (args.database === undefined || args.database === null || args.database === '' ? undefined : String(args.database));
const sqlOf = (args: Args) => { if (typeof args.sql !== 'string' || !args.sql.trim()) throw new ObjectError('Write the SQL'); return args.sql; };

/** `mine` is the agent's own colony, `none` is no colony. Anything else must be the agent's own colony id: an agent does not put resources into other colonies. */
function colonyArg(a: Asker, v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === '' || s === 'none' || s === 'null') return null;
  if (s === 'mine' || s === (a.colony_id ?? '').toLowerCase()) return a.colony_id ?? null;
  throw new ObjectError('A database can only be in your own colony ("mine") or in none ("none").');
}
/** The agent that looks after a database: by name or id, `me`, or `none` for the colony. */
function managerArg(a: Asker, v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s || s.toLowerCase() === 'none') return null;
  if (s.toLowerCase() === 'me') return a.id;
  const m = agents.get(s) ?? agents.byName(s);
  if (!m) throw new ObjectError(`There is no agent "${s}"`);
  return m.id;
}

// ---- the operations --------------------------------------------------------------------------------------------------------------------

function toCsv(columns: { name: string }[], rows: unknown[][]): string {
  const q = (v: unknown) => { const t = v === null || v === undefined ? '' : String(v); return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return [columns.map((c) => q(c.name)).join(','), ...rows.map((r) => r.map(q).join(','))].join('\r\n') + '\r\n';
}
function toJson(columns: { name: string }[], rows: unknown[][]): string {
  const seen = new Map<string, number>();
  const keys = columns.map((c) => { const n = seen.get(c.name) ?? 0; seen.set(c.name, n + 1); return n ? `${c.name}_${n + 1}` : c.name; });
  return `${JSON.stringify(rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i]]))), null, 2)}\n`;
}

/** Writes a result as a file inside the agent's own folder: never outside it (a symlink included), and never over an existing file unless asked. */
function writeInside(a: Asker, file: unknown, overwrite: boolean, content: string): string {
  const rel = String(file ?? '').trim();
  if (!rel) throw new ObjectError('Say which file to write');
  const root = realpathSync(a.effective.cwd);
  const target = resolve(root, rel);
  const inside = (p: string) => p === root || p.startsWith(root + sep);
  if (isAbsolute(rel) ? !inside(resolve(rel)) : !inside(target)) throw new ObjectError('The file has to be inside your own working folder.');
  const dir = dirname(target);
  mkdirSync(dir, { recursive: true });
  if (!inside(realpathSync(dir))) throw new ObjectError('The file has to be inside your own working folder.');
  if (existsSync(target) && !overwrite) throw new ObjectError(`${relative(root, target)} already exists: choose another name or pass overwrite: true.`);
  writeFileSync(target, content, { flag: overwrite ? 'w' : 'wx' });
  return relative(root, target);
}

export async function agentDb(op: unknown, body: Args): Promise<unknown> {
  const a = whoAsks(body.from);
  const args: Args = { ...body }; delete args.from;
  const o = String(op ?? '');

  // Operations that do not start from an existing database.
  if (o === 'list') {
    return { databases: listObjects().filter(visibleTo(a)).filter((x) => x.kind === 'database').map((x) => { const c = x.config as DatabaseConfig; return { name: x.name, engine: c.engine, database: c.engine === 'sqlite' ? c.file : c.database ?? null, status: x.state.status, detail: x.state.detail ?? null }; }) };
  }
  if (o === 'create') {
    need(a, 'admin', 'creating a database resource');
    const cfg = parseDatabase(args.config);
    await dbTest(cfg).catch((e) => fail(e));
    const made = createObject({ name: args.name, kind: 'database', colony_id: colonyArg(a, args.colony_id ?? 'mine'), config: args.config });
    setObjectManager(made.id, a.id);
    return { name: made.name, engine: cfg.engine, created: true };
  }
  if (o === 'test' && args.config !== undefined && args.name === undefined) {
    need(a, 'admin', 'testing a connection that is not saved');
    const t = await dbTest(parseDatabase(args.config)).catch((e) => fail(e));
    return { ok: t.ok, version: t.version, ms: t.ms };
  }

  const view = pick(a, args.name);
  const cfg = stored(view);
  const db = database(args);

  switch (o) {
    // ---- discovery and reads ----
    case 'schema': return dbSchema(cfg, db).catch(fail);
    case 'columns': return { columns: await dbColumns(cfg, { database: db, schema: args.schema, table: args.table }).catch(fail) };
    case 'describe': return dbDescribe(cfg, { database: db, schema: args.schema, table: args.table }).catch(fail);
    case 'search': return { matches: await dbSearch(cfg, { database: db, query: args.query }).catch(fail) };
    case 'ddl': return { ddl: await dbDdl(cfg, { database: db, schema: args.schema, table: args.table }).catch(fail) };
    case 'sample': return dbSample(cfg, { database: db, schema: args.schema, table: args.table, limit: args.limit }).catch(fail);
    case 'explain': return dbExplain(cfg, { sql: sqlOf(args), database: db }).catch(fail);
    case 'test': { const t = await dbTest(cfg).catch((e) => fail(e)); return { ok: t.ok, version: t.version, ms: t.ms }; }
    case 'config': { const c = { ...cfg } as DatabaseConfig & { passwordSet?: boolean }; const has = !!c.password; delete c.password; return { name: view.name, colony_id: view.colony_id, manager_id: view.manager_id, config: { ...c, passwordSet: has } }; }

    // ---- queries ----
    case 'query': {
      const sql = sqlOf(args);
      if (a.effective.permission === 'plan') { try { assertReadOnly(sql); } catch { throw new ObjectError('You are read-only: only SELECT, WITH, SHOW, DESCRIBE and EXPLAIN are allowed.'); } }
      refuseDestructive(a, sql);
      return audited(a, view, sql, db, () => dbQuery(cfg, { sql, database: db, readOnly: a.effective.permission === 'plan' }));
    }
    case 'exec': {
      need(a, 'write', 'run a script');
      const sql = sqlOf(args);
      refuseDestructive(a, sql);
      return audited(a, view, sql, db, async () => { const r = await dbExec(cfg, { sql, database: db, readOnly: false }); return { ...r, rows: undefined as unknown[][] | undefined }; });
    }
    case 'export': {
      need(a, 'write', 'export to a file');
      const sql = sqlOf(args), format = String(args.format ?? 'csv').toLowerCase();
      if (format !== 'csv' && format !== 'json') throw new ObjectError('The format is csv or json');
      refuseDestructive(a, sql);
      const r: DbResult = await audited(a, view, sql, db, () => dbQuery(cfg, { sql, database: db, readOnly: false }));
      if (!r.columns.length) throw new ObjectError('That statement returns no rows, so there is nothing to export.');
      const content = format === 'csv' ? toCsv(r.columns, r.rows) : toJson(r.columns, r.rows);
      const file = writeInside(a, args.file, args.overwrite === true, content);
      return { file, format, rows: r.rows.length, truncated: r.truncated, bytes: Buffer.byteLength(content) };
    }

    // ---- saved queries, history, sessions ----
    case 'saved': {
      const sub = String(args.op ?? 'list');
      if (sub === 'list') return { saved: listSaved(view.id).map((s) => ({ ...s, sql: maskSecretsInSql(s.sql) })) };
      need(a, 'write', 'change the saved queries');
      if (sub === 'add') {
        const name = String(args.query_name ?? '').trim().slice(0, 80), sql = String(args.sql ?? '');
        if (!name || !sql.trim()) throw new ObjectError('Give the query a name (query_name) and some text (sql)');
        try { const e = addSaved(view.id, { name, sql: maskSecretsInSql(sql), database: db }); return { saved: { ...e, sql: maskSecretsInSql(e.sql) } }; } catch (e) { return fail(e); }
      }
      if (sub === 'update') {
        const e = updateSaved(view.id, String(args.id ?? ''), { name: args.query_name === undefined ? undefined : String(args.query_name).trim().slice(0, 80), sql: args.sql === undefined ? undefined : maskSecretsInSql(String(args.sql)), database: args.database === undefined ? undefined : db ?? null });
        if (!e) throw new ObjectError('Saved query not found');
        return { saved: e };
      }
      if (sub === 'remove') { if (!removeSaved(view.id, String(args.id ?? ''))) throw new ObjectError('Saved query not found'); return { removed: true }; }
      throw new ObjectError('op is list, add, update or remove');
    }
    case 'history': {
      const sub = String(args.op ?? 'list');
      if (sub === 'list') return { history: listQueries(view.id).map((h) => ({ ...h, sql: maskSecretsInSql(h.sql), error: h.error ? clean(h.error) : undefined })) };
      if (sub === 'clear') { need(a, 'write', 'clear the history'); clearQueries(view.id); return { cleared: true }; }
      throw new ObjectError('op is list or clear');
    }
    case 'sessions': need(a, 'write', 'see the sessions'); return dbSessions(cfg).catch(fail);
    case 'kill': need(a, 'admin', 'cancelling a session'); return { text: await dbKill(cfg, args.id).catch(fail) };

    // ---- the resource itself ----
    case 'config_set': {
      need(a, 'admin', 'changing a connection');
      const patch: Args = args.config && typeof args.config === 'object' ? { ...args.config } : {};
      if (patch.engine !== undefined && patch.engine !== cfg.engine) throw new ObjectError('The engine of a resource cannot change: create another one.');
      const empty = patch.password === undefined || patch.password === '';
      const merged = { ...cfg, ...patch, engine: cfg.engine, password: empty ? cfg.password : patch.password };
      const next = parseDatabase(merged);
      await dbTest(next).catch((e) => fail(e));
      const colony = args.colony_id === undefined ? undefined : colonyArg(a, args.colony_id);
      const updated = updateObject(view.id, { name: args.new_name === undefined ? undefined : args.new_name, colony_id: colony, config: merged });
      if (args.manager_id !== undefined) setObjectManager(view.id, managerArg(a, args.manager_id));
      return { name: updated.name, saved: true };
    }
    case 'delete': need(a, 'admin', 'deleting a database resource'); await removeObject(view.id); return { deleted: view.name };
  }
  throw new ObjectError(`Unknown database operation "${o}"`);
}
