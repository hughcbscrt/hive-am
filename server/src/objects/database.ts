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
type Raw = Omit<DbResult, 'ms'>;
/** `script` runs several statements as one unit, committed or rolled back together; an engine that has no connection to keep open (SQLite) does it itself. */
interface Conn { run(sql: string, o: RunOpts): Promise<Raw>; script?(statements: string[], o: RunOpts): Promise<Raw[]>; explain?(statement: string, o: RunOpts): Promise<Raw>; close(): Promise<void> }

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
    /**
     * The plan of a statement, without running it. SHOWPLAN is a setting of the connection that has to be switched on by a batch of its own (the driver
     * sends an ordinary call inside sp_executesql, where the setting does not outlast the call and the statement would RUN). It is done inside a
     * transaction that is always rolled back, so that nothing can stay changed even if the setting did not take.
     */
    async explain(statement, o) {
      const tx = new mssql.Transaction(pool);
      await tx.begin();
      try {
        const batch = (sql: string) => { const r = new mssql.Request(tx); r.arrayRowMode = true; return r.batch(sql) as Promise<any>; };
        await batch('SET SHOWPLAN_TEXT ON');
        let res: any;
        try { res = await Promise.race([batch(statement), new Promise((_, no) => setTimeout(() => no(new Error(`The plan took more than ${Math.round(o.timeoutMs / 1000)} s`)), o.timeoutMs).unref())]); }
        finally { await batch('SET SHOWPLAN_TEXT OFF').catch(() => undefined); }
        const set = (res.recordset ?? []) as unknown[][];
        const cols = (res.recordset as any)?.columns ? Object.values((res.recordset as any).columns as Record<string, any>).sort((a, b) => a.index - b.index).map((x) => ({ name: x.name })) : [{ name: 'plan' }];
        return { columns: cols, rows: set.slice(0, o.max), truncated: set.length > o.max };
      } finally { try { await tx.rollback(); } catch { /* nothing left to undo */ } }
    },
    // The statements of a script run inside one transaction of the driver (a BEGIN sent as a statement would end with the batch that carries it).
    async script(statements, o) {
      const tx = new mssql.Transaction(pool);
      await tx.begin();
      const out: Raw[] = [];
      try {
        for (let i = 0; i < statements.length; i++) {
          try {
            const r = new mssql.Request(tx); r.arrayRowMode = true;
            const res: any = await Promise.race([r.query(statements[i]), new Promise((_, no) => setTimeout(() => { try { r.cancel(); } catch { /* done */ } no(new Error(`The script took more than ${Math.round(o.timeoutMs / 1000)} s`)); }, o.timeoutMs).unref())]);
            const set = res.recordset as unknown[][] | undefined;
            const cols = set ? Object.values((set as any).columns as Record<string, any>).sort((a, b) => a.index - b.index).map((x) => ({ name: x.name })) : [];
            const rows = set ?? [];
            out.push({ columns: cols, rows: rows.slice(0, o.max), truncated: rows.length > o.max, affected: cols.length === 0 ? (res.rowsAffected as number[]).reduce((a, b) => a + b, 0) : undefined });
          } catch (e) { throw new Error(`Statement ${i + 1} failed and nothing was changed: ${e instanceof Error ? e.message : e}`); }
        }
        await tx.commit();
      } catch (e) { try { await tx.rollback(); } catch { /* already rolled back */ } throw e; }
      return out;
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
  const one = (sql) => {
    const stmt = db.prepare(sql);
    if (stmt.reader) {
      const columns = stmt.columns().map((c) => ({ name: c.name })); stmt.raw(true);
      const rows = []; let truncated = false;
      for (const r of stmt.iterate()) { if (rows.length >= w.max) { truncated = true; break; } rows.push(r.map((v) => typeof v === 'bigint' ? v.toString() : (Buffer.isBuffer(v) ? { $blob: v.toString('base64') } : v))); }
      return { columns, rows, truncated };
    }
    const r = stmt.run(); return { columns: [], rows: [], truncated: false, affected: r.changes };
  };
  if (w.script) {
    // All the statements in one transaction: one failing undoes the others.
    db.exec('BEGIN'); const results = []; let at = 0;
    try { for (; at < w.script.length; at++) results.push(one(w.script[at])); db.exec('COMMIT'); out = { ok: true, script: results }; }
    catch (e) { try { db.exec('ROLLBACK'); } catch {} out = { ok: false, error: String(e && e.message || e), at: at + 1 }; }
  } else out = { ok: true, ...one(w.sql) };
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
  const blobs = (r: unknown[]) => r.map((v) => (v && typeof v === 'object' && '$blob' in v ? Buffer.from((v as { $blob: string }).$blob, 'base64') : v));
  const shape = (m: any): Raw => ({ columns: m.columns, rows: m.rows.map(blobs), truncated: m.truncated, affected: m.affected });
  /** One run of the child process: the message it printed, or an error when it ended without one, took too long or printed too much. */
  const call = (payload: Record<string, unknown>, o: RunOpts) => new Promise<any>((ok, no) => {
    const child = spawn(process.execPath, ['-e', SQLITE_CHILD], { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks: Buffer[] = []; let size = 0, done = false;
    const finish = (err?: Error, v?: unknown) => { if (done) return; done = true; clearTimeout(timer); child.kill('SIGKILL'); err ? no(err) : ok(v); };
    const timer = setTimeout(() => finish(new Error(`The query took more than ${Math.round(o.timeoutMs / 1000)} s`)), o.timeoutMs);
    child.stdout.on('data', (c: Buffer) => { size += c.length; if (size > SQLITE_MAX_OUT) finish(new Error('The result is too big: use fewer rows or columns')); else chunks.push(c); });
    child.once('error', (e) => finish(e));
    child.once('close', () => {
      if (done) return;
      try { finish(undefined, JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { finish(new Error('The SQLite process ended without an answer')); }
    });
    child.stdin.end(JSON.stringify({ mod, file: cfg.file, max: o.max, readOnly: o.readOnly, timeout, pragmas, ...payload }));
  });
  return {
    run: async (sql, o) => { const m = await call({ sql }, o); if (!m.ok) throw new Error(m.error); return shape(m); },
    script: async (statements, o) => {
      const m = await call({ script: statements }, o);
      if (!m.ok) throw new Error(m.at ? `Statement ${m.at} failed and nothing was changed: ${m.error}` : m.error);
      return m.script.map(shape);
    },
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
    return (await q(`SELECT c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE, c.COLUMN_DEFAULT,
      (SELECT TOP 1 'PRI' FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k ON k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND k.TABLE_SCHEMA = tc.TABLE_SCHEMA
        WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_SCHEMA = c.TABLE_SCHEMA AND tc.TABLE_NAME = c.TABLE_NAME AND k.COLUMN_NAME = c.COLUMN_NAME)
      FROM INFORMATION_SCHEMA.COLUMNS c WHERE c.TABLE_SCHEMA = ${lit(schema)} AND c.TABLE_NAME = ${lit(table)} ORDER BY c.ORDINAL_POSITION`))
      .map((r) => ({ name: String(r[0]), type: String(r[1]), nullable: r[2] === 'YES', key: r[4] ? String(r[4]) : undefined, default: r[3] === null ? null : String(r[3]) }));
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

// ---- what an agent needs on top of that ------------------------------------------------------------------------------------------------

/** Splits a script into its statements, the way the engine would read it: a `;` inside a quote, a comment or a dollar-quoted body does not end one. */
export function splitStatements(sql: string, engine?: DatabaseConfig['engine']): string[] {
  const out: string[] = []; let cur = '', i = 0;
  const push = () => { const t = cur.trim(); if (t) out.push(t); cur = ''; };
  while (i < sql.length) {
    const c = sql[i], n = sql[i + 1];
    if (c === '-' && n === '-') { const e = sql.indexOf('\n', i); const j = e < 0 ? sql.length : e; cur += sql.slice(i, j); i = j; continue; }
    if (c === '#' && engine === 'mysql') { const e = sql.indexOf('\n', i); const j = e < 0 ? sql.length : e; cur += sql.slice(i, j); i = j; continue; }
    if (c === '/' && n === '*') { const e = sql.indexOf('*/', i + 2); const j = e < 0 ? sql.length : e + 2; cur += sql.slice(i, j); i = j; continue; }
    if (c === '$' && engine === 'postgresql') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))?.[0];
      if (tag) { const e = sql.indexOf(tag, i + tag.length); const j = e < 0 ? sql.length : e + tag.length; cur += sql.slice(i, j); i = j; continue; }
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c; let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '\\' && q !== '`' && engine === 'mysql') { j += 2; continue; }
        if (sql[j] === q) { if (sql[j + 1] === q) { j += 2; continue; } break; }
        j++;
      }
      cur += sql.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '[' && engine === 'mssql') { const e = sql.indexOf(']', i); const j = e < 0 ? sql.length : e + 1; cur += sql.slice(i, j); i = j; continue; }
    if (c === ';') { push(); i++; continue; }
    cur += c; i++;
  }
  push();
  return out;
}

/**
 * True when the text has a statement that starts with DROP or TRUNCATE, or an `ALTER ... DROP ...`. Comments and what is inside quotes are
 * ignored. It is a guardrail, not a sandbox: a DELETE without a WHERE, a CALL, a PostgreSQL DO block or a stored procedure are not seen.
 */
export function isDestructive(sql: string): boolean {
  return bare(sql).split(';').some((st) => {
    const t = st.trim().toLowerCase();
    return /^(drop|truncate)\b/.test(t) || (/^alter\b/.test(t) && /\bdrop\b/.test(t));
  });
}

/** The text with the literal of a password in it replaced by `***` (CREATE USER … IDENTIFIED BY '…', ALTER USER … PASSWORD '…', WITH PASSWORD = '…'). */
export function maskSecretsInSql(sql: string): string {
  const lit = `('(?:[^'\\\\]|\\\\.|'')*'|"(?:[^"\\\\]|\\\\.|"")*")`;
  return String(sql)
    .replace(new RegExp(`(\\bidentified\\s+(?:with\\s+\\w+\\s+)?by\\s+(?:password\\s+)?)${lit}`, 'gi'), "$1'***'")
    .replace(new RegExp(`(\\b(?:encrypted\\s+|unencrypted\\s+)?password\\s*(?:=\\s*|\\(\\s*)?(?:password\\s*\\(\\s*)?)${lit}`, 'gi'), "$1'***'")
    .replace(new RegExp(`(\\bpwdencrypt\\s*\\(\\s*)${lit}`, 'gi'), "$1'***'");
}

/** Quotes a table or schema name for the engine. */
export const quoteIdent = (engine: DatabaseConfig['engine'], id: string): string =>
  engine === 'mysql' ? `\`${id.replace(/`/g, '``')}\`` : engine === 'mssql' ? `[${id.replace(/]/g, ']]')}]` : `"${id.replace(/"/g, '""')}"`;
const qualified = (cfg: DatabaseConfig, schema: string, table: string) => `${quoteIdent(cfg.engine, schema)}.${quoteIdent(cfg.engine, table)}`;

export interface DbStatementResult extends Omit<DbResult, 'ms'> { statement: string }
const MAX_STATEMENTS = 100;

/**
 * Several statements as one unit: all of them are applied or none (MySQL commits by itself on a DDL statement, so a CREATE or ALTER in the
 * middle of a script cannot be undone there). A failure says which statement it was.
 */
export async function dbExec(cfg: DatabaseConfig, p: { sql: string; database?: string; readOnly?: boolean }): Promise<{ results: DbStatementResult[]; ms: number }> {
  if (typeof p.sql !== 'string' || !p.sql.trim()) throw new ObjectError('Write some SQL');
  if (p.sql.length > 200_000) throw new ObjectError('The script is too long');
  if (p.database !== undefined) name(p.database, 'The database');
  const statements = splitStatements(p.sql, cfg.engine);
  if (!statements.length) throw new ObjectError('Write some SQL');
  if (statements.length > MAX_STATEMENTS) throw new ObjectError(`A script has at most ${MAX_STATEMENTS} statements`);
  const readOnly = p.readOnly ?? cfg.readOnly !== false;
  if (readOnly) for (const st of statements) assertReadOnly(st);
  const o = optsOf(cfg, readOnly);
  const t0 = Date.now();
  const raw = await withConn(cfg, p.database, async (c) => {
    if (c.script) return c.script(statements, o);
    const begin = cfg.engine === 'mssql' ? 'BEGIN TRANSACTION' : cfg.engine === 'mysql' ? 'START TRANSACTION' : 'BEGIN';
    const results: Raw[] = [];
    await c.run(begin, { ...o, readOnly: false });
    try {
      for (let i = 0; i < statements.length; i++) {
        try { results.push(await c.run(statements[i], { ...o, readOnly: false })); }
        catch (e) { throw new Error(`Statement ${i + 1} failed and nothing was changed: ${e instanceof Error ? e.message : e}`); }
      }
      await c.run(cfg.engine === 'mssql' ? 'COMMIT TRANSACTION' : 'COMMIT', { ...o, readOnly: false });
    } catch (e) {
      await c.run(cfg.engine === 'mssql' ? 'ROLLBACK TRANSACTION' : 'ROLLBACK', { ...o, readOnly: false }).catch(() => undefined);
      throw e;
    }
    return results;
  });
  return { results: raw.map((r, i) => ({ ...r, rows: r.rows.map((row) => row.map(cell)), statement: statements[i] })), ms: Date.now() - t0 };
}

// ---- discovery -------------------------------------------------------------------------------------------------------------------------

export interface DbIndex { name: string; unique: boolean; columns: string[] }
export interface DbForeignKey { name: string; columns: string[]; refSchema?: string; refTable: string; refColumns: string[] }
export interface DbDescribe { schema: string; table: string; columns: DbTableColumn[]; primaryKey: string[]; indexes: DbIndex[]; foreignKeys: DbForeignKey[]; rowCount: number | null }

/** Groups rows `[name, …, column]` that arrive ordered by name into `{ name, columns[] }`. */
function grouped<T extends { name: string; columns: string[] }>(rows: unknown[][], make: (r: unknown[]) => T, col: (r: unknown[]) => string): T[] {
  const out: T[] = [];
  for (const r of rows) { const n = String(r[0]); const cur = out.find((x) => x.name === n); if (cur) cur.columns.push(col(r)); else out.push(make(r)); }
  return out;
}

export async function dbDescribe(cfg: DatabaseConfig, p: { database?: string; schema: string; table: string }): Promise<DbDescribe> {
  const schema = name(p.schema, 'The schema'), table = name(p.table, 'The table');
  const columns = await dbColumns(cfg, p);
  return withConn(cfg, p.database, async (c) => {
    const q = async (sql: string) => (await c.run(sql, internal(cfg))).rows;
    let indexes: DbIndex[] = [], foreignKeys: DbForeignKey[] = [];
    if (cfg.engine === 'sqlite') {
      for (const r of await q(`PRAGMA index_list(${lit(table)})`)) {
        const cols = (await q(`PRAGMA index_info(${lit(String(r[1]))})`)).map((x) => String(x[2]));
        indexes.push({ name: String(r[1]), unique: !!r[2], columns: cols });
      }
      const fk = await q(`PRAGMA foreign_key_list(${lit(table)})`);
      foreignKeys = [];
      for (const id of [...new Set(fk.map((r) => String(r[0])))]) {
        const part = fk.filter((r) => String(r[0]) === id);
        foreignKeys.push({ name: `fk_${table}_${id}`, columns: part.map((r) => String(r[3])), refTable: String(part[0][2]), refColumns: part.map((r) => String(r[4])) });
      }
    } else if (cfg.engine === 'mysql') {
      indexes = grouped(await q(`SELECT index_name, non_unique, column_name FROM information_schema.statistics WHERE table_schema = ${lit(schema)} AND table_name = ${lit(table)} ORDER BY index_name, seq_in_index`),
        (r) => ({ name: String(r[0]), unique: !Number(r[1]), columns: [String(r[2])] }), (r) => String(r[2]));
      foreignKeys = grouped(await q(`SELECT constraint_name, referenced_table_schema, referenced_table_name, column_name, referenced_column_name FROM information_schema.key_column_usage WHERE table_schema = ${lit(schema)} AND table_name = ${lit(table)} AND referenced_table_name IS NOT NULL ORDER BY constraint_name, ordinal_position`),
        (r) => ({ name: String(r[0]), columns: [String(r[3])], refSchema: String(r[1]), refTable: String(r[2]), refColumns: [String(r[4])] }), (r) => String(r[3]));
      for (const f of foreignKeys) f.refColumns = (await q(`SELECT referenced_column_name FROM information_schema.key_column_usage WHERE table_schema = ${lit(schema)} AND table_name = ${lit(table)} AND constraint_name = ${lit(f.name)} ORDER BY ordinal_position`)).map((r) => String(r[0]));
    } else if (cfg.engine === 'postgresql') {
      indexes = grouped(await q(`SELECT i.relname, ix.indisunique, a.attname FROM pg_index ix JOIN pg_class t ON t.oid = ix.indrelid JOIN pg_class i ON i.oid = ix.indexrelid JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
        WHERE n.nspname = ${lit(schema)} AND t.relname = ${lit(table)} ORDER BY i.relname, k.ord`),
        (r) => ({ name: String(r[0]), unique: !!r[1], columns: [String(r[2])] }), (r) => String(r[2]));
      const fk = await q(`SELECT con.conname, rn.nspname, rt.relname, a.attname, ra.attname FROM pg_constraint con JOIN pg_class t ON t.oid = con.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_class rt ON rt.oid = con.confrelid JOIN pg_namespace rn ON rn.oid = rt.relnamespace
        JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS u(ck, fk, ord) ON true JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = u.ck JOIN pg_attribute ra ON ra.attrelid = rt.oid AND ra.attnum = u.fk
        WHERE con.contype = 'f' AND n.nspname = ${lit(schema)} AND t.relname = ${lit(table)} ORDER BY con.conname, u.ord`);
      foreignKeys = [];
      for (const r of fk) {
        const cur = foreignKeys.find((x) => x.name === String(r[0]));
        if (cur) { cur.columns.push(String(r[3])); cur.refColumns.push(String(r[4])); }
        else foreignKeys.push({ name: String(r[0]), columns: [String(r[3])], refSchema: String(r[1]), refTable: String(r[2]), refColumns: [String(r[4])] });
      }
    } else {
      const obj = lit(`${quoteIdent('mssql', schema)}.${quoteIdent('mssql', table)}`);
      indexes = grouped(await q(`SELECT i.name, i.is_unique, c.name FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
        JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id WHERE i.object_id = OBJECT_ID(${obj}) AND i.name IS NOT NULL ORDER BY i.name, ic.key_ordinal`),
        (r) => ({ name: String(r[0]), unique: !!r[1], columns: [String(r[2])] }), (r) => String(r[2]));
      const fk = await q(`SELECT fk.name, rs.name, rt.name, pc.name, rc.name FROM sys.foreign_keys fk JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
        JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id
        JOIN sys.schemas rs ON rs.schema_id = rt.schema_id JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
        WHERE fk.parent_object_id = OBJECT_ID(${obj}) ORDER BY fk.name, fkc.constraint_column_id`);
      foreignKeys = [];
      for (const r of fk) {
        const cur = foreignKeys.find((x) => x.name === String(r[0]));
        if (cur) { cur.columns.push(String(r[3])); cur.refColumns.push(String(r[4])); }
        else foreignKeys.push({ name: String(r[0]), columns: [String(r[3])], refSchema: String(r[1]), refTable: String(r[2]), refColumns: [String(r[4])] });
      }
    }
    let rowCount: number | null = null;
    try { rowCount = Number((await q(`SELECT COUNT(*) FROM ${qualified(cfg, schema, table)}`))[0]?.[0]); } catch { /* a view that cannot be counted */ }
    return { schema, table, columns, primaryKey: columns.filter((x) => x.key === 'PRI').map((x) => x.name), indexes, foreignKeys, rowCount };
  });
}

export interface DbMatch { schema: string; table: string; column?: string; type: 'table' | 'view' | 'column' }

/** Tables and columns whose name contains `text`, across everything the connection can see (or the file, for SQLite). */
export async function dbSearch(cfg: DatabaseConfig, p: { database?: string; query: string }): Promise<DbMatch[]> {
  const text = typeof p.query === 'string' ? p.query.trim() : '';
  if (!text || text.length > 100) throw new ObjectError('Give a name to look for (up to 100 characters)');
  if (p.database !== undefined) name(p.database, 'The database');
  const like = lit(`%${text.replace(/[!%_]/g, '!$&')}%`) + " ESCAPE '!'";
  const LIMIT = 200;
  return withConn(cfg, p.database, async (c) => {
    const q = async (sql: string) => (await c.run(sql, internal(cfg))).rows;
    if (cfg.engine === 'sqlite') {
      const tables = await q("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name");
      const out: DbMatch[] = [], needle = text.toLowerCase();
      for (const t of tables) {
        const tn = String(t[0]), kind = t[1] === 'view' ? 'view' as const : 'table' as const;
        if (tn.toLowerCase().includes(needle)) out.push({ schema: 'main', table: tn, type: kind });
        for (const col of await q(`PRAGMA table_info(${lit(tn)})`)) if (String(col[1]).toLowerCase().includes(needle)) out.push({ schema: 'main', table: tn, column: String(col[1]), type: 'column' });
        if (out.length >= LIMIT) break;
      }
      return out.slice(0, LIMIT);
    }
    const sys = cfg.engine === 'mysql' ? "('information_schema','mysql','performance_schema','sys')" : cfg.engine === 'postgresql' ? "('pg_catalog','information_schema')" : "('INFORMATION_SCHEMA','sys')";
    const top = cfg.engine === 'mssql' ? `TOP ${LIMIT} ` : '', limit = cfg.engine === 'mssql' ? '' : ` LIMIT ${LIMIT}`;
    const tables = await q(`SELECT ${top}table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema NOT IN ${sys} AND table_name LIKE ${like} ORDER BY 1, 2${limit}`);
    const cols = await q(`SELECT ${top}table_schema, table_name, column_name FROM information_schema.columns WHERE table_schema NOT IN ${sys} AND column_name LIKE ${like} ORDER BY 1, 2, 3${limit}`);
    return [
      ...tables.map((r) => ({ schema: String(r[0]), table: String(r[1]), type: /view/i.test(String(r[2])) ? 'view' as const : 'table' as const })),
      ...cols.map((r) => ({ schema: String(r[0]), table: String(r[1]), column: String(r[2]), type: 'column' as const })),
    ].slice(0, LIMIT);
  });
}

/** The statement that creates a table. MySQL and SQLite keep it; for PostgreSQL and SQL Server it is put together from the catalog. */
export async function dbDdl(cfg: DatabaseConfig, p: { database?: string; schema: string; table: string }): Promise<string> {
  const schema = name(p.schema, 'The schema'), table = name(p.table, 'The table');
  if (p.database !== undefined) name(p.database, 'The database');
  if (cfg.engine === 'postgresql') {
    return withConn(cfg, p.database, async (c) => {
      const q = async (sql: string) => (await c.run(sql, internal(cfg))).rows;
      const cols = await q(`SELECT a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull, pg_get_expr(d.adbin, d.adrelid) FROM pg_attribute a JOIN pg_class t ON t.oid = a.attrelid JOIN pg_namespace n ON n.oid = t.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE n.nspname = ${lit(schema)} AND t.relname = ${lit(table)} AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`);
      if (!cols.length) throw new ObjectError('That table does not exist');
      const cons = await q(`SELECT con.conname, pg_get_constraintdef(con.oid) FROM pg_constraint con JOIN pg_class t ON t.oid = con.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = ${lit(schema)} AND t.relname = ${lit(table)} ORDER BY con.contype, con.conname`);
      const idx = await q(`SELECT indexdef FROM pg_indexes WHERE schemaname = ${lit(schema)} AND tablename = ${lit(table)} AND indexname NOT IN (SELECT conname FROM pg_constraint WHERE contype IN ('p','u'))`);
      const lines = [...cols.map((r) => `  ${quoteIdent('postgresql', String(r[0]))} ${r[1]}${r[2] ? ' NOT NULL' : ''}${r[3] !== null ? ` DEFAULT ${r[3]}` : ''}`), ...cons.map((r) => `  CONSTRAINT ${quoteIdent('postgresql', String(r[0]))} ${r[1]}`)];
      return [`CREATE TABLE ${qualified(cfg, schema, table)} (\n${lines.join(',\n')}\n);`, ...idx.map((r) => `${r[0]};`)].join('\n');
    });
  }
  if (cfg.engine === 'mssql') {
    const d = await dbDescribe(cfg, p);
    return withConn(cfg, p.database, async (c) => {
      const rows = (await c.run(`SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ${lit(schema)} AND TABLE_NAME = ${lit(table)} ORDER BY ORDINAL_POSITION`, internal(cfg))).rows;
      if (!rows.length) throw new ObjectError('That table does not exist');
      const type = (r: unknown[]) => { const t = String(r[1]); return /char|binary/i.test(t) ? `${t}(${Number(r[2]) < 0 ? 'max' : r[2]})` : /decimal|numeric/i.test(t) ? `${t}(${r[3]},${r[4]})` : t; };
      const lines = rows.map((r) => `  ${quoteIdent('mssql', String(r[0]))} ${type(r)}${r[5] === 'YES' ? ' NULL' : ' NOT NULL'}${r[6] !== null ? ` DEFAULT ${r[6]}` : ''}`);
      if (d.primaryKey.length) lines.push(`  PRIMARY KEY (${d.primaryKey.map((x) => quoteIdent('mssql', x)).join(', ')})`);
      for (const f of d.foreignKeys) lines.push(`  CONSTRAINT ${quoteIdent('mssql', f.name)} FOREIGN KEY (${f.columns.map((x) => quoteIdent('mssql', x)).join(', ')}) REFERENCES ${qualified(cfg, f.refSchema ?? schema, f.refTable)} (${f.refColumns.map((x) => quoteIdent('mssql', x)).join(', ')})`);
      const idx = d.indexes.filter((i) => !(d.primaryKey.length && i.columns.join() === d.primaryKey.join() && i.unique)).map((i) => `CREATE ${i.unique ? 'UNIQUE ' : ''}INDEX ${quoteIdent('mssql', i.name)} ON ${qualified(cfg, schema, table)} (${i.columns.map((x) => quoteIdent('mssql', x)).join(', ')});`);
      return [`CREATE TABLE ${qualified(cfg, schema, table)} (\n${lines.join(',\n')}\n);`, ...idx].join('\n');
    });
  }
  return withConn(cfg, p.database, async (c) => {
    const q = async (sql: string) => (await c.run(sql, internal(cfg))).rows;
    if (cfg.engine === 'sqlite') {
      const rows = await q(`SELECT sql FROM sqlite_master WHERE tbl_name = ${lit(table)} AND sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 0 ELSE 1 END, name`);
      if (!rows.length) throw new ObjectError('That table does not exist');
      return rows.map((r) => `${String(r[0]).replace(/;\s*$/, '')};`).join('\n');
    }
    const r = (await q(`SHOW CREATE TABLE ${qualified(cfg, schema, table)}`))[0];
    if (!r) throw new ObjectError('That table does not exist');
    return `${String(r[1])};`;
  });
}

/** The first rows of a table, without writing SQL. */
export async function dbSample(cfg: DatabaseConfig, p: { database?: string; schema: string; table: string; limit?: number }): Promise<DbResult> {
  const schema = name(p.schema, 'The schema'), table = name(p.table, 'The table');
  const n = Math.max(1, Math.min(Number.isFinite(Number(p.limit)) ? Math.floor(Number(p.limit)) : 10, cfg.maxRows ?? DEFAULT_ROWS));
  const from = qualified(cfg, schema, table);
  const sql = cfg.engine === 'mssql' ? `SELECT TOP (${n}) * FROM ${from}` : `SELECT * FROM ${from} LIMIT ${n}`;
  return dbQuery(cfg, { sql, database: p.database, readOnly: true });
}

/** The plan the engine would follow, without running the statement. */
export async function dbExplain(cfg: DatabaseConfig, p: { sql: string; database?: string }): Promise<DbResult> {
  if (typeof p.sql !== 'string' || !p.sql.trim()) throw new ObjectError('Write a query');
  if (p.database !== undefined) name(p.database, 'The database');
  const statements = splitStatements(p.sql, cfg.engine);
  if (statements.length !== 1) throw new ObjectError('Explain takes one statement');
  // EXPLAIN ANALYZE (and ANALYZE) run the statement to measure it: only the plain plan is offered.
  if (/^\s*(explain|analy[sz]e|describe|desc)\b/i.test(bare(statements[0]))) throw new ObjectError('Give the statement itself, not an EXPLAIN or ANALYZE of it.');
  const t0 = Date.now();
  const r = await withConn(cfg, p.database, async (c) => {
    const o = internal(cfg);
    if (c.explain) return c.explain(statements[0], o);
    // MySQL refuses EXPLAIN of a write on a read-only connection although it does not run it.
    return c.run(`${cfg.engine === 'sqlite' ? 'EXPLAIN QUERY PLAN' : 'EXPLAIN'} ${statements[0]}`, cfg.engine === 'mysql' ? { ...o, readOnly: false } : o);
  });
  return { ...r, rows: r.rows.map((row) => row.map(cell)), ms: Date.now() - t0 };
}

/** Who is connected and what they are running. */
export async function dbSessions(cfg: DatabaseConfig): Promise<DbResult> {
  if (cfg.engine === 'sqlite') throw new ObjectError('SQLite has no sessions: it is a file, not a server.');
  const sql = cfg.engine === 'mysql' ? 'SHOW FULL PROCESSLIST'
    : cfg.engine === 'postgresql' ? "SELECT pid, usename, datname, state, now() - query_start AS running, left(query, 200) AS query FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND backend_type = 'client backend' ORDER BY query_start NULLS LAST"
    : "SELECT s.session_id, s.login_name, s.host_name, DB_NAME(s.database_id) AS db, s.status, r.command, r.total_elapsed_time / 1000 AS seconds, SUBSTRING(t.text, 1, 200) AS query FROM sys.dm_exec_sessions s LEFT JOIN sys.dm_exec_requests r ON r.session_id = s.session_id OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t WHERE s.is_user_process = 1 AND s.session_id <> @@SPID";
  const t0 = Date.now();
  const r = await withConn(cfg, undefined, (c) => c.run(sql, internal(cfg)));
  return { ...r, rows: r.rows.map((row) => row.map(cell)), ms: Date.now() - t0 };
}

/** Cancels what a session is running (MySQL, PostgreSQL) or ends the session (SQL Server). */
export async function dbKill(cfg: DatabaseConfig, id: unknown): Promise<string> {
  if (cfg.engine === 'sqlite') throw new ObjectError('SQLite has no sessions to cancel.');
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new ObjectError('The id must be a session number from object_db_sessions');
  await withConn(cfg, undefined, async (c) => {
    const o = { ...internal(cfg), readOnly: false };
    if (cfg.engine === 'mysql') await c.run(`KILL QUERY ${n}`, o);
    else if (cfg.engine === 'postgresql') { const r = await c.run(`SELECT pg_cancel_backend(${n})`, o); if (r.rows[0]?.[0] === false) throw new ObjectError(`There is no running query for session ${n}`); }
    else await c.run(`KILL ${n}`, o);
  });
  return cfg.engine === 'mssql' ? `Session ${n} was ended.` : `The query of session ${n} was cancelled.`;
}
