// Schema versioning: a database written by an older build (tables without the columns added later, rows in them) opens and migrates
// without losing anything, a second open changes nothing, and a fresh database gets the same schema. Usage:
//   HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-migrations.ts
import './_guard.js';
import Database from 'better-sqlite3';
import { join } from 'node:path';

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };

// ---- 1. a database as the first builds left it (no colonies columns, no skill loads, no thread flags, an old wake-ups table) ----
const file = join(process.env.HIVE_AM_HOME!, 'hive-am.db');
const old = new Database(file);
old.pragma('foreign_keys = ON');
old.exec(`
CREATE TABLE skills (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'personal', slug TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE agent_types (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', role TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', system_prompt TEXT NOT NULL DEFAULT '', permission TEXT NOT NULL DEFAULT 'acceptEdits', color TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
CREATE TABLE type_skills (type_id TEXT NOT NULL REFERENCES agent_types(id) ON DELETE CASCADE, skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE, PRIMARY KEY (type_id, skill_id));
CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', role TEXT NOT NULL, type_id TEXT REFERENCES agent_types(id) ON DELETE SET NULL, provider TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', system_prompt TEXT NOT NULL DEFAULT '', permission TEXT NOT NULL DEFAULT 'acceptEdits', cwd TEXT NOT NULL, session_id TEXT, status TEXT NOT NULL DEFAULT 'idle', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE agent_skills (agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE, skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE, PRIMARY KEY (agent_id, skill_id));
CREATE TABLE assignments (orchestrator_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE, worker_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE, PRIMARY KEY (orchestrator_id, worker_id));
CREATE TABLE colonies (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL DEFAULT '', cwd TEXT NOT NULL DEFAULT '', permission TEXT NOT NULL DEFAULT 'acceptEdits', system_prompt TEXT NOT NULL DEFAULT '', inherit TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL);
CREATE TABLE colony_skills (colony_id TEXT NOT NULL REFERENCES colonies(id) ON DELETE CASCADE, skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE, PRIMARY KEY (colony_id, skill_id));
CREATE TABLE agent_sessions (agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE, provider TEXT NOT NULL, session_id TEXT NOT NULL, cwd TEXT NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, PRIMARY KEY (agent_id, session_id));
CREATE TABLE dispatches (id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL, task TEXT NOT NULL, status TEXT NOT NULL, result TEXT, created_at INTEGER NOT NULL, finished_at INTEGER);
CREATE TABLE connections (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL UNIQUE, agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL, config TEXT NOT NULL DEFAULT '{}', allowed TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE TABLE threads (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE, external_key TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', target TEXT NOT NULL, last_user TEXT, created_at INTEGER NOT NULL, last_activity INTEGER NOT NULL, UNIQUE (connection_id, external_key));
CREATE TABLE thread_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, direction TEXT NOT NULL, external_id TEXT NOT NULL, user_id TEXT, user_name TEXT, text TEXT NOT NULL, ts INTEGER NOT NULL, UNIQUE (thread_id, direction, external_id));
CREATE TABLE agent_wakeups (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE, connection_id TEXT, thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE, due_at INTEGER NOT NULL, note TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE agent_schedules (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE, connection_id TEXT, thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE, kind TEXT NOT NULL, expr TEXT NOT NULL, tz TEXT NOT NULL, note TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, next_due INTEGER, created_at INTEGER NOT NULL, last_fired_at INTEGER, fire_count INTEGER NOT NULL DEFAULT 0, last_status TEXT, last_detail TEXT);
CREATE TABLE wakeups (id TEXT PRIMARY KEY);
CREATE TABLE agent_notebooks (agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE, content TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0, seen INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0, updated_by TEXT NOT NULL DEFAULT '');
CREATE TABLE colony_objects (id TEXT PRIMARY KEY, colony_id TEXT REFERENCES colonies(id) ON DELETE SET NULL, kind TEXT NOT NULL, name TEXT NOT NULL UNIQUE COLLATE NOCASE, config TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
`);
old.exec(`
INSERT INTO skills (id,name,description,content,kind,slug,created_at,updated_at) VALUES ('s1','Mine','d','text','personal',NULL,1,1), ('default-objects','Colony objects','d','x','default','objects',1,1), ('default-notebook','Notebook','d','n','default','notebook',1,1);
INSERT INTO agent_types (id,name,role,provider,created_at) VALUES ('t1','Coder','worker','claude',1);
INSERT INTO type_skills VALUES ('t1','s1');
INSERT INTO colonies (id,name,created_at) VALUES ('c1','Hive',1);
INSERT INTO agents (id,name,role,provider,cwd,created_at,updated_at,status) VALUES ('a1','alpha','orchestrator','claude','/tmp/a',1,1,'running'), ('a2','beta','worker','opencode','/tmp/b',1,1,'idle');
INSERT INTO agent_skills VALUES ('a1','s1'), ('a1','default-objects');
INSERT INTO assignments VALUES ('a1','a2');
INSERT INTO agent_sessions VALUES ('a1','claude','sess-1','/tmp/a',1,2);
INSERT INTO dispatches VALUES ('d1','a1','a2','do it','running',NULL,1,NULL);
INSERT INTO connections (id,kind,name,agent_id,created_at) VALUES ('k1','telegram','bot','a1',1);
INSERT INTO threads (id,connection_id,external_key,target,created_at,last_activity) VALUES ('th1','k1','42','{"chat":"42"}',1,1);
INSERT INTO thread_messages (thread_id,direction,external_id,text,ts) VALUES ('th1','in','m1','hello',1);
INSERT INTO agent_wakeups VALUES ('w1','a1',NULL,NULL,9999999999999,'check',1);
INSERT INTO agent_schedules (id,agent_id,kind,expr,tz,note,created_at) VALUES ('sc1','a1','every','60','UTC','ping',1);
INSERT INTO colony_objects VALUES ('o1',NULL,'boss','Old cluster','{"members":[]}',1,1);
INSERT INTO agent_notebooks VALUES ('a1','## Team\n- Valeria is on call',3,2,555,'agent'), ('a2','',0,0,0,'');
`);
check(old.pragma('user_version', { simple: true }) === 0, 'the old database has no version');
old.close();

// ---- 2. opening it with the current build ----
const { db, agents, skills, types, colonies, dispatches } = await import('../src/db.js');
const { SCHEMA_VERSION, migrate } = await import('../src/db/migrations.js');
const { connections, threads, threadMessages } = await import('../src/connections/store.js');
const { objectsStore } = await import('../src/objects/store.js');
check(db.pragma('user_version', { simple: true }) === SCHEMA_VERSION, `it is now at version ${SCHEMA_VERSION}`);
const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
check(['colony_id', 'overrides', 'session_cwd', 'instr_hash', 'browser', 'cloned_from', 'effort'].every((c) => cols('agents').includes(c)) && cols('agent_types').includes('effort'), 'agents gained its later columns');
check(['kind', 'from_id', 'task'].every((c) => cols('agent_sessions').includes(c)) && cols('dispatches').includes('session_id'), 'sessions and dispatches gained theirs');
check(['muted', 'seen_id'].every((c) => cols('threads').includes(c)) && cols('thread_messages').includes('files'), 'threads gained theirs');
check(cols('agent_wakeups').includes('req_id') && cols('agent_schedules').includes('req_name'), 'wake-ups and schedules gained theirs');
check(!cols('skills').includes('kind') && !cols('skills').includes('slug') && cols('skills').includes('load'), 'skills lost kind/slug and gained load');
check(['type_skills', 'colony_skills', 'agent_skills'].every((t) => cols(t).includes('load')), 'every skill assignment gained load');
check((db.prepare("SELECT name FROM sqlite_master WHERE name IN ('wakeups','agent_watches','agent_notebooks','object_agents','seeded_skills')").all() as unknown[]).length === 3, 'the legacy wakeups table is gone and the newer tables exist');

// ---- 3. nothing was lost ----
const nbOf = (agentId: string) => db.prepare('SELECT n.id, n.content, n.version, n.updated_by, r.seen FROM notebook_readers r JOIN notebooks n ON n.id = r.notebook_id WHERE r.agent_id = ?').get(agentId) as { id: string; content: string; version: number; updated_by: string; seen: number } | undefined;
const nb1 = nbOf('a1'), nb2 = nbOf('a2');
check(!!nb1 && nb1.content === '## Team\n- Valeria is on call' && nb1.version === 3 && nb1.updated_by === 'agent' && nb1.seen === 2, 'a notebook is its own object after the move, with its text, its version, who wrote it and what its reader had seen');
check(!!nb2 && !!nb1 && nb2.id !== nb1.id, 'and each agent that had a notebook has a notebook of its own');
check(!(db.prepare("SELECT name FROM sqlite_master WHERE name = 'agent_notebooks'").get()), 'the old table is gone');
check(skills.list().length === 3 && skills.get('s1')?.content === 'text', 'skills and their text are intact');
check(skills.get('s1')?.load === 'always' && skills.get('default-objects')?.load === 'on_demand' && skills.get('default-notebook')?.load === 'always', 'skill loads: the bundled long guides are on demand, the notebook always');
check(skills.get('default-objects')?.name === 'Colony resources', 'the bundled skill that was renamed follows');
check(types.get('t1')?.skill_ids.join() === 's1', 'a type keeps its skills');
const a1 = agents.get('a1')!;
check(a1.name === 'alpha' && a1.cwd === '/tmp/a' && a1.skill_ids.length === 2 && a1.worker_ids.join() === 'a2' && a1.overrides.length === 0, 'an agent keeps its fields, skills and workers');
check(a1.status === 'idle', 'an agent left running by the old process is idle again');
check(agents.sessions('a1')[0]?.session_id === 'sess-1' && agents.sessions('a1')[0]?.kind === 'direct', 'its session pointer survives with the default kind');
check(dispatches.recent()[0]?.status === 'interrupted', 'a dispatch left running is marked interrupted');
check(colonies.get('c1')?.name === 'Hive' && colonies.get('c1')?.inherit.cwd === true, 'a colony keeps its data and gets default inheritance');
check(connections.get('k1')?.name === 'bot' && threads.get('th1')?.muted === false && threadMessages.recent('th1')[0]?.text === 'hello', 'connections, threads and messages survive');
check((db.prepare("SELECT note FROM agent_wakeups WHERE id='w1'").get() as { note: string }).note === 'check', 'a pending wake-up survives');
check((db.prepare("SELECT note FROM agent_schedules WHERE id='sc1'").get() as { note: string }).note === 'ping', 'a schedule survives');
check(objectsStore.get('o1')?.kind === 'cluster', 'the first name of a cluster (boss) is migrated');

// ---- 4. idempotence, and a fresh database ----
check((db.prepare("SELECT permission FROM agent_sessions WHERE session_id='sess-1'").get() as { permission: string | null }).permission === null, 'a session from before the permission column has it unknown (NULL)');
check(migrate(db).length === 0 && nbOf('a1')?.content === '## Team\n- Valeria is on call', 'opening it again applies nothing');
const rowsBefore = JSON.stringify(db.prepare('SELECT * FROM agents').all());
db.pragma('user_version = 0'); migrate(db);   // as if the version mark were lost: every migration must be a harmless no-op
check(JSON.stringify(db.prepare('SELECT * FROM agents').all()) === rowsBefore && skills.list().length === 3, 're-running every migration over live data changes nothing');
const mem = new Database(':memory:');
check(migrate(mem).join() === '1,2,3,4,5,6,7,8' && mem.pragma('user_version', { simple: true }) === SCHEMA_VERSION, 'a fresh database is built by the same migrations');
check(mem.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_dispatches_created'").get() !== undefined && !!db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_dispatches_created'").get(), 'the dispatch index exists in a fresh and in an upgraded database');
const tablesOf = (d: Database.Database) => (d.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map((r) => r.name).filter((n) => n !== 'sqlite_sequence').join();
check(tablesOf(mem) === tablesOf(db), 'fresh and migrated databases have the same tables');
// a failing migration leaves no half-applied schema and no new version
const boom = new Database(':memory:');
let threw = false;
try { migrate(boom, [{ version: 1, name: 'bad', up: (d) => { d.exec('CREATE TABLE a (x)'); throw new Error('boom'); } }]); } catch { threw = true; }
check(threw && boom.pragma('user_version', { simple: true }) === 0 && !(boom.prepare("SELECT 1 FROM sqlite_master WHERE name='a'").get()), 'a failing migration rolls back completely');

// ---- 5. transactions: a half-failed create leaves nothing behind ----
let failed = false;
try { agents.create({ name: 'gamma', role: 'worker', provider: 'claude', cwd: '/tmp/g', skill_ids: ['no-such-skill'] }); } catch { failed = true; }
check(failed && !agents.byName('gamma'), 'creating an agent with an unknown skill fails as a whole');

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
