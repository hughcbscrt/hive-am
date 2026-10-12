// Database objects: the configuration (what is accepted, what is refused, the password that never leaves), the read-only check, SQLite for real
// (schema, queries, row limit, timeout, writes when allowed), and MySQL/MariaDB, PostgreSQL and SQL Server when a server is given through
// the environment (DBT_MYSQL_PORT, DBT_PG_PORT, DBT_MSSQL_PORT; user and password as below). Usage:
//   HIVE_AM_OBJECT_POLL_MS=60000 HIVE_AM_HOME=$(mktemp -d) DBT_PG_PORT=54320 DBT_MYSQL_PORT=33060 DBT_MSSQL_PORT=14330 npx tsx scripts/test-object-database.ts
import './_guard.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { ObjectError, createObject, dbColumnsOf, dbHistory, dbHistoryClear, dbRun, dbSavedAdd, dbSavedList, dbSavedRemove, dbSchemaOf, dbTestConfig, listObjects, objectAction, objectLogs, stateOf, updateObject, removeObject } from '../src/objects/index.js';
import { assertReadOnly, cell } from '../src/objects/database.js';
import { objectsStore } from '../src/objects/store.js';
import { DRIVER_PROPS } from '../src/objects/driver-props.js';

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const rejects = async (fn: () => unknown, re: RegExp) => { try { await fn(); return false; } catch (e) { return e instanceof ObjectError && re.test(e.message); } };
const refuses = (sql: string) => { try { assertReadOnly(sql); return false; } catch { return true; } };

// ---------------------------------------------------------------- the read-only check
check(!refuses('SELECT * FROM users WHERE name = \'delete\''), 'a word inside quotes is not a write');
check(!refuses('select updated_at, created_at from t -- drop table t'), 'a word in a comment or a longer name is not a write');
check(!refuses('WITH a AS (SELECT 1) SELECT * FROM a;'), 'a WITH ... SELECT passes, and so does a trailing ;');
check(!refuses('EXPLAIN SELECT 1') && !refuses('SHOW TABLES') && !refuses('PRAGMA table_info(t)'), 'EXPLAIN, SHOW and PRAGMA (reading) pass');
check(refuses('DELETE FROM t') && refuses('update t set a=1') && refuses('INSERT INTO t VALUES (1)') && refuses('drop table t') && refuses('TRUNCATE t'), 'writes are refused');
check(refuses('SELECT 1; DROP TABLE t') && refuses('SELECT 1; SELECT 2'), 'two statements are refused');
check(refuses('WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x') && refuses('SELECT * INTO copy FROM t') && refuses('EXPLAIN ANALYZE DELETE FROM t'), 'a write hidden in a WITH, a SELECT INTO and EXPLAIN ANALYZE of a write are refused');
check(refuses('PRAGMA journal_mode = DELETE') && refuses('SELECT 1 /* x */; /**/ DROP TABLE t'), 'a PRAGMA that sets, and a comment between statements, are refused');
check(refuses('') && refuses('  -- nothing'), 'an empty query is refused');
check(cell(10n) === '10' && cell(new Date(0)) === '1970-01-01T00:00:00.000Z' && cell(Buffer.from([1, 2])) === '0x0102' && cell({ a: 1 }) === '{"a":1}' && cell(undefined) === null, 'values come out as text, numbers or null');

// ---------------------------------------------------------------- the configuration
const dir = mkdtempSync(join(tmpdir(), 'hive-db-'));
const file = join(dir, 'app.db');
const seed = new Database(file);
seed.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT); CREATE TABLE logs (id INTEGER PRIMARY KEY, msg TEXT); CREATE VIEW active AS SELECT * FROM users WHERE email IS NOT NULL;");
const ins = seed.prepare('INSERT INTO users (name, email) VALUES (?, ?)');
for (let i = 1; i <= 2500; i++) ins.run(`user ${i}`, i % 5 ? `u${i}@x.test` : null);
seed.close();

check(await rejects(() => createObject({ name: 'bad1', kind: 'database', config: {} }), /engine/i), 'an engine is required');
check(await rejects(() => createObject({ name: 'bad2', kind: 'database', config: { engine: 'oracle' } }), /engine/i), 'an engine that is not offered is refused');
check(await rejects(() => createObject({ name: 'bad3', kind: 'database', config: { engine: 'sqlite', file: 'app.db' } }), /absolute/), 'a SQLite file must be an absolute path');
check(await rejects(() => createObject({ name: 'bad4', kind: 'database', config: { engine: 'postgresql', host: 'a b;c' } }), /host/), 'a host with spaces is refused');
check(await rejects(() => createObject({ name: 'bad5', kind: 'database', config: { engine: 'mysql', port: 99999 } }), /port/), 'a port out of range is refused');
check(await rejects(() => createObject({ name: 'bad6', kind: 'database', config: { engine: 'mysql', database: 'a;b' } }), /database/), 'a database name with ; is refused');

const lite = createObject({ name: 'lite', kind: 'database', config: { engine: 'sqlite', file } });
check(lite.kind === 'database' && (lite.config as any).readOnly === true, 'a database is read-only unless it says otherwise');
await stateOf(objectsStore.get(lite.id)!);
check(listObjects().find((o) => o.id === lite.id)?.state.status === 'ready' && /SQLite 3/.test(listObjects().find((o) => o.id === lite.id)?.state.detail ?? ''), 'its state is ready, with the version of the engine');
check(await rejects(() => objectAction(lite.id, 'start'), /not started/), 'a database is not started or stopped');
check((await objectLogs(lite.id, {})).text === '', 'a database has no logs');
const gone = createObject({ name: 'lite-gone', kind: 'database', config: { engine: 'sqlite', file: join(dir, 'nope.db') } });
check((await stateOf(objectsStore.get(gone.id)!)).status === 'error', 'a file that is not there is an error');

// ---------------------------------------------------------------- SQLite for real
const sc = await dbSchemaOf(lite.id);
check(sc.tables.map((t) => `${t.name}:${t.type}`).join() === 'active:view,logs:table,users:table', 'the schema lists tables and views');
const cols = await dbColumnsOf(lite.id, { schema: 'main', table: 'users' });
check(cols.length === 3 && cols[0].key === 'PRI' && cols[1].nullable === false && cols[2].nullable === true, 'the columns say their key and whether they accept null');
const q1 = await dbRun(lite.id, { sql: 'SELECT id, name FROM users ORDER BY id LIMIT 3' });
check(q1.columns.map((c) => c.name).join() === 'id,name' && q1.rows.length === 3 && q1.rows[0][1] === 'user 1' && !q1.truncated, 'a query returns columns and rows');
const q2 = await dbRun(lite.id, { sql: 'SELECT * FROM users' });
check(q2.rows.length === 1000 && q2.truncated, 'a result stops at the row limit (1000) and says so');
check(await rejects(() => dbRun(lite.id, { sql: "UPDATE users SET name = 'x'" }), /read-only/), 'a read-only object refuses a write');
check(await rejects(() => dbRun(lite.id, { sql: 'SELECT nope FROM users' }), /nope/), 'an error from the engine comes back as a message');
const hist = await dbHistory(lite.id);
check(hist.length === 4 && hist[0].ok === false && hist[1].ok === false && hist[2].rows === 1000 && hist[3].rows === 3, 'every query is in the history, with its outcome');

const rw = updateObject(lite.id, { config: { engine: 'sqlite', file, readOnly: false, maxRows: 5, timeoutSec: 2 } });
check((rw.config as any).readOnly === false && (rw.config as any).maxRows === 5, 'read-only can be turned off, and the limits changed');
const w = await dbRun(lite.id, { sql: "UPDATE users SET name = 'renamed' WHERE id <= 2" });
check(w.affected === 2 && w.columns.length === 0, 'a write says how many rows it changed');
check((await dbRun(lite.id, { sql: "SELECT name FROM users WHERE id = 1" })).rows[0][0] === 'renamed', 'and it was written');
check((await dbRun(lite.id, { sql: 'SELECT * FROM users' })).rows.length === 5, 'the new row limit applies');
const slow = Date.now();
check(await rejects(() => dbRun(lite.id, { sql: 'WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r) SELECT count(*) FROM r' }), /took more than 2 s/) && Date.now() - slow < 5000, 'a query that never ends is stopped at the timeout (and does not freeze the app)');
check((await dbRun(lite.id, { sql: 'SELECT 1' })).rows[0][0] === 1, 'and the app goes on working');
{ const c0 = process.cpuUsage(); await new Promise((r) => setTimeout(r, 1000)); const c = process.cpuUsage(c0); check((c.user + c.system) / 1000 < 300, 'and the query that never ends does not go on using a core after it was stopped'); }

const s1 = dbSavedAdd(lite.id, { name: 'count users', sql: 'SELECT count(*) FROM users' });
check(dbSavedList(lite.id).length === 1 && dbSavedList(lite.id)[0].name === 'count users', 'a query can be saved with a name');
check(await rejects(() => dbSavedAdd(lite.id, { name: '', sql: 'x' }), /name/), 'a saved query needs a name');
check(dbSavedRemove(lite.id, s1.id).length === 0, 'and removed');
check(dbHistoryClear(lite.id).length === 0 && dbHistory(lite.id).length === 0, 'the history can be cleared');

// ---------------------------------------------------------------- driver properties
check(Object.values(DRIVER_PROPS).flat().every((x) => x.es && x.es !== x.desc), 'every driver property has its description in Spanish');
check(Object.values(DRIVER_PROPS).every((l) => new Set(l.map((x) => x.name)).size === l.length), 'and no engine lists a property twice');
const lp = (cfg: object) => ({ engine: 'sqlite', file, ...cfg });
check(await rejects(() => createObject({ name: 'p1', kind: 'database', config: lp({ props: { nope: '1' } }) }), /not a property/), 'a property the driver does not take is refused');
check(await rejects(() => createObject({ name: 'p2', kind: 'database', config: lp({ props: { timeout: 'abc' } }) }), /whole number/), 'a number property needs a number');
check(await rejects(() => createObject({ name: 'p3', kind: 'database', config: lp({ props: { timeout: '99999999' } }) }), /whole number/), 'and one inside its range');
check(await rejects(() => createObject({ name: 'p4', kind: 'database', config: lp({ props: { foreign_keys: 'yes' } }) }), /true or false/), 'a boolean property is true or false');
check(await rejects(() => createObject({ name: 'p5', kind: 'database', config: lp({ props: { temp_store: 'disk; DROP TABLE x' } }) }), /one of/), 'a choice property takes only its choices');
check(await rejects(() => createObject({ name: 'p6', kind: 'database', config: { engine: 'postgresql', props: { 'ssl.ca': '/tmp/x.pem' } } }), /need "Use SSL"/), 'the SSL properties need SSL on');
check(await rejects(() => createObject({ name: 'p7', kind: 'database', config: { engine: 'postgresql', ssl: true, props: { 'ssl.ca': 'relative.pem' } } }), /absolute path/), 'a file property is an absolute path');
check(await rejects(() => createObject({ name: 'p8', kind: 'database', config: { engine: 'mysql', props: { multipleStatements: 'true' } } }), /not a property/), 'what hive-am decides (multipleStatements) cannot be set');
check(await rejects(() => createObject({ name: 'p9', kind: 'database', config: { engine: 'postgresql', props: { search_path: 'a; DROP TABLE x' } } }), /not allowed/), 'a search_path with a ; is refused');
const withProps = createObject({ name: 'lite-props', kind: 'database', config: lp({ props: { foreign_keys: 'false', cache_size: '-4000', case_sensitive_like: 'true', temp_store: 'memory', timeout: '1500', pgonly: '' } }) });
check(JSON.stringify((withProps.config as any).props) === JSON.stringify({ foreign_keys: 'false', cache_size: '-4000', case_sensitive_like: 'true', temp_store: 'memory', timeout: '1500' }), 'the properties are saved, and an empty one is dropped');
const pr = await dbRun(withProps.id, { sql: 'PRAGMA foreign_keys' });
const pc = await dbRun(withProps.id, { sql: 'PRAGMA cache_size' });
const pt = await dbRun(withProps.id, { sql: 'PRAGMA temp_store' });
check(Number(pr.rows[0][0]) === 0 && Number(pc.rows[0][0]) === -4000 && Number(pt.rows[0][0]) === 2, 'SQLite: the properties apply to the connection (foreign_keys, cache_size, temp_store)');
const lk = await dbRun(withProps.id, { sql: "SELECT 'a' LIKE 'A'" });
check(Number(lk.rows[0][0]) === 0, 'SQLite: case_sensitive_like makes LIKE case sensitive');
const nl = await dbRun(lite.id, { sql: 'PRAGMA foreign_keys' });
check(Number(nl.rows[0][0]) === 1, 'and an object without them keeps the default (foreign keys on)');
await removeObject(withProps.id);
const caFile = join(dir, 'ca.pem');
const sslObj = createObject({ name: 'pg-ssl-missing', kind: 'database', config: { engine: 'postgresql', host: '127.0.0.1', port: 1, ssl: true, props: { 'ssl.ca': join(dir, 'missing.pem') } } });
check(await rejects(() => dbRun(sslObj.id, { sql: 'SELECT 1' }), /"ssl.ca": the file .* cannot be read/), 'a certificate file that is not there says which property and which file');
await removeObject(sslObj.id); void caFile;

// ---------------------------------------------------------------- the password stays on the server
const user = process.env.DBT_USER ?? 'root';
const pw = process.env.DBT_PASSWORD ?? 'pw123';
const engines: { id: 'mysql' | 'postgresql' | 'mssql'; port?: string; user: string; password: string; db: string; ssl?: boolean }[] = [
  { id: 'mysql', port: process.env.DBT_MYSQL_PORT, user: 'root', password: pw, db: 'app' },
  { id: 'postgresql', port: process.env.DBT_PG_PORT, user: 'postgres', password: pw, db: 'app' },
  { id: 'mssql', port: process.env.DBT_MSSQL_PORT, user: 'sa', password: process.env.DBT_MSSQL_PASSWORD ?? 'Str0ngPass!word', db: 'master' },
];
void user;
for (const e of engines) {
  if (!e.port) { console.log(`SKIP  ${e.id}: no DBT_${e.id === 'postgresql' ? 'PG' : e.id.toUpperCase()}_PORT`); continue; }
  const cfg = { engine: e.id, host: '127.0.0.1', port: Number(e.port), user: e.user, password: e.password, database: e.db, readOnly: true };
  const t = await dbTestConfig({ config: cfg });
  check(t.ok && t.version.length > 3, `${e.id}: the connection is tested before saving (${t.version})`);
  check(await rejects(() => dbTestConfig({ config: { ...cfg, password: 'wrong-password-123' } }), /./) && !(await dbTestConfig({ config: { ...cfg, password: 'wrong-password-123' } }).catch((x) => String(x.message))).includes?.('wrong-password-123'), `${e.id}: a wrong password is an error that does not repeat the password`);
  const o = createObject({ name: `${e.id}-db`, kind: 'database', config: cfg });
  const view = listObjects().find((x) => x.id === o.id)!;
  check((view.config as any).password === '' && (view.config as any).passwordSet === true && !JSON.stringify(view).includes(e.password), `${e.id}: the view of the object has no password, only that there is one`);
  const again = updateObject(o.id, { config: { ...cfg, password: '', readOnly: true } });
  check((objectsStore.get(again.id)!.config as any).password === e.password, `${e.id}: saving with the password empty keeps the saved one`);
  check(await dbTestConfig({ id: o.id, config: { ...cfg, password: '' } }).then((r) => r.ok, () => false), `${e.id}: testing with the password empty uses the saved one`);
  check((await stateOf(objectsStore.get(o.id)!)).status === 'ready', `${e.id}: state ready`);
  const one = await dbRun(o.id, { sql: e.id === 'mssql' ? 'SELECT 1 AS n, N\'héllo\' AS s' : "SELECT 1 AS n, 'héllo' AS s" });
  check(one.columns.map((c) => c.name).join() === 'n,s' && Number(one.rows[0][0]) === 1 && one.rows[0][1] === 'héllo', `${e.id}: a query returns what was asked (${one.ms} ms)`);
  check(await rejects(() => dbRun(o.id, { sql: 'CREATE TABLE t_ro (a int)' }), /read-only/), `${e.id}: read-only refuses a write`);
  // driver properties that reach the connection
  const probe = e.id === 'postgresql' ? { props: { application_name: 'hive-test', search_path: 'pg_catalog, public' }, sql: "SELECT current_setting('application_name') || '|' || current_setting('search_path')", want: 'hive-test|pg_catalog,public' }
    : e.id === 'mysql' ? { props: { charset: 'LATIN1_SWEDISH_CI', timezone: 'Z' }, sql: 'SELECT @@character_set_client', want: 'latin1' }
    : { props: { appName: 'hive-test', workstationId: 'hive-host' }, sql: "SELECT APP_NAME() + '|' + HOST_NAME()", want: 'hive-test|hive-host' };
  updateObject(o.id, { config: { ...cfg, password: '', props: probe.props } });
  const pq = await dbRun(o.id, { sql: probe.sql });
  check(String(pq.rows[0][0]) === probe.want, `${e.id}: driver properties reach the connection (${pq.rows[0][0]})`);
  check((await dbTestConfig({ config: { ...cfg, props: probe.props } })).ok, `${e.id}: the test of a connection takes the properties of the form`);
  // write and read back, with the row limit and the timeout
  updateObject(o.id, { config: { ...cfg, password: '', readOnly: false, maxRows: 50, timeoutSec: 3 } });
  const tname = 'hive_test_t';
  await dbRun(o.id, { sql: `DROP TABLE IF EXISTS ${tname}` }).catch(() => dbRun(o.id, { sql: `IF OBJECT_ID('${tname}') IS NOT NULL DROP TABLE ${tname}` }));
  await dbRun(o.id, { sql: `CREATE TABLE ${tname} (id int PRIMARY KEY, name varchar(50) NOT NULL, note varchar(50) NULL)` });
  const rows = Array.from({ length: 200 }, (_, i) => `(${i + 1}, 'n${i + 1}', ${i % 2 ? "'x'" : 'NULL'})`).join(',');
  const wr = await dbRun(o.id, { sql: `INSERT INTO ${tname} (id, name, note) VALUES ${rows}` });
  check(wr.affected === 200, `${e.id}: an insert says how many rows (${wr.affected})`);
  const big = await dbRun(o.id, { sql: `SELECT * FROM ${tname} ORDER BY id` });
  check(big.rows.length === 50 && big.truncated && big.columns.length === 3, `${e.id}: the row limit cuts the result and says so`);
  const sch = await dbSchemaOf(o.id);
  check(sch.database !== '' && sch.tables.some((x) => x.name === tname), `${e.id}: the schema lists the table (${sch.tables.length} tables, ${sch.databases.length} databases)`);
  const sc2 = sch.tables.find((x) => x.name === tname)!;
  const cc = await dbColumnsOf(o.id, { schema: sc2.schema, table: tname });
  check(cc.map((c) => c.name).join() === 'id,name,note' && cc[2].nullable && !cc[1].nullable, `${e.id}: the columns say if they accept null (${cc.map((c) => c.type).join(' / ')})`);
  const t0 = Date.now();
  const sleepSql = e.id === 'postgresql' ? 'SELECT pg_sleep(10)' : e.id === 'mysql' ? 'SELECT SLEEP(10)' : "WAITFOR DELAY '00:00:10'";
  check(await rejects(() => dbRun(o.id, { sql: sleepSql }), /./) && Date.now() - t0 < 7000, `${e.id}: a slow query is stopped at the timeout (${Date.now() - t0} ms)`);
  check((await dbRun(o.id, { sql: 'SELECT 1' })).rows.length === 1, `${e.id}: and it still works after`);
  await dbRun(o.id, { sql: `DROP TABLE ${tname}` });
  await removeObject(o.id);
}

await removeObject(lite.id); await removeObject(gone.id);
console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
