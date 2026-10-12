import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { DB_ENGINES, ObjectError, type DatabaseConfig, type ObjectState } from './model.js';
import { plain, propValues, tlsOptions } from './driver-props.js';

/**
 * A database object is used, not started: hive-am opens a connection when it is asked something (state, schema, a query) and closes it
 * right after. Four engines, one small interface (`Conn.run`). What it takes care of:
 *  - a result never holds more than `maxRows` rows (the query is cut off as soon as there is one more, so `SELECT * FROM huge` costs the same);
 *  - a query that takes longer than `timeoutSec` is stopped;
 *  - a read-only object only accepts reads: the text is checked here and, where the engine allows it, the connection is read-only too;
 *  - the password is never in a message that leaves here.
 */
export interface DbColumn { name: string }
export interface DbResult { columns: DbColumn[]; rows: unknown[][]; truncated: boolean; affected?: number; ms: number }
export interface DbTable { schema: string; name: string; type: 'table' | 'view'; rows?: number }
export interface DbTableColumn { name: string; type: string; nullable: boolean; key?: string; default?: string | null }

const DEFAULT_ROWS = 1000, DEFAULT_TIMEOUT = 30;
const CONNECT_MS = 8000;
const CELL_MAX = 10_000;

interface RunOpts { max: number; timeoutMs: number; readOnly: boolean }
interface Conn { run(sql: string, o: RunOpts): Promise<Omit<DbResult, 'ms'>>; close(): Promise<void> }

/** What the driver says, without the password (drivers sometimes echo the connection string). */
const redact = (cfg: DatabaseConfig, e: unknown): string => {
  let m = e instanceof Error ? e.message : String(e);
  if (cfg.password) m = m.split(cfg.password).join('***');
  return m.split('\n')[0].slice(0, 300) || 'the database failed';
};

/** A value as the interface can show it. */
export function cell(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v === 'string') return v.length > CELL_MAX ? `${v.slice(0, CELL_MAX)}…` : v;
  if (typeof v === 'boolean') return v;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) { const b = Buffer.from(v); return `0x${b.subarray(0, 64).toString('hex')}${b.length > 64 ? `… (${b.length} bytes)` : ''}`; }
  try { const t = JSON.stringify(v); return t.length > CELL_MAX ? `${t.slice(0, CELL_MAX)}…` : t; } catch { return String(v); }
}

// ---- read-only check -------------------------------------------------------------------------------------------------------------------

const READ_START = new Set(['select', 'with', 'show', 'describe', 'desc', 'explain', 'pragma', 'values', 'table']);
const WRITE_WORDS = /\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|into|attach|detach|vacuum|reindex|exec|execute|call|copy|lock|set|use|replace\s+into)\b/;

/** The text of a statement without comments and without what is inside quotes: what is left is what the engine will really read. */
function bare(sql: string): string {
  let out = '', i = 0;
  while (i < sql.length) {
    const c = sql[i], n = sql[i + 1];
    if (c === '-' && n === '-') { while (i < sql.length && sql[i] !== '\n') i++; out += ' '; continue; }
    if (c === '#' ) { while (i < sql.length && sql[i] !== '\n') i++; out += ' '; continue; }
    if (c === '/' && n === '*') { const e = sql.indexOf('*/', i + 2); i = e < 0 ? sql.length : e + 2; out += ' '; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const q = c; i++;
      while (i < sql.length) { if (sql[i] === '\\' && q !== '`') { i += 2; continue; } if (sql[i] === q) { if (sql[i + 1] === q) { i += 2; continue; } break; } i++; }
      i++; out += ' ""'; continue;
    }
    if (c === '[') { const e = sql.indexOf(']', i); i = e < 0 ? sql.length : e + 1; out += ' "" '; continue; }     // SQL Server identifier
    out += c; i++;
  }
  return out;
}

/** Throws unless the text is one statement that only reads. */
export function assertReadOnly(sql: string): void {
  const t = bare(sql).trim().replace(/;+\s*$/, '').toLowerCase();
  if (!t) throw new ObjectError('Write a query');
  if (t.includes(';')) throw new ObjectError('Only one statement at a time');
  const first = /^[a-z]+/.exec(t)?.[0] ?? '(';
  if (first !== '(' && !READ_START.has(first)) throw new ObjectError('This database is read-only: only SELECT, WITH, SHOW, DESCRIBE and EXPLAIN are allowed. Turn read-only off in its settings to write.');
  if (first === 'pragma' && t.includes('=')) throw new ObjectError('This database is read-only: a PRAGMA cannot change settings.');
  const hit = WRITE_WORDS.exec(first === 'pragma' ? '' : t);
  if (hit) throw new ObjectError(`This database is read-only: "${hit[1].toUpperCase()}" is not allowed. Turn read-only off in its settings to write.`);
}

// ---- engines ---------------------------------------------------------------------------------------------------------------------------

const req = createRequire(import.meta.url);
const fixed = (n: number | undefined, d: number) => (n && n > 0 ? n : d);

async function openMysql(cfg: DatabaseConfig, database?: string): Promise<Conn> {
  const m: any = await import('mysql2'); const mysql = m.default ?? m;
  const pv = propValues('mysql', cfg.props);
  const c = mysql.createConnection({
    connectTimeout: CONNECT_MS, ...plain(pv),
    host: cfg.host, port: fixed(cfg.port, DB_ENGINES.mysql.port), user: cfg.user, password: cfg.password, database: database ?? cfg.database,
    ssl: cfg.ssl ? tlsOptions(pv, !cfg.trustCert) : undefined, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, rowsAsArray: true,
  });
  await new Promise<void>((ok, no) => c.connect((e: Error | null) => (e ? no(e) : ok())));
  c.on('error', () => undefined);
  let ro = false;
  return {
    async run(sql, o) {
      if (o.readOnly && !ro) { await new Promise<void>((ok, no) => c.query('SET SESSION TRANSACTION READ ONLY', (e: Error | null) => (e ? no(e) : ok()))); ro = true; }
      return new Promise((ok, no) => {
        const rows: unknown[][] = []; let columns: DbColumn[] = [], truncated = false, affected: number | undefined, done = false;
        const finish = (err?: Error) => { if (done) return; done = true; err ? no(err) : ok({ columns, rows, truncated, affected }); };
        const q = c.query({ sql, rowsAsArray: true, timeout: o.timeoutMs });
        q.on('fields', (f: any[] | null) => { columns = (f ?? []).map((x) => ({ name: x.name })); })
          .on('result', (r: any) => {
            if (Array.isArray(r)) { if (rows.length < o.max) rows.push(r); else if (!truncated) { truncated = true; c.destroy(); finish(); } }
            else if (r && typeof r.affectedRows === 'number') affected = r.affectedRows;
          })
          .on('error', (e: Error) => finish(truncated ? undefined : e))
          .on('end', () => finish());
      });
    },
    async close() { try { c.destroy(); } catch { /* gone */ } },
  };
}

async function openPg(cfg: DatabaseConfig, database?: string): Promise<Conn> {
  const m: any = await import('pg'); const pg = m.default ?? m;
  const cm: any = await import('pg-cursor'); const Cursor = cm.default ?? cm;
  const pv = propValues('postgresql', cfg.props);
  const { search_path: path, options: extra, ...rest } = plain(pv);
  const options = [extra, path !== undefined ? `-c search_path=${String(path).replace(/ /g, '')}` : undefined].filter(Boolean).join(' ') || undefined;
  const c = new pg.Client({
    connectionTimeoutMillis: CONNECT_MS, ...rest, options,
    host: cfg.host, port: fixed(cfg.port, DB_ENGINES.postgresql.port), user: cfg.user, password: cfg.password, database: database ?? cfg.database ?? undefined,
    ssl: cfg.ssl ? tlsOptions(pv, !cfg.trustCert) : undefined,
  });
  c.on('error', () => undefined);
  await c.connect();
  return {
    async run(sql, o) {
      await c.query(`SET statement_timeout = ${Math.round(o.timeoutMs)}`);
      if (o.readOnly) await c.query('BEGIN READ ONLY');
      try {
        const cur = c.query(new Cursor(sql, [], { rowMode: 'array' }));
        const got: unknown[][] = await cur.read(o.max + 1);
        const r = cur._result ?? {};
        await cur.close();
        const truncated = got.length > o.max;
        const columns: DbColumn[] = (r.fields ?? []).map((f: any) => ({ name: f.name }));
        return { columns, rows: truncated ? got.slice(0, o.max) : got, truncated, affected: columns.length === 0 && typeof r.rowCount === 'number' ? r.rowCount : undefined };
      } finally { if (o.readOnly) await c.query('ROLLBACK').catch(() => undefined); }
    },
    async close() { try { await c.end(); } catch { /* gone */ } },
  };
}

async function openMssql(cfg: DatabaseConfig, database?: string): Promise<Conn> {
  const m: any = await import('mssql'); const mssql = m.default ?? m;
  const pv = propValues('mssql', cfg.props);
  const { connectionTimeout, ...opts } = plain(pv);
  const crypto = cfg.ssl ? tlsOptions(pv, true) : undefined; if (crypto) delete crypto.rejectUnauthorized;
  const pool = new mssql.ConnectionPool({
    server: cfg.host, user: cfg.user, password: cfg.password, database: database ?? cfg.database,
    // A named instance is found by its name, so it takes no port.
    ...(opts.instanceName !== undefined ? {} : { port: fixed(cfg.port, DB_ENGINES.mssql.port) }),
    options: { ...opts, encrypt: !!cfg.ssl, trustServerCertificate: cfg.ssl ? !!cfg.trustCert : true, ...(crypto && Object.keys(crypto).length ? { cryptoCredentialsDetails: crypto } : {}) },
    connectionTimeout: connectionTimeout ?? CONNECT_MS, pool: { max: 1, min: 0 },
  });
  pool.on('error', () => undefined);
  await pool.connect();
  return {
    async run(sql, o) {
      return new Promise((ok, no) => {
        const r = new mssql.Request(pool); r.stream = true; r.arrayRowMode = true;
        const rows: unknown[][] = []; let columns: DbColumn[] = [], truncated = false, affected: number | undefined, done = false;
        const finish = (err?: Error) => { if (done) return; done = true; clearTimeout(timer); err ? no(err) : ok({ columns, rows, truncated, affected }); };
        const timer = setTimeout(() => { try { r.cancel(); } catch { /* done */ } finish(new Error(`The query took more than ${Math.round(o.timeoutMs / 1000)} s`)); }, o.timeoutMs);
        r.on('recordset', (cols: Record<string, any>) => { columns = Object.values(cols).sort((a, b) => a.index - b.index).map((x) => ({ name: x.name })); });
        r.on('row', (row: unknown[]) => { if (rows.length < o.max) rows.push(row); else if (!truncated) { truncated = true; try { r.cancel(); } catch { /* done */ } finish(); } });
        r.on('error', (e: Error) => finish(truncated ? undefined : e));
        r.on('done', (res: any) => { if (Array.isArray(res?.rowsAffected) && columns.length === 0) affected = res.rowsAffected.reduce((a: number, b: number) => a + b, 0); finish(); });
        r.query(sql);
      });
    },
    async close() { try { await pool.close(); } catch { /* gone */ } },
  };
}

/**
 * better-sqlite3 is synchronous and has no way to interrupt a statement, so a query that never ends cannot be stopped from inside
 * the process (not even in a thread: it would go on using a core forever). It runs in a process of its own that is killed at the timeout.
 */
const SQLITE_CHILD = `
const w = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
const Database = require(w.mod);
let db, out;
try {
  db = new Database(w.file, { readonly: w.readOnly, fileMustExist: true, ...(w.timeout !== undefined ? { timeout: w.timeout } : {}) });
  for (const [k, v] of Object.entries(w.pragmas)) db.pragma(k + ' = ' + v);
  const stmt = db.prepare(w.sql);
  if (stmt.reader) {
    const columns = stmt.columns().map((c) => ({ name: c.name })); stmt.raw(true);
    const rows = []; let truncated = false;
    for (const r of stmt.iterate()) { if (rows.length >= w.max) { truncated = true; break; } rows.push(r.map((v) => typeof v === 'bigint' ? v.toString() : (Buffer.isBuffer(v) ? { $blob: v.toString('base64') } : v))); }
    out = { ok: true, columns, rows, truncated };
  } else { const r = stmt.run(); out = { ok: true, columns: [], rows: [], truncated: false, affected: r.changes }; }
} catch (e) { out = { ok: false, error: String(e && e.message || e) }; }
try { db && db.close(); } catch {}
process.stdout.write(JSON.stringify(out));
`;
const SQLITE_MAX_OUT = 64 * 1024 * 1024;

function openSqlite(cfg: DatabaseConfig): Conn {
  if (!existsSync(cfg.file!)) throw new ObjectError('The SQLite file does not exist');
  const mod = req.resolve('better-sqlite3');
  // The values were checked when the object was saved (a number, true/false or one of a few words), so they are safe in a PRAGMA.
  const { timeout, ...rest } = plain(propValues('sqlite', cfg.props));
  const pragmas = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, typeof v === 'boolean' ? (v ? 1 : 0) : v]));
  return {
    run: (sql, o) => new Promise((ok, no) => {
      const child = spawn(process.execPath, ['-e', SQLITE_CHILD], { stdio: ['pipe', 'pipe', 'ignore'] });
      const chunks: Buffer[] = []; let size = 0, done = false;
      const finish = (err?: Error, v?: Omit<DbResult, 'ms'>) => { if (done) return; done = true; clearTimeout(timer); child.kill('SIGKILL'); err ? no(err) : ok(v!); };
      const timer = setTimeout(() => finish(new Error(`The query took more than ${Math.round(o.timeoutMs / 1000)} s`)), o.timeoutMs);
      child.stdout.on('data', (c: Buffer) => { size += c.length; if (size > SQLITE_MAX_OUT) finish(new Error('The result is too big: use fewer rows or columns')); else chunks.push(c); });
      child.once('error', (e) => finish(e));
      child.once('close', () => {
        if (done) return;
        try {
          const m = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          m.ok ? finish(undefined, { columns: m.columns, rows: m.rows.map((r: unknown[]) => r.map((v) => (v && typeof v === 'object' && '$blob' in v ? Buffer.from((v as { $blob: string }).$blob, 'base64') : v))), truncated: m.truncated, affected: m.affected }) : finish(new Error(m.error));
        } catch { finish(new Error('The SQLite process ended without an answer')); }
      });
      child.stdin.end(JSON.stringify({ mod, file: cfg.file, sql, max: o.max, readOnly: o.readOnly, timeout, pragmas }));
    }),
    close: async () => undefined,
  };
}

async function open(cfg: DatabaseConfig, database?: string): Promise<Conn> {
  if (cfg.engine === 'sqlite') return openSqlite(cfg);
  if (cfg.engine === 'mysql') return openMysql(cfg, database);
  if (cfg.engine === 'postgresql') return openPg(cfg, database);
  return openMssql(cfg, database);
}

const optsOf = (cfg: DatabaseConfig, readOnly?: boolean): RunOpts => ({ max: cfg.maxRows ?? DEFAULT_ROWS, timeoutMs: (cfg.timeoutSec ?? DEFAULT_TIMEOUT) * 1000, readOnly: readOnly ?? cfg.readOnly !== false });

/** Opens a connection, runs what `fn` asks and closes it, whatever happens. Errors come out as `ObjectError` without the password. */
async function withConn<T>(cfg: DatabaseConfig, database: string | undefined, fn: (c: Conn) => Promise<T>): Promise<T> {
  let c: Conn | undefined;
  try { c = await open(cfg, database); return await fn(c); }
  catch (e) { throw e instanceof ObjectError ? e : new ObjectError(redact(cfg, e)); }
  finally { await c?.close(); }
}

// ---- what the object offers ------------------------------------------------------------------------------------------------------------

export async function dbQuery(cfg: DatabaseConfig, p: { sql: string; database?: string; readOnly?: boolean }): Promise<DbResult> {
  if (typeof p.sql !== 'string' || !p.sql.trim()) throw new ObjectError('Write a query');
  if (p.sql.length > 200_000) throw new ObjectError('The query is too long');
  const readOnly = p.readOnly ?? cfg.readOnly !== false;
  if (readOnly) assertReadOnly(p.sql);
  const t0 = Date.now();
  const r = await withConn(cfg, p.database, (c) => c.run(p.sql, optsOf(cfg, readOnly)));
  return { ...r, rows: r.rows.map((row) => row.map(cell)), ms: Date.now() - t0 };
}

const lit = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
const NAME_OK = /^[^\0\r\n]{1,256}$/;
const name = (v: unknown, what: string): string => { const s = typeof v === 'string' ? v : ''; if (!NAME_OK.test(s)) throw new ObjectError(`${what} is not valid`); return s; };
const internal = (cfg: DatabaseConfig): RunOpts => ({ max: 5000, timeoutMs: Math.min(30_000, (cfg.timeoutSec ?? DEFAULT_TIMEOUT) * 1000), readOnly: true });

export async function dbVersion(cfg: DatabaseConfig, database?: string): Promise<string> {
  const sql = cfg.engine === 'mysql' ? 'SELECT VERSION()' : cfg.engine === 'postgresql' ? 'SHOW server_version' : cfg.engine === 'mssql' ? "SELECT 'SQL Server ' + CAST(SERVERPROPERTY('ProductVersion') AS varchar(50))" : 'SELECT sqlite_version()';
  return withConn(cfg, database, async (c) => {
    const v = String((await c.run(sql, internal(cfg))).rows[0]?.[0] ?? '').split('\n')[0].replace(/\s+/g, ' ').trim();
    const label = cfg.engine === 'sqlite' ? 'SQLite' : cfg.engine === 'postgresql' ? 'PostgreSQL' : cfg.engine === 'mssql' ? '' : /maria/i.test(v) ? 'MariaDB' : 'MySQL';
    return `${label} ${v}`.trim().slice(0, 90);
  });
}

export async function dbTest(cfg: DatabaseConfig): Promise<{ ok: true; version: string; ms: number }> {
  const t0 = Date.now();
  const version = await dbVersion(cfg);
  return { ok: true, version, ms: Date.now() - t0 };
}

export interface DbSchema { engine: string; databases: string[]; database: string; tables: DbTable[] }
const SYSTEM_DBS = new Set(['information_schema', 'mysql', 'performance_schema', 'sys', 'master', 'tempdb', 'model', 'msdb', 'template0', 'template1']);

export async function dbSchema(cfg: DatabaseConfig, database?: string): Promise<DbSchema> {
  if (database !== undefined) name(database, 'The database');
  return withConn(cfg, database, async (c) => {
    const q = async (sql: string) => (await c.run(sql, internal(cfg))).rows;
    if (cfg.engine === 'sqlite') {
      const rows = await q("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name");
      return { engine: cfg.engine, databases: [], database: 'main', tables: rows.map((r) => ({ schema: 'main', name: String(r[0]), type: r[1] === 'view' ? 'view' as const : 'table' as const })) };
    }
    if (cfg.engine === 'mysql') {
      const databases = (await q('SHOW DATABASES')).map((r) => String(r[0])).filter((d) => !SYSTEM_DBS.has(d.toLowerCase()));
      const current = database ?? cfg.database ?? String((await q('SELECT DATABASE()'))[0]?.[0] ?? '') ?? '';
      const cur = current || databases[0] || '';
      const tables = cur ? (await q(`SELECT table_name, table_type, table_rows FROM information_schema.tables WHERE table_schema = ${lit(cur)} ORDER BY table_name`)).map((r) => ({ schema: cur, name: String(r[0]), type: /view/i.test(String(r[1])) ? 'view' as const : 'table' as const, rows: r[2] === null ? undefined : Number(r[2]) })) : [];
      return { engine: cfg.engine, databases: databases.includes(cur) || !cur ? databases : [cur, ...databases], database: cur, tables };
    }
    if (cfg.engine === 'postgresql') {
      const databases = (await q('SELECT datname FROM pg_database WHERE NOT datistemplate AND datallowconn ORDER BY 1')).map((r) => String(r[0]));
      const current = String((await q('SELECT current_database()'))[0]?.[0] ?? '');
      const tables = (await q(`SELECT t.table_schema, t.table_name, t.table_type, c.reltuples::bigint FROM information_schema.tables t
        LEFT JOIN pg_class c ON c.relname = t.table_name AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = t.table_schema)
        WHERE t.table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1, 2`)).map((r) => ({ schema: String(r[0]), name: String(r[1]), type: /view/i.test(String(r[2])) ? 'view' as const : 'table' as const, rows: r[3] === null || Number(r[3]) < 0 ? undefined : Number(r[3]) }));
      return { engine: cfg.engine, databases, database: current, tables };
    }
    const databases = (await q('SELECT name FROM sys.databases WHERE database_id > 4 ORDER BY name').catch(() => [])).map((r) => String(r[0]));
    const current = String((await q('SELECT DB_NAME()'))[0]?.[0] ?? '');
    const tables = (await q('SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES ORDER BY 1, 2')).map((r) => ({ schema: String(r[0]), name: String(r[1]), type: /view/i.test(String(r[2])) ? 'view' as const : 'table' as const }));
    return { engine: cfg.engine, databases: databases.includes(current) ? databases : [current, ...databases], database: current, tables };
  });
}

export async function dbColumns(cfg: DatabaseConfig, p: { database?: string; schema: string; table: string }): Promise<DbTableColumn[]> {
  const schema = name(p.schema, 'The schema'), table = name(p.table, 'The table');
  if (p.database !== undefined) name(p.database, 'The database');
  return withConn(cfg, p.database, async (c) => {
    const q = async (sql: string) => (await c.run(sql, internal(cfg))).rows;
    if (cfg.engine === 'sqlite') {
      return (await q(`PRAGMA table_info("${table.replace(/"/g, '""')}")`)).map((r) => ({ name: String(r[1]), type: String(r[2] || ''), nullable: !r[3] && !r[5], key: r[5] ? 'PRI' : undefined, default: r[4] === null ? null : String(r[4]) }));
    }
    if (cfg.engine === 'mysql') {
      return (await q(`SELECT column_name, column_type, is_nullable, column_key, column_default FROM information_schema.columns WHERE table_schema = ${lit(schema)} AND table_name = ${lit(table)} ORDER BY ordinal_position`))
        .map((r) => ({ name: String(r[0]), type: String(r[1]), nullable: r[2] === 'YES', key: r[3] ? String(r[3]) : undefined, default: r[4] === null ? null : String(r[4]) }));
    }
    if (cfg.engine === 'postgresql') {
      return (await q(`SELECT c.column_name, c.data_type, c.is_nullable,
        (SELECT 'PRI' FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage k ON k.constraint_name = tc.constraint_name AND k.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = c.table_schema AND tc.table_name = c.table_name AND k.column_name = c.column_name LIMIT 1), c.column_default
        FROM information_schema.columns c WHERE c.table_schema = ${lit(schema)} AND c.table_name = ${lit(table)} ORDER BY c.ordinal_position`))
        .map((r) => ({ name: String(r[0]), type: String(r[1]), nullable: r[2] === 'YES', key: r[3] ? String(r[3]) : undefined, default: r[4] === null ? null : String(r[4]) }));
    }
    return (await q(`SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ${lit(schema)} AND TABLE_NAME = ${lit(table)} ORDER BY ORDINAL_POSITION`))
      .map((r) => ({ name: String(r[0]), type: String(r[1]), nullable: r[2] === 'YES', default: r[3] === null ? null : String(r[3]) }));
  });
}

// ---- state -----------------------------------------------------------------------------------------------------------------------------

const seen = new Map<string, { at: number; state: ObjectState }>();
const FRESH_MS = 15_000;
export const forgetDatabase = (id: string) => { seen.delete(id); };

/** `ready` when a connection opens (with the version and how long it took), an error with the reason when it does not. Asked at most every 15 s. */
export async function dbState(id: string, cfg: DatabaseConfig): Promise<ObjectState> {
  const hit = seen.get(id);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.state;
  let state: ObjectState;
  try {
    if (cfg.engine === 'sqlite' && !existsSync(cfg.file!)) throw new ObjectError('The file does not exist');
    const r = await dbTest(cfg);
    state = { status: 'ready', detail: `${r.version} · ${r.ms} ms` };
  } catch (e) { state = { status: 'error', detail: e instanceof Error ? e.message : 'unreachable' }; }
  seen.set(id, { at: Date.now(), state });
  return state;
}
