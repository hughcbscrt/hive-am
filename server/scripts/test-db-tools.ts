// What an agent can do with a database resource, through the real MCP script and the real HTTP API (no model, no external server: SQLite):
// the tools exist only with the "Database management" skill, scope follows the colony or the chosen manager, the permission table holds
// (plan reads, acceptEdits writes but cannot DROP or TRUNCATE, Full access can), `readOnly` of the resource does not bind an agent, a script
// is all or nothing, an export stays in the agent's folder, and a password is never shown. Usage:
//   HIVE_AM_OBJECT_POLL_MS=60000 HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4483 npx tsx scripts/test-db-tools.ts
import './_guard.js';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { agents, colonies, skills } from '../src/db.js';
import '../src/index.js';
import { composeInstructions, mcpCaps } from '../src/instructions.js';
import { DATABASES_SKILL_ID, DEFAULT_SKILLS, OBJECTS_SKILL_ID } from '../src/skills/defaults.js';
import { createObject, removeObject, setObjectManager } from '../src/objects/index.js';
import { isDestructive, maskSecretsInSql, splitStatements } from '../src/objects/database.js';
import { listQueries } from '../src/objects/db-history.js';
import { objectsStore } from '../src/objects/store.js';
import { findSecret } from '../src/connections/secrets.js';

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };

// ---- the pieces that need no server ----
check(isDestructive('DROP TABLE t') && isDestructive('  truncate t') && isDestructive('ALTER TABLE t DROP COLUMN c') && isDestructive('SELECT 1; DROP TABLE t'), 'DROP, TRUNCATE and ALTER ... DROP are destructive, also after another statement');
check(!isDestructive("SELECT 'drop table t'") && !isDestructive('SELECT 1 -- DROP TABLE t') && !isDestructive('/* drop table t */ SELECT 1') && !isDestructive('ALTER TABLE t ADD c int') && !isDestructive('SELECT dropped FROM truncated'), 'a quoted DROP, a comment, ALTER ... ADD and similar names are not');
check(splitStatements("INSERT INTO t VALUES ('a;b'); -- x;y\nSELECT 1; /* ; */ SELECT 2").length === 3, 'a ; inside a string or a comment does not end a statement');
check(splitStatements('SELECT $$a;b$$; SELECT 2', 'postgresql').length === 2, 'nor does one inside a PostgreSQL dollar-quoted body');
check(maskSecretsInSql("CREATE USER u IDENTIFIED BY 'hunter22'") === "CREATE USER u IDENTIFIED BY '***'" && maskSecretsInSql("ALTER USER u WITH PASSWORD 'hunter22'") === "ALTER USER u WITH PASSWORD '***'" && maskSecretsInSql("ALTER LOGIN u WITH PASSWORD = 'hunter22'") === "ALTER LOGIN u WITH PASSWORD = '***'" && maskSecretsInSql("SET PASSWORD FOR u = PASSWORD('hunter22')") === "SET PASSWORD FOR u = PASSWORD('***')", 'the literal of a password is replaced by *** in the SQL that sets it');
check(maskSecretsInSql("SELECT 'password' AS x, name FROM users WHERE password_hash IS NULL") === "SELECT 'password' AS x, name FROM users WHERE password_hash IS NULL", 'and ordinary SQL is left as it is');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
skills.seedDefaults(DEFAULT_SKILLS);
const dir = mkdtempSync(join(tmpdir(), 'dbtools-'));
const file = join(dir, 'shop.db');
const seed = new Database(file);
seed.exec(`CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT);
  CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), total REAL);
  CREATE INDEX idx_orders_customer ON orders (customer_id);
  CREATE VIEW big_orders AS SELECT * FROM orders WHERE total > 100;
  INSERT INTO customers (name, email) VALUES ('Ana', 'ana@x.test'), ('Beto', NULL), ('Carla', 'carla@x.test');
  INSERT INTO orders (customer_id, total) VALUES (1, 50), (1, 150), (2, 99.5);`);
seed.close();

// The colonies do not lend their permission or folder: each agent below has its own (a colony that does lend them is tested at the end).
const own = { permission: false, cwd: false };
const colony = colonies.create({ name: 'db-colony', color: '#2f8f5b', cwd: dir, permission: 'acceptEdits', system_prompt: '', skill_ids: [], inherit: own } as any);
const other = colonies.create({ name: 'db-other', color: '#555555', cwd: dir, permission: 'acceptEdits', system_prompt: '', skill_ids: [], inherit: own } as any);
const mk = (name: string, o: Record<string, unknown>) => {
  const home = join(dir, `home-${name}`); mkdirSync(home, { recursive: true });
  return agents.create({ name, role: 'worker', provider: 'claude', model: '', cwd: home, permission: 'acceptEdits', ...o } as any);
};
const editor = mk('editor', { colony_id: colony.id, skill_ids: [DATABASES_SKILL_ID] });                         // acceptEdits
const boss = mk('boss', { colony_id: colony.id, permission: 'bypassPermissions', skill_ids: [DATABASES_SKILL_ID] });
const reader = mk('reader', { colony_id: colony.id, permission: 'plan', skill_ids: [DATABASES_SKILL_ID] });
const plain = mk('plain', { colony_id: colony.id });                                                            // no skill
const stranger = mk('stranger', { colony_id: other.id, skill_ids: [DATABASES_SKILL_ID] });
const loner = mk('loner', { skill_ids: [DATABASES_SKILL_ID] });                                                  // no colony
const objectsOnly = mk('objects-only', { colony_id: colony.id, skill_ids: [OBJECTS_SKILL_ID] });

// readOnly is ON (the default): it is a setting of the person's panel and must not bind an agent.
const shop = createObject({ name: 'shop', kind: 'database', colony_id: colony.id, config: { engine: 'sqlite', file } });
check((shop.config as any).readOnly === true, 'the resource is read-only (the setting of its panel)');

/** One MCP session over stdio, as an agent's CLI would run it. */
function session(agentId: string, caps = 'databases') {
  const child = spawn('node', [join(import.meta.dirname, '..', 'mcp', 'dispatch.mjs')], { env: { ...process.env, HIVE_AGENT_ID: agentId, HIVE_CAPS: caps, HIVE_AM_API: `http://127.0.0.1:${process.env.HIVE_AM_PORT}` }, stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = ''; const waiting = new Map<number, (m: any) => void>(); let n = 0;
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); waiting.get(m.id)?.(m); } catch { /* not json */ } } });
  const rpc = (method: string, params?: unknown) => new Promise<any>((res) => { const id = ++n; waiting.set(id, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  return {
    tools: async () => (await rpc('tools/list')).result.tools.map((t: any) => t.name) as string[],
    call: async (name: string, args: Record<string, unknown> = {}) => { const r = (await rpc('tools/call', { name: `object_db_${name}`, arguments: args })).result; return { err: !!r.isError, text: r.content[0].text as string }; },
    close: () => child.kill(),
  };
}
const logged: string[] = []; const realLog = console.log; console.log = (...a: unknown[]) => { const t = a.map(String).join(' '); if (t.startsWith('[hive-am]')) logged.push(t); realLog(...a); };

// ---- who gets the tools ----
check(mcpCaps(editor).includes('databases') && !mcpCaps(plain).includes('databases') && !mcpCaps(objectsOnly).includes('databases'), 'only agents with the Database management skill get the databases tools');
check(/object_db_query/.test(composeInstructions(editor)) && !/object_db_query/.test(composeInstructions(plain)), 'and are told about them in their instructions');
const ed = session(editor.id);
const names = await ed.tools();
check(names.length === 20 && names.every((x) => x.startsWith('object_db_')) && ['list', 'schema', 'columns', 'describe', 'search', 'ddl', 'sample', 'query', 'exec', 'explain', 'export', 'saved', 'history', 'sessions', 'kill', 'config', 'config_set', 'test', 'create', 'delete'].every((x) => names.includes(`object_db_${x}`)), 'the MCP script offers the twenty object_db tools');
check((await session(plain.id, 'objects').tools()).every((x) => !x.startsWith('object_db_')), 'and none of them without the databases capability');
const pl = session(plain.id); const pr = await pl.call('list');
check(pr.err && /skill/.test(pr.text), 'an agent without the skill is refused even if it reaches the tools');
check(session('no-such-agent').call('list').then((r) => r.err) instanceof Promise && (await session('no-such-agent').call('list')).err, 'and so is an unknown agent');
const oo = session(objectsOnly.id); check((await oo.call('list')).err, 'the Colony resources skill alone does not give access to the database tools');

// ---- scope ----
const l1 = await ed.call('list');
check(!l1.err && l1.text.includes('shop') && /sqlite/.test(l1.text), 'a colony agent sees the databases of its colony');
const st = session(stranger.id); const lo = session(loner.id);
check(!(await st.call('list')).text.includes('shop') && !(await lo.call('list')).text.includes('shop'), 'an agent of another colony, or of none, does not');
const foreign = await st.call('schema', { name: 'shop' });
const ghost = await ed.call('schema', { name: 'no-such-db' });
check(foreign.err && ghost.err && foreign.text.replace('shop', 'X') === ghost.text.replace('no-such-db', 'X'), 'a foreign database looks the same as one that does not exist');

// ---- discovery ----
const sc = await ed.call('schema', { name: 'shop' });
check(!sc.err && /customers \(table/.test(sc.text) && /big_orders \(view/.test(sc.text) && /orders \(table/.test(sc.text), 'schema lists tables and views');
const co = await ed.call('columns', { name: 'shop', schema: 'main', table: 'customers' });
check(/id INTEGER NOT NULL PRI/.test(co.text) && /name TEXT NOT NULL/.test(co.text) && /email TEXT/.test(co.text), 'columns shows types, nullability and the key');
const de = await ed.call('describe', { name: 'shop', schema: 'main', table: 'orders' });
check(/3 rows/.test(de.text) && /idx_orders_customer/.test(de.text) && /\(customer_id\) -> customers \(id\)/.test(de.text) && /Primary key: id/.test(de.text), 'describe shows the row count, the index, the foreign key and the primary key');
const se = await ed.call('search', { name: 'shop', query: 'customer' });
check(/main\.customers \(table\)/.test(se.text) && /main\.orders\.customer_id \(column\)/.test(se.text), 'search finds tables and columns by name');
const dd = await ed.call('ddl', { name: 'shop', schema: 'main', table: 'orders' });
check(/CREATE TABLE orders/.test(dd.text) && /CREATE INDEX idx_orders_customer/.test(dd.text), 'ddl returns the CREATE statement and the index');
const sa = await ed.call('sample', { name: 'shop', schema: 'main', table: 'customers', limit: 2 });
check(/Ana/.test(sa.text) && /Beto/.test(sa.text) && !/Carla/.test(sa.text) && /2 rows/.test(sa.text), 'sample returns the first rows');
const ex = await ed.call('explain', { name: 'shop', sql: 'SELECT * FROM orders WHERE customer_id = 1' });
check(!ex.err && /idx_orders_customer|SEARCH|SCAN/i.test(ex.text), 'explain shows the plan');
const exw = await ed.call('explain', { name: 'shop', sql: 'DELETE FROM orders' });
const still = await ed.call('query', { name: 'shop', sql: 'SELECT COUNT(*) AS n FROM orders' });
check(!exw.err && /3\n/.test(still.text), 'explain of a DELETE does not run it');
check((await ed.call('explain', { name: 'shop', sql: 'SELECT 1; DROP TABLE orders' })).err, 'explain takes one statement');

// ---- queries: reads, writes and DDL, although the resource is read-only ----
const q1 = await ed.call('query', { name: 'shop', sql: 'SELECT name, email FROM customers ORDER BY id' });
check(!q1.err && /Ana\tana@x\.test/.test(q1.text) && /Beto\tNULL/.test(q1.text) && /3 rows/.test(q1.text), 'a read returns the rows (NULL is shown)');
const w1 = await ed.call('query', { name: 'shop', sql: "INSERT INTO customers (name, email) VALUES ('Dani', 'dani@x.test')" });
check(!w1.err && /1 row affected/.test(w1.text), 'an acceptEdits agent can write although the resource is read-only');
const w2 = await ed.call('query', { name: 'shop', sql: "UPDATE customers SET email = 'beto@x.test' WHERE name = 'Beto'" });
const w3 = await ed.call('query', { name: 'shop', sql: 'CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)' });
const w4 = await ed.call('query', { name: 'shop', sql: 'ALTER TABLE notes ADD COLUMN at TEXT' });
const w5 = await ed.call('query', { name: 'shop', sql: "DELETE FROM customers WHERE name = 'Dani'" });
check([w2, w3, w4, w5].every((x) => !x.err), 'and UPDATE, CREATE, ALTER and DELETE too');
const dr = await ed.call('query', { name: 'shop', sql: 'DROP TABLE notes' });
check(dr.err && /DROP and TRUNCATE need Full access/.test(dr.text), 'but DROP is refused');
const tr = await ed.call('query', { name: 'shop', sql: 'TRUNCATE TABLE notes' });
const ad = await ed.call('query', { name: 'shop', sql: 'ALTER TABLE notes DROP COLUMN at' });
check(tr.err && /Full access/.test(tr.text) && ad.err && /Full access/.test(ad.text), 'and so are TRUNCATE and ALTER ... DROP');
check((await ed.call('query', { name: 'shop', sql: 'SELECT name FROM sqlite_master WHERE name = \'notes\'' })).text.includes('notes'), 'and the table is still there');
const bad = await ed.call('query', { name: 'shop', sql: 'SELEC 1' });
check(bad.err, 'a SQL error comes back as an error');

// ---- a script is all or nothing ----
const e1 = await ed.call('exec', { name: 'shop', sql: "INSERT INTO notes (body) VALUES ('one'); INSERT INTO notes (body) VALUES ('two'); UPDATE customers SET name = 'Ana M' WHERE id = 1;" });
check(!e1.err && /3 statements applied in one transaction/.test(e1.text), 'exec runs several statements');
const e2 = await ed.call('exec', { name: 'shop', sql: "INSERT INTO notes (body) VALUES ('three'); INSERT INTO nope (x) VALUES (1);" });
const cnt = await ed.call('query', { name: 'shop', sql: 'SELECT COUNT(*) AS n FROM notes' });
check(e2.err && /Statement 2/.test(e2.text) && /nothing was changed/.test(e2.text) && /\n2\n/.test(cnt.text), 'one failing statement undoes the others and says which it was');
const e3 = await ed.call('exec', { name: 'shop', sql: "INSERT INTO notes (body) VALUES ('four'); DROP TABLE notes;" });
const cnt2 = await ed.call('query', { name: 'shop', sql: 'SELECT COUNT(*) AS n FROM notes' });
check(e3.err && /Full access/.test(e3.text) && /\n2\n/.test(cnt2.text), 'a DROP in a script refuses the whole script before anything runs');

// ---- the permission table ----
const rd = session(reader.id);
check(/Ana/.test((await rd.call('query', { name: 'shop', sql: 'SELECT * FROM customers' })).text), 'plan: reads');
check((await rd.call('schema', { name: 'shop' })).err === false && (await rd.call('describe', { name: 'shop', schema: 'main', table: 'orders' })).err === false, 'plan: discovery');
const rw = await rd.call('query', { name: 'shop', sql: "INSERT INTO customers (name) VALUES ('Nope')" });
check(rw.err && /read-only/.test(rw.text), 'plan: cannot write');
check((await rd.call('exec', { name: 'shop', sql: 'DELETE FROM customers' })).err && (await rd.call('saved', { name: 'shop', op: 'add', query_name: 'x', sql: 'SELECT 1' })).err && (await rd.call('history', { name: 'shop', op: 'clear' })).err && (await rd.call('sessions', { name: 'shop' })).err, 'plan: no scripts, no saving, no clearing, no sessions');
check((await rd.call('export', { name: 'shop', sql: 'SELECT 1', format: 'csv', file: 'x.csv' })).err, 'plan: no export');
check((await rd.call('config_set', { name: 'shop', config: { maxRows: 5 } })).err && (await rd.call('create', { name: 'x', config: { engine: 'sqlite', file } })).err && (await rd.call('delete', { name: 'shop' })).err && (await rd.call('kill', { name: 'shop', id: 1 })).err, 'plan: no admin');
check(/Ana/.test((await rd.call('config', { name: 'shop' })).text) === false && !(await rd.call('config', { name: 'shop' })).err, 'plan: can read the configuration');
check((await ed.call('config_set', { name: 'shop', config: { maxRows: 5 } })).err && /Full access/.test((await ed.call('config_set', { name: 'shop', config: { maxRows: 5 } })).text), 'acceptEdits: config_set needs Full access');
check((await ed.call('create', { name: 'x', config: { engine: 'sqlite', file } })).err && (await ed.call('delete', { name: 'shop' })).err && (await ed.call('kill', { name: 'shop', id: 1 })).err, 'acceptEdits: create, delete and kill need Full access');
const bo = session(boss.id);
check((await bo.call('exec', { name: 'shop', sql: 'DROP TABLE notes' })).err === false, 'Full access: can DROP');
check(!(await bo.call('query', { name: 'shop', sql: 'CREATE TABLE gone (id INTEGER)' })).err && !(await bo.call('query', { name: 'shop', sql: 'TRUNCATE TABLE gone' })).text.startsWith('DROP'), 'Full access: TRUNCATE is not refused by hive-am');
check((await bo.call('sessions', { name: 'shop' })).err && /no sessions/.test((await bo.call('sessions', { name: 'shop' })).text), 'SQLite answers "no sessions", not a crash');
check((await bo.call('kill', { name: 'shop', id: 1 })).err && /no sessions/.test((await bo.call('kill', { name: 'shop', id: 1 })).text), 'and "nothing to cancel" for kill');

// ---- export ----
const x1 = await ed.call('export', { name: 'shop', sql: 'SELECT id, name, email FROM customers ORDER BY id', format: 'csv', file: 'out/customers.csv' });
const csv = existsSync(join(editor.cwd, 'out', 'customers.csv')) ? readFileSync(join(editor.cwd, 'out', 'customers.csv'), 'utf8') : '';
check(!x1.err && /^id,name,email\r\n1,Ana M,ana@x\.test\r\n2,Beto,beto@x\.test\r\n/.test(csv), 'export writes a CSV inside the agent\'s own folder');
const x2 = await ed.call('export', { name: 'shop', sql: 'SELECT id, name FROM customers ORDER BY id', format: 'json', file: 'out/customers.json' });
check(!x2.err && JSON.parse(readFileSync(join(editor.cwd, 'out', 'customers.json'), 'utf8'))[0].name === 'Ana M', 'and a JSON');
check((await ed.call('export', { name: 'shop', sql: 'SELECT 1 AS a', format: 'csv', file: 'out/customers.csv' })).err, 'it never overwrites a file');
check(!(await ed.call('export', { name: 'shop', sql: 'SELECT 1 AS a', format: 'csv', file: 'out/customers.csv', overwrite: true })).err, 'unless overwrite is true');
const out1 = await ed.call('export', { name: 'shop', sql: 'SELECT 1 AS a', format: 'csv', file: '../escape.csv' });
const out2 = await ed.call('export', { name: 'shop', sql: 'SELECT 1 AS a', format: 'csv', file: join(dir, 'abs.csv') });
check(out1.err && out2.err && !existsSync(join(editor.cwd, '..', 'escape.csv')) && !existsSync(join(dir, 'abs.csv')), 'it never writes outside the agent\'s folder, with .. or an absolute path');
symlinkSync(dir, join(editor.cwd, 'link'));
const out3 = await ed.call('export', { name: 'shop', sql: 'SELECT 1 AS a', format: 'csv', file: 'link/viaLink.csv' });
check(out3.err && !existsSync(join(dir, 'viaLink.csv')), 'nor through a symbolic link');
check((await ed.call('export', { name: 'shop', sql: 'DELETE FROM notes', format: 'csv', file: 'out/none.csv' })).err, 'a statement with no rows has nothing to export');

// ---- saved queries and history ----
const s1 = await ed.call('saved', { name: 'shop', op: 'add', query_name: 'big', sql: 'SELECT * FROM big_orders' });
const id1 = /Saved: (\S+)/.exec(s1.text)?.[1] ?? '';
check(!s1.err && id1.length > 5 && /big/.test((await ed.call('saved', { name: 'shop', op: 'list' })).text), 'saved queries can be added and listed');
check(!(await ed.call('saved', { name: 'shop', op: 'update', id: id1, query_name: 'bigger' })).err && /bigger/.test((await ed.call('saved', { name: 'shop', op: 'list' })).text), 'renamed');
check(!(await ed.call('saved', { name: 'shop', op: 'remove', id: id1 })).err && /No saved/.test((await ed.call('saved', { name: 'shop', op: 'list' })).text), 'and removed');
const h = await ed.call('history', { name: 'shop', op: 'list' });
check(/SELECT name, email FROM customers/.test(h.text) && /\(editor\)/.test(h.text) && /FAILED/.test(h.text), 'the history lists the queries with the agent that ran them, and the ones that failed');
check(listQueries(shop.id).some((e) => e.by === 'editor') && logged.some((l) => /\[hive-am\] editor ran SELECT name, email FROM customers/.test(l)), 'a person can audit it: the history of the resource and a line in the server log');
check(!(await ed.call('history', { name: 'shop', op: 'clear' })).err && /No history/.test((await ed.call('history', { name: 'shop', op: 'list' })).text), 'and it can be cleared');

// ---- the resource itself ----
const cf = await ed.call('config', { name: 'shop' });
check(!cf.err && /"engine": "sqlite"/.test(cf.text) && /"passwordSet": false/.test(cf.text), 'config shows the connection and whether a password is set');
const cs = await bo.call('config_set', { name: 'shop', config: { maxRows: 3, timeoutSec: 20 }, new_name: 'shop2' });
check(!cs.err && /shop2/.test(cs.text) && (objectsStore.get(shop.id)!.config as any).maxRows === 3 && objectsStore.get(shop.id)!.name === 'shop2', 'config_set (Full access) changes the limits and renames it');
check(/3 rows[^]*cut at/.test((await bo.call('query', { name: 'shop2', sql: 'SELECT * FROM customers' })).text) || /cut at/.test((await bo.call('query', { name: 'shop2', sql: 'SELECT * FROM orders UNION ALL SELECT * FROM orders' })).text), 'and the new limit applies');
check((await bo.call('config_set', { name: 'shop2', config: { engine: 'mysql' } })).err, 'the engine cannot change');
check((await bo.call('config_set', { name: 'shop2', config: { file: join(dir, 'missing.db') } })).err && (objectsStore.get(shop.id)!.config as any).file === file, 'a connection that does not test is not saved');
check(!(await bo.call('config_set', { name: 'shop2', config: { maxRows: 1000 }, new_name: 'shop' })).err, 'it can be renamed back');
const t1 = await ed.call('test', { name: 'shop' });
check(!t1.err && /Connection works: SQLite/.test(t1.text), 'test works on a saved resource');
check((await ed.call('test', { config: { engine: 'sqlite', file } })).err, 'but a draft configuration needs Full access');
check(!(await bo.call('test', { config: { engine: 'sqlite', file } })).err, 'which Full access has');

const second = join(dir, 'second.db'); new Database(second).close();
const cr = await bo.call('create', { name: 'second', config: { engine: 'sqlite', file: second } });
check(!cr.err && /Created/.test(cr.text) && objectsStore.byName('second') && objectsStore.managers().get(objectsStore.byName('second')!.id) === boss.id, 'create makes the resource and the agent becomes its manager');
check((objectsStore.byName('second')!.colony_id ?? null) === colony.id, 'in the agent\'s colony');
check(!(await ed.call('list')).text.includes('second') && (await bo.call('list')).text.includes('second'), 'and with a manager chosen, only that agent sees it');
check((await bo.call('create', { name: 'bad', config: { engine: 'sqlite', file: join(dir, 'nofile.db') } })).err && !objectsStore.byName('bad'), 'create tests the connection first and creates nothing when it fails');
check((await bo.call('create', { name: 'second', config: { engine: 'sqlite', file: second } })).err, 'a name that is taken is refused');
check((await bo.call('create', { name: 'elsewhere', colony_id: other.id, config: { engine: 'sqlite', file: second } })).err, 'an agent cannot put a resource into another colony');
const dl = await bo.call('delete', { name: 'second' });
check(!dl.err && !objectsStore.byName('second'), 'delete removes it');

// ---- choosing the manager gives the right skill ----
const fresh = mk('fresh', { colony_id: other.id });
const link = setObjectManager(shop.id, fresh.id);
check(link.skillAdded && agents.get(fresh.id)!.skill_ids.includes(DATABASES_SKILL_ID) && !agents.get(fresh.id)!.skill_ids.includes(OBJECTS_SKILL_ID), 'choosing an agent as manager of a database gives it the Database management skill');
const fr = session(fresh.id);
check((await fr.call('list')).text.includes('shop') && !(await ed.call('list')).text.includes('shop'), 'the chosen manager sees it and the colony stops seeing it');
setObjectManager(shop.id, null);

// ---- passwords ----
const pw = 'S3cr3tPass!9';
const remote = createObject({ name: 'remote', kind: 'database', colony_id: colony.id, config: { engine: 'mysql', host: '127.0.0.1', port: 1, user: 'app', password: pw, database: 'x' } });
const rc = await ed.call('config', { name: 'remote' });
check(!rc.err && !rc.text.includes(pw) && /"passwordSet": true/.test(rc.text), 'config never shows a password, only that one is set');
const rt = await ed.call('test', { name: 'remote' });
check(rt.err && !rt.text.includes(pw), 'a failed connection test does not leak it');
check(findSecret(`the password is ${pw}`) !== null, 'a reply that contains it is blocked from going to a chat');
const cu = await bo.call('query', { name: 'shop', sql: `CREATE TABLE IF NOT EXISTS t1 (a int); SELECT 'x' -- CREATE USER u IDENTIFIED BY '${pw}'` });
void cu;
const hist = await bo.call('history', { name: 'shop', op: 'list' });
const logsText = logged.join('\n');
check(!JSON.stringify(listQueries(shop.id)).includes(pw) && !hist.text.includes(pw), 'a password in SQL is masked in the history and in what the history tool answers');
const pq = await bo.call('query', { name: 'shop', sql: `SELECT 1 AS a -- ALTER USER u WITH PASSWORD '${pw}'` });
check(!logged.join('\n').includes(pw) && !(await bo.call('history', { name: 'shop', op: 'list' })).text.includes(pw) && !pq.text.includes(pw), 'nor in the server log line');
void logsText;
const sv = await bo.call('saved', { name: 'shop', op: 'add', query_name: 'pw', sql: `CREATE USER u IDENTIFIED BY '${pw}'` });
check(!sv.err && !(await bo.call('saved', { name: 'shop', op: 'list' })).text.includes(pw), 'nor in a saved query');
// A person typed a password into the panel's console: an agent reading the history must not see it either.
const { recordQuery } = await import('../src/objects/db-history.js');
recordQuery(shop.id, { sql: `CREATE USER p IDENTIFIED BY '${pw}'`, ok: true, ms: 1 });
check(!(await bo.call('history', { name: 'shop', op: 'list' })).text.includes(pw), 'nor a password a person typed in the panel');
await removeObject(remote.id);

// ---- the permission that counts is the effective one: what the colony lends ----
const roColony = colonies.create({ name: 'db-readonly', color: '#996633', cwd: dir, permission: 'plan', system_prompt: '', skill_ids: [] } as any);   // lends its permission (the default)
const follower = mk('follower', { colony_id: roColony.id, permission: 'bypassPermissions', skill_ids: [DATABASES_SKILL_ID] });
const roDb = createObject({ name: 'ro-db', kind: 'database', colony_id: roColony.id, config: { engine: 'sqlite', file } });
const fo = session(follower.id);
check(agents.get(follower.id)!.effective.permission === 'plan', 'an agent that follows its colony has the colony\'s permission, whatever its own says');
const fw = await fo.call('query', { name: 'ro-db', sql: "INSERT INTO customers (name) VALUES ('Nope')" });
check(fw.err && /read-only/.test(fw.text) && !(await fo.call('query', { name: 'ro-db', sql: 'SELECT * FROM customers WHERE name = \'Nope\'' })).text.includes('Nope'), 'so a read-only colony keeps its agent from writing, although the agent\'s own permission is Full access');
check((await fo.call('delete', { name: 'ro-db' })).err && /read-only/.test((await fo.call('delete', { name: 'ro-db' })).text), 'and from deleting');
fo.close(); await removeObject(roDb.id);

console.log = realLog;
for (const c of [ed, st, lo, pl, oo, rd, bo, fr]) c.close();
await removeObject(shop.id);
console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
void sleep; void writeFileSync;
