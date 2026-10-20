import type Database from 'better-sqlite3';

/**
 * The schema lives here and nowhere else. `PRAGMA user_version` records how many migrations a database has gone through; opening it
 * runs the missing ones, each in its own transaction. Rules: migrations are only ever appended, never edited once released, and are
 * additive and idempotent (CREATE IF NOT EXISTS, columns added only when absent), so a database from any earlier build opens
 * without losing a row: the first migration is the whole schema as it stood before versioning, written to be a no-op where it
 * already exists.
 */
type Db = Database.Database;
export interface Migration { version: number; name: string; up: (db: Db) => void }

const columns = (db: Db, table: string): string[] => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
/** ALTER TABLE ... ADD COLUMN, skipped when the column is already there (`def` is the column name followed by its type). */
export function addColumn(db: Db, table: string, def: string): boolean {
  const name = def.split(/\s+/)[0];
  if (columns(db, table).includes(name)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${def}`);
  return true;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1, name: 'baseline',
    up(db) {
      db.exec(`
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_types (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '', permission TEXT NOT NULL DEFAULT 'acceptEdits',
  color TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS type_skills (
  type_id TEXT NOT NULL REFERENCES agent_types(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (type_id, skill_id)
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL, type_id TEXT REFERENCES agent_types(id) ON DELETE SET NULL,
  provider TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', system_prompt TEXT NOT NULL DEFAULT '',
  permission TEXT NOT NULL DEFAULT 'acceptEdits', cwd TEXT NOT NULL,
  session_id TEXT, status TEXT NOT NULL DEFAULT 'idle',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_skills (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (agent_id, skill_id)
);
CREATE TABLE IF NOT EXISTS assignments (
  orchestrator_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  worker_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  PRIMARY KEY (orchestrator_id, worker_id)
);
CREATE TABLE IF NOT EXISTS colonies (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL DEFAULT '', cwd TEXT NOT NULL DEFAULT '',
  permission TEXT NOT NULL DEFAULT 'acceptEdits', system_prompt TEXT NOT NULL DEFAULT '',
  inherit TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS colony_skills (
  colony_id TEXT NOT NULL REFERENCES colonies(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (colony_id, skill_id)
);
-- Pointer log of every native session an agent has ever used (for the Sessions view).
CREATE TABLE IF NOT EXISTS agent_sessions (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, session_id TEXT NOT NULL, cwd TEXT NOT NULL,
  first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  PRIMARY KEY (agent_id, session_id)
);
-- Dispatch log: who asked whom to do what. Results live in the worker's own session.
CREATE TABLE IF NOT EXISTS dispatches (
  id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL, task TEXT NOT NULL,
  status TEXT NOT NULL, result TEXT, created_at INTEGER NOT NULL, finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS seeded_skills (slug TEXT PRIMARY KEY);

-- Channels (Telegram...). Known threads: where to send a reply and when it was last active.
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL UNIQUE,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  config TEXT NOT NULL DEFAULT '{}', allowed TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  external_key TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', target TEXT NOT NULL, last_user TEXT,
  created_at INTEGER NOT NULL, last_activity INTEGER NOT NULL,
  UNIQUE (connection_id, external_key)
);
CREATE TABLE IF NOT EXISTS thread_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  direction TEXT NOT NULL, external_id TEXT NOT NULL, user_id TEXT, user_name TEXT,
  text TEXT NOT NULL, ts INTEGER NOT NULL,
  UNIQUE (thread_id, direction, external_id)
);
CREATE TABLE IF NOT EXISTS connection_cursor (
  connection_id TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE, value TEXT NOT NULL
);

-- Wake-ups, schedules and process watches (what an agent asks hive-am to do later).
DROP TABLE IF EXISTS wakeups;
CREATE TABLE IF NOT EXISTS agent_wakeups (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  connection_id TEXT, thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,
  due_at INTEGER NOT NULL, note TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_schedules (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  connection_id TEXT, thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, expr TEXT NOT NULL, tz TEXT NOT NULL, note TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1, next_due INTEGER, created_at INTEGER NOT NULL,
  last_fired_at INTEGER, fire_count INTEGER NOT NULL DEFAULT 0, last_status TEXT, last_detail TEXT
);
CREATE TABLE IF NOT EXISTS schedule_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, schedule_id TEXT NOT NULL REFERENCES agent_schedules(id) ON DELETE CASCADE,
  fired_at INTEGER NOT NULL, status TEXT NOT NULL, detail TEXT, duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_schedule_runs ON schedule_runs (schedule_id, id);
CREATE TABLE IF NOT EXISTS agent_watches (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  connection_id TEXT, thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,
  pid INTEGER NOT NULL, pid_stamp TEXT, file TEXT, log TEXT, note TEXT NOT NULL,
  started_at INTEGER NOT NULL, deadline INTEGER NOT NULL, req_id TEXT, req_name TEXT
);

-- The agent's own notebook, and the resources of a colony.
CREATE TABLE IF NOT EXISTS agent_notebooks (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0, seen INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0, updated_by TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS colony_objects (
  id TEXT PRIMARY KEY, colony_id TEXT REFERENCES colonies(id) ON DELETE SET NULL,
  kind TEXT NOT NULL, name TEXT NOT NULL UNIQUE COLLATE NOCASE, config TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
-- The agent chosen to look after a resource (one per resource; the table keeps its first version's shape).
CREATE TABLE IF NOT EXISTS object_agents (
  object_id TEXT NOT NULL REFERENCES colony_objects(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  PRIMARY KEY (object_id, agent_id)
);`);

      // Columns added by later builds: databases created before them get them here.
      addColumn(db, 'agents', 'colony_id TEXT REFERENCES colonies(id) ON DELETE SET NULL');
      addColumn(db, 'agents', "overrides TEXT NOT NULL DEFAULT '[]'");
      addColumn(db, 'agents', 'session_cwd TEXT');
      addColumn(db, 'agents', 'instr_hash TEXT');
      addColumn(db, 'agent_sessions', "kind TEXT NOT NULL DEFAULT 'direct'");
      addColumn(db, 'agent_sessions', 'from_id TEXT');
      addColumn(db, 'agent_sessions', 'task TEXT');
      addColumn(db, 'dispatches', 'session_id TEXT');
      addColumn(db, 'agent_wakeups', 'req_id TEXT'); addColumn(db, 'agent_wakeups', 'req_name TEXT');
      addColumn(db, 'agent_schedules', 'req_id TEXT'); addColumn(db, 'agent_schedules', 'req_name TEXT');
      addColumn(db, 'threads', 'muted INTEGER NOT NULL DEFAULT 0'); addColumn(db, 'threads', 'seen_id INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'thread_messages', 'files TEXT');

      // Skills briefly had a "default/personal" split; all skills are equal now.
      for (const col of ['kind', 'slug']) { if (columns(db, 'skills').includes(col)) { try { db.exec(`ALTER TABLE skills DROP COLUMN ${col}`); } catch { /* an old SQLite that cannot drop it: the column is harmless */ } } }
      // How a skill reaches the agent: `always` puts all its text in the instructions; `on_demand` lists name + description and the agent reads the text with `skill_read`.
      if (addColumn(db, 'skills', "load TEXT NOT NULL DEFAULT 'always'")) {
        // The skills that came with hive-am are long, situational guides (the notebook one must always be in view).
        db.exec("UPDATE skills SET load='on_demand' WHERE id LIKE 'default-%' AND id<>'default-notebook'");
      }
      // How each assignment loads the skill (Skill.load is only the suggestion offered when assigning).
      for (const table of ['type_skills', 'colony_skills', 'agent_skills']) {
        if (!addColumn(db, table, "load TEXT NOT NULL DEFAULT 'always'")) continue;
        db.exec(`UPDATE ${table} SET load=COALESCE((SELECT load FROM skills WHERE skills.id=${table}.skill_id), 'always')`);
      }
    },
  },
  {
    version: 2, name: 'renames',
    up(db) {
      // The first name of a cluster was `boss`.
      db.exec("UPDATE colony_objects SET kind='cluster' WHERE kind='boss'");
      // The section "Objects" became "Resources": the skill that came with hive-am follows, unless the person already renamed it.
      db.exec("UPDATE skills SET name='Colony resources' WHERE id='default-objects' AND name='Colony objects' AND NOT EXISTS (SELECT 1 FROM skills WHERE lower(name)='colony resources')");
    },
  },
  {
    version: 3, name: 'agent-browser',
    up(db) {
      // Whether a Claude agent may drive the person's Chrome (`--chrome`). Off for every agent that already exists.
      addColumn(db, 'agents', 'browser INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    version: 4, name: 'session-permission',
    up(db) {
      // The effective permission an OpenCode session started with. NULL for sessions recorded before this column existed (unknown).
      addColumn(db, 'agent_sessions', 'permission TEXT');
    },
  },
  {
    version: 5, name: 'dispatch-created-index',
    up(db) {
      // The retention pass orders the delegation log by this when it keeps the newest ones.
      db.exec('CREATE INDEX IF NOT EXISTS idx_dispatches_created ON dispatches (created_at, id)');
    },
  },
  {
    version: 6, name: 'shared-notebook',
    up(db) {
      // A notebook stops belonging to one agent: it is its own row, with readers (an agent and its clones read and write the same one).
      // `seen` moves to the reader, because each agent has its own live conversation and must be sent the text again on its own.
      db.exec(`
        CREATE TABLE IF NOT EXISTS notebooks (
          id TEXT PRIMARY KEY, content TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL DEFAULT 0, updated_by TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS notebook_readers (
          agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
          notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
          seen INTEGER NOT NULL DEFAULT 0
        );
        -- A notebook with no reader left goes with its last reader, however that reader goes (deleting the agent, or moving to another notebook).
        CREATE TRIGGER IF NOT EXISTS notebook_orphan AFTER DELETE ON notebook_readers
        BEGIN
          DELETE FROM notebooks WHERE id = OLD.notebook_id AND NOT EXISTS (SELECT 1 FROM notebook_readers WHERE notebook_id = OLD.notebook_id);
        END;
      `);
      // Every notebook of the old table becomes its own notebook with its agent as the only reader, keeping text, version, who wrote last and `seen`.
      const old = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_notebooks'").get();
      if (old) {
        const rows = db.prepare('SELECT agent_id, content, version, seen, updated_at, updated_by FROM agent_notebooks').all() as { agent_id: string; content: string; version: number; seen: number; updated_at: number; updated_by: string }[];
        const has = db.prepare('SELECT 1 FROM notebook_readers WHERE agent_id=?');
        const insNb = db.prepare('INSERT INTO notebooks (id, content, version, updated_at, updated_by) VALUES (?,?,?,?,?)');
        const insReader = db.prepare('INSERT INTO notebook_readers (agent_id, notebook_id, seen) VALUES (?,?,?)');
        for (const r of rows) {
          if (has.get(r.agent_id)) continue;                    // already moved (the migration ran before)
          const id = `nb-${r.agent_id}`;
          insNb.run(id, r.content, r.version, r.updated_at, r.updated_by);
          insReader.run(r.agent_id, id, r.seen);
        }
        db.exec('DROP TABLE agent_notebooks');
      }
    },
  },
  {
    version: 7, name: 'agent-cloned-from',
    up(db) {
      // The agent a clone was made from, so the interface can say it (the shared notebook says it only until the clone separates). NULL for any other agent, and when the source is deleted.
      addColumn(db, 'agents', 'cloned_from TEXT REFERENCES agents(id) ON DELETE SET NULL');
    },
  },
  {
    version: 8, name: 'reasoning-effort',
    up(db) {
      // The reasoning effort of an agent (and of the type it is made from): '' is the CLI's own default, which is what every existing agent keeps.
      addColumn(db, 'agents', "effort TEXT NOT NULL DEFAULT ''");
      addColumn(db, 'agent_types', "effort TEXT NOT NULL DEFAULT ''");
    },
  },
  {
    version: 9, name: 'dispatch-background',
    up(db) {
      // A delegation can run in the background: the orchestrator is told the result where it asked (`origin`, JSON of the chat thread, NULL for
      // the web conversation) and `notified_at` records that the message was handed over, `read_at` that it read the result itself.
      // Every existing row was a synchronous one, whose answer went back on the request: none of them is ever announced.
      addColumn(db, 'dispatches', "mode TEXT NOT NULL DEFAULT 'sync'");
      addColumn(db, 'dispatches', 'origin TEXT');
      addColumn(db, 'dispatches', 'notified_at INTEGER');
      addColumn(db, 'dispatches', 'read_at INTEGER');
    },
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** Brings a database up to the current schema. Returns the versions it applied (empty when it was already current). */
export function migrate(db: Db, migrations: Migration[] = MIGRATIONS): number[] {
  const applied: number[] = [];
  let current = db.pragma('user_version', { simple: true }) as number;
  for (const m of migrations) {
    if (m.version <= current) continue;
    db.transaction(() => { m.up(db); db.pragma(`user_version = ${m.version}`); })();
    current = m.version; applied.push(m.version);
  }
  return applied;
}
