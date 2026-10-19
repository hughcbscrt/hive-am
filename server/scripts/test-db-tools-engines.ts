// The database tools against real servers, one battery per engine: structure (describe, search, ddl), scripts that are all or nothing,
// sessions and kill, the plan, changing a connection and creating one with a password, and the password never coming back. It needs a server
// per engine, given through the environment (the ones that are not given are skipped); SQLite is in test-db-tools.ts. Usage:
//   HIVE_AM_OBJECT_POLL_MS=60000 HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4485 DBT_MYSQL_PORT=33061 DBT_PG_PORT=54321 DBT_MSSQL_PORT=14331 npx tsx scripts/test-db-tools-engines.ts
// (user and password: root / postgres / sa, with DBT_PASSWORD (default pw123) and DBT_MSSQL_PASSWORD (default Str0ngPass!word))
import './_guard.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agents, colonies, skills } from '../src/db.js';
import { DATABASES_SKILL_ID, DEFAULT_SKILLS } from '../src/skills/defaults.js';
import { agentDb } from '../src/objects/agent-db.js';
import { dbQuery } from '../src/objects/database.js';
import { listQueries } from '../src/objects/db-history.js';
import { objectsStore } from '../src/objects/store.js';
import { removeObject, setObjectManager } from '../src/objects/index.js';
import { ObjectError, type DatabaseConfig } from '../src/objects/model.js';

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

skills.seedDefaults(DEFAULT_SKILLS);
const dir = mkdtempSync(join(tmpdir(), 'dbeng-'));
const colony = colonies.create({ name: 'eng-colony', color: '#2f8f5b', cwd: dir, permission: 'acceptEdits', system_prompt: '', skill_ids: [], inherit: { permission: false, cwd: false } } as any);
const mk = (name: string, permission: string) => agents.create({ name, role: 'worker', provider: 'claude', model: '', cwd: dir, permission, colony_id: colony.id, skill_ids: [DATABASES_SKILL_ID] } as any);
const boss = mk('eng-boss', 'bypassPermissions'), editor = mk('eng-editor', 'acceptEdits');
const as = (a: { id: string }, op: string, args: Record<string, unknown> = {}) => agentDb(op, { from: a.id, ...args }) as Promise<any>;
const fails = async (fn: () => Promise<unknown>, re: RegExp) => { try { await fn(); return false; } catch (e) { return e instanceof ObjectError && re.test(e.message); } };

const pw = process.env.DBT_PASSWORD ?? 'pw123';
const engines = [
  { id: 'mysql' as const, port: process.env.DBT_MYSQL_PORT, user: 'root', password: pw, db: 'app', sleep: 'SELECT SLEEP(20)', slow: /sleep/i },
  { id: 'postgresql' as const, port: process.env.DBT_PG_PORT, user: 'postgres', password: pw, db: 'app', sleep: 'SELECT pg_sleep(20)', slow: /pg_sleep/i },
  { id: 'mssql' as const, port: process.env.DBT_MSSQL_PORT, user: 'sa', password: process.env.DBT_MSSQL_PASSWORD ?? 'Str0ngPass!word', db: 'master', sleep: "WAITFOR DELAY '00:00:20'", slow: /waitfor/i },
];

for (const e of engines) {
  if (!e.port) { console.log(`SKIP  ${e.id}: no DBT_${e.id === 'postgresql' ? 'PG' : e.id.toUpperCase()}_PORT`); continue; }
  const name = `${e.id}-eng`;
  const cfg = { engine: e.id, host: '127.0.0.1', port: Number(e.port), user: e.user, password: e.password, database: e.db };
  let created = false;
  for (let i = 0; i < 40 && !created; i++) { try { await as(boss, 'create', { name, config: cfg }); created = true; } catch (x) { if (i === 39) throw x; await sleep(1500); } }
  check(created, `${e.id}: a Full access agent creates the resource (the connection is tested first)`);
  const row = objectsStore.byName(name)!;
  check(objectsStore.managers().get(row.id) === boss.id && (row.config as DatabaseConfig).password === e.password, `${e.id}: it becomes the manager and the password is stored`);
  check(!JSON.stringify(await as(boss, 'config', { name })).includes(e.password) && (await as(boss, 'config', { name })).config.passwordSet === true, `${e.id}: config shows no password, only that there is one`);
  setObjectManager(row.id, null);                                       // back to the agents of its colony, so the other agent can use it too
  // The resource is read-only by default (a setting of the panel): the agent still writes.
  check((row.config as DatabaseConfig).readOnly !== false, `${e.id}: the resource is read-only`);

  const c = (sql: string, who = boss, extra: Record<string, unknown> = {}) => as(who, 'query', { name, sql, ...extra });
  const T1 = 'hive_t_customers', T2 = 'hive_t_orders';
  for (const t of [T2, T1]) await c(`DROP TABLE ${t}`).catch(() => undefined);
  await c(`CREATE TABLE ${T1} (id int PRIMARY KEY, name varchar(50) NOT NULL, email varchar(80) NULL)`);
  await c(`CREATE TABLE ${T2} (id int PRIMARY KEY, customer_id int NOT NULL, total decimal(10,2) NULL, CONSTRAINT fk_hive_o_c FOREIGN KEY (customer_id) REFERENCES ${T1}(id))`);
  await c(`CREATE INDEX idx_hive_o_c ON ${T2} (customer_id)`);
  const ins = await c(`INSERT INTO ${T1} (id, name, email) VALUES (1, 'Ana', 'a@x.test'), (2, 'Beto', NULL), (3, 'Carla', 'c@x.test')`, editor);
  check(ins.affected === 3, `${e.id}: an Edit files agent writes although the resource is read-only (${ins.affected} rows)`);
  await c(`INSERT INTO ${T2} (id, customer_id, total) VALUES (1, 1, 50), (2, 1, 150.5), (3, 2, 99)`, editor);

  const sch = await as(editor, 'schema', { name });
  const mine = sch.tables.find((t: any) => t.name === T2);
  check(!!mine && sch.tables.some((t: any) => t.name === T1), `${e.id}: schema lists the tables (${sch.tables.length}, ${sch.databases.length} databases)`);
  const schema = mine.schema;
  const cols = (await as(editor, 'columns', { name, schema, table: T1 })).columns;
  check(cols.map((x: any) => x.name).join() === 'id,name,email' && cols[0].key === 'PRI' && !cols[1].nullable && cols[2].nullable, `${e.id}: columns shows the key and the nulls`);
  const d = await as(editor, 'describe', { name, schema, table: T2 });
  check(d.rowCount === 3 && d.primaryKey.join() === 'id', `${e.id}: describe: row count and primary key (${d.rowCount}, ${d.primaryKey})`);
  check(d.indexes.some((i: any) => i.columns.join() === 'customer_id') && d.indexes.some((i: any) => i.unique && i.columns.join() === 'id'), `${e.id}: describe: the indexes, unique and not (${d.indexes.map((i: any) => i.name).join(', ')})`);
  const fk = d.foreignKeys.find((f: any) => f.columns.join() === 'customer_id');
  check(!!fk && fk.refTable === T1 && fk.refColumns.join() === 'id', `${e.id}: describe: the foreign key (${fk?.name} -> ${fk?.refTable})`);
  const s1 = await as(editor, 'search', { name, query: 'hive_t_' });
  check(s1.matches.some((m: any) => m.table === T1 && !m.column) && s1.matches.some((m: any) => m.table === T2 && !m.column), `${e.id}: search finds tables by name`);
  const s2 = await as(editor, 'search', { name, query: 'customer_id' });
  check(s2.matches.some((m: any) => m.table === T2 && m.column === 'customer_id'), `${e.id}: and columns`);
  check((await as(editor, 'search', { name, query: '100%_' })).matches.length === 0, `${e.id}: a % or _ in the text is not a wildcard`);
  const ddl = (await as(editor, 'ddl', { name, schema, table: T2 })).ddl as string;
  check(/hive_t_orders/i.test(ddl) && /customer_id/i.test(ddl) && /total/i.test(ddl), `${e.id}: ddl returns a CREATE statement`);
  // The statement must be good SQL: run it for a copy of the table in another schema-free name.
  const copy = 'hive_t_orders_copy';
  await c(`DROP TABLE ${copy}`).catch(() => undefined);
  const replaced = ddl.split(';').map((s) => s.trim()).filter(Boolean).filter((s) => !/^CREATE (UNIQUE )?INDEX/i.test(s)).join(';\n')
    .replace(/hive_t_orders/g, copy).replace(/CONSTRAINT\s+\S*fk_hive_o_c\S*/i, 'CONSTRAINT fk_hive_copy').replace(/hive_t_customers/g, T1);
  const ran = await as(boss, 'exec', { name, sql: replaced }).then(() => true, (x) => { console.log('      ddl did not run:', x.message, '\n', replaced); return false; });
  check(ran, `${e.id}: and that statement runs`);
  await c(`DROP TABLE ${copy}`).catch(() => undefined);
  const sm = await as(editor, 'sample', { name, schema, table: T1, limit: 2 });
  check(sm.rows.length === 2 && sm.columns.map((x: any) => x.name).join() === 'id,name,email', `${e.id}: sample returns the first rows`);
  const ex = await as(editor, 'explain', { name, sql: `SELECT * FROM ${T2} WHERE customer_id = 1` });
  check(ex.rows.length > 0, `${e.id}: explain returns a plan (${ex.rows.length} rows)`);
  const before = (await c(`SELECT COUNT(*) FROM ${T2}`)).rows[0][0];
  await as(editor, 'explain', { name, sql: `DELETE FROM ${T2}` });
  check(String((await c(`SELECT COUNT(*) FROM ${T2}`)).rows[0][0]) === String(before), `${e.id}: explain of a DELETE does not run it`);

  // A script is all or nothing (an ordinary DML, so MySQL's own commit on DDL is not involved).
  const x1 = await as(editor, 'exec', { name, sql: `INSERT INTO ${T1} (id, name) VALUES (10, 'Dani'); INSERT INTO ${T1} (id, name) VALUES (11, 'Eli'); UPDATE ${T1} SET name = 'Ana M' WHERE id = 1` });
  check(x1.results.length === 3 && x1.results[2].affected === 1, `${e.id}: exec runs the statements in one transaction`);
  const bad = await fails(() => as(editor, 'exec', { name, sql: `INSERT INTO ${T1} (id, name) VALUES (20, 'Fran'); INSERT INTO ${T1} (id, name) VALUES (1, 'duplicate'); INSERT INTO ${T1} (id, name) VALUES (21, 'Gus')` }), /Statement 2.*nothing was changed/);
  const left = (await c(`SELECT id FROM ${T1} WHERE id >= 20`)).rows.length;
  check(bad && left === 0, `${e.id}: one failing statement undoes the earlier one (${left} rows left over)`);
  check(await fails(() => as(editor, 'exec', { name, sql: `INSERT INTO ${T1} (id, name) VALUES (30, 'Hugo'); DROP TABLE ${T2}` }), /Full access/) && (await c(`SELECT COUNT(*) FROM ${T2}`)).rows[0][0] !== undefined, `${e.id}: a DROP in a script stops it before anything runs`);
  check(await fails(() => c(`TRUNCATE TABLE ${T2}`, editor), /Full access/), `${e.id}: TRUNCATE needs Full access`);

  // Sessions and kill: a slow query in another connection is found and cancelled.
  const cfgNow = objectsStore.byName(name)!.config as DatabaseConfig;
  const t0 = Date.now();
  const slow = dbQuery({ ...cfgNow, timeoutSec: 60, readOnly: false }, { sql: e.sleep, readOnly: false }).then(() => 'finished', (x) => `stopped: ${x.message}`);
  let target: string | undefined;
  for (let i = 0; i < 20 && !target; i++) {
    await sleep(500);
    const ss = await as(editor, 'sessions', { name });
    check(i > 0 || ss.columns.length > 0, `${e.id}: sessions answers a table`);
    target = ss.rows.find((r: unknown[]) => r.some((v) => typeof v === 'string' && e.slow.test(v)))?.[0];
  }
  check(target !== undefined, `${e.id}: sessions shows the running query (session ${target})`);
  check(await fails(() => as(editor, 'kill', { name, id: Number(target) }), /Full access/), `${e.id}: kill needs Full access`);
  const k = await as(boss, 'kill', { name, id: Number(target) });
  const outcome = await Promise.race([slow, sleep(8000).then(() => 'still running')]);
  check(/stopped/.test(String(outcome)) && Date.now() - t0 < 15000, `${e.id}: kill stops it (${String(k.text)} / ${Date.now() - t0} ms)`);
  check((await c('SELECT 1')).rows.length === 1, `${e.id}: and the resource keeps working`);

  // Another database of the server.
  const other = e.id === 'postgresql' ? 'postgres' : e.id === 'mysql' ? 'information_schema' : 'tempdb';
  const sw = await as(editor, 'schema', { name, database: other });
  check(sw.database.toLowerCase() === other && !sw.tables.some((t: any) => t.name === T1), `${e.id}: the database parameter switches to ${other} (${sw.database})`);

  // Changing the connection: tested first, never saved when it fails, and the password never comes back.
  const wrong = 'wrong-password-123';
  const cs1 = await as(boss, 'config_set', { name, config: { password: wrong } }).then(() => null, (x) => x as Error);
  check(!!cs1 && !cs1.message.includes(wrong) && !cs1.message.includes(e.password) && (objectsStore.byName(name)!.config as DatabaseConfig).password === e.password, `${e.id}: a wrong password is refused, not saved, and not repeated (${cs1?.message.slice(0, 60)})`);
  const cs2 = await as(boss, 'config_set', { name, config: { maxRows: 3, timeoutSec: 40, password: e.password } });
  check(cs2.saved && (objectsStore.byName(name)!.config as DatabaseConfig).maxRows === 3, `${e.id}: a good change is saved`);
  const cut = await c(`SELECT * FROM ${T1} ORDER BY id`);
  check(cut.rows.length === 3 && cut.truncated, `${e.id}: and the new row limit applies`);
  check(!JSON.stringify(listQueries(row.id)).includes(e.password), `${e.id}: no history entry holds the password`);
  const cu = e.id === 'mssql' ? `CREATE LOGIN hive_tmp WITH PASSWORD = 'Zx9!tempSecret'` : e.id === 'mysql' ? `CREATE USER IF NOT EXISTS 'hive_tmp'@'%' IDENTIFIED BY 'Zx9tempSecret'` : `CREATE ROLE hive_tmp LOGIN PASSWORD 'Zx9tempSecret'`;
  await c(cu).catch(() => undefined);
  check(!JSON.stringify(listQueries(row.id)).includes('Zx9') && listQueries(row.id).some((h) => /\*\*\*/.test(h.sql)), `${e.id}: the SQL that sets a password is masked in the history`);
  await c(e.id === 'mssql' ? 'DROP LOGIN hive_tmp' : e.id === 'mysql' ? "DROP USER IF EXISTS 'hive_tmp'@'%'" : 'DROP ROLE IF EXISTS hive_tmp').catch(() => undefined);

  await c(`DROP TABLE ${T2}`); await c(`DROP TABLE ${T1}`);
  const del = await as(boss, 'delete', { name });
  check(del.deleted === name && !objectsStore.byName(name), `${e.id}: delete removes the resource`);
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
void removeObject;
