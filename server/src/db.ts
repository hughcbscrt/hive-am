import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Agent, AgentType, Colony, InheritField, InheritFlags, Skill, SkillLoad, Provider, Role, Permission } from './types.js';

export const DATA_DIR = process.env.HIVE_AM_HOME ?? join(homedir(), '.hive-am');
mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(join(DATA_DIR, 'hive-am.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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
`);

// Lightweight migrations for databases created before colonies existed.
const agentCols = (db.prepare('PRAGMA table_info(agents)').all() as any[]).map((c) => c.name);
if (!agentCols.includes('colony_id')) db.exec('ALTER TABLE agents ADD COLUMN colony_id TEXT REFERENCES colonies(id) ON DELETE SET NULL');
if (!agentCols.includes('overrides')) db.exec("ALTER TABLE agents ADD COLUMN overrides TEXT NOT NULL DEFAULT '[]'");
if (!agentCols.includes('session_cwd')) db.exec('ALTER TABLE agents ADD COLUMN session_cwd TEXT');
if (!agentCols.includes('instr_hash')) db.exec('ALTER TABLE agents ADD COLUMN instr_hash TEXT');

// Skills briefly had a "default/personal" split; all skills are equal now.
for (const col of ['kind', 'slug']) { try { db.exec(`ALTER TABLE skills DROP COLUMN ${col}`); } catch { /* already gone */ } }
db.exec('CREATE TABLE IF NOT EXISTS seeded_skills (slug TEXT PRIMARY KEY)');
// How a skill reaches the agent: `always` puts all its text in the instructions; `on_demand` lists name + description and the agent reads the text with `skill_read` when a task needs it.
if (!(db.prepare('PRAGMA table_info(skills)').all() as any[]).some((c) => c.name === 'load')) {
  db.exec("ALTER TABLE skills ADD COLUMN load TEXT NOT NULL DEFAULT 'always'");
  // The skills that came with hive-am are long, situational guides (the notebook one must always be in view).
  db.exec("UPDATE skills SET load='on_demand' WHERE id LIKE 'default-%' AND id<>'default-notebook'");
}

// How each assignment loads the skill (see Skill.load, which is only the suggestion offered when assigning).
for (const [table] of [['type_skills'], ['colony_skills'], ['agent_skills']]) {
  if ((db.prepare(`PRAGMA table_info(${table})`).all() as any[]).some((c) => c.name === 'load')) continue;
  db.exec(`ALTER TABLE ${table} ADD COLUMN load TEXT NOT NULL DEFAULT 'always'`);
  db.exec(`UPDATE ${table} SET load=COALESCE((SELECT load FROM skills WHERE skills.id=${table}.skill_id), 'always')`);
}

const sessCols = (db.prepare('PRAGMA table_info(agent_sessions)').all() as any[]).map((c) => c.name);
if (!sessCols.includes('kind')) db.exec("ALTER TABLE agent_sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'direct'");
if (!sessCols.includes('from_id')) db.exec('ALTER TABLE agent_sessions ADD COLUMN from_id TEXT');
if (!sessCols.includes('task')) db.exec('ALTER TABLE agent_sessions ADD COLUMN task TEXT');
const dispCols = (db.prepare('PRAGMA table_info(dispatches)').all() as any[]).map((c) => c.name);
if (!dispCols.includes('session_id')) db.exec('ALTER TABLE dispatches ADD COLUMN session_id TEXT');

const now = () => Date.now();
const uid = () => randomUUID();

// ---- skills ----
export const skills = {
  list: () => db.prepare('SELECT * FROM skills ORDER BY name').all() as Skill[],
  get: (id: string) => db.prepare('SELECT * FROM skills WHERE id=?').get(id) as Skill | undefined,
  create(p: Pick<Skill, 'name' | 'description' | 'content'> & { load?: SkillLoad }): Skill {
    const id = uid(), t = now();
    db.prepare('INSERT INTO skills (id,name,description,content,created_at,updated_at,load) VALUES (?,?,?,?,?,?,?)').run(id, p.name, p.description ?? '', p.content ?? '', t, t, p.load ?? ((p.content ?? '').length > 2000 ? 'on_demand' : 'always'));
    return skills.get(id)!;
  },
  update(id: string, p: Partial<Pick<Skill, 'name' | 'description' | 'content' | 'load'>>): Skill | undefined {
    const cur = skills.get(id); if (!cur) return;
    const n = { ...cur, ...p };
    db.prepare('UPDATE skills SET name=?, description=?, content=?, load=?, updated_at=? WHERE id=?').run(n.name, n.description, n.content, n.load, now(), id);
    return skills.get(id);
  },
  remove: (id: string) => db.prepare('DELETE FROM skills WHERE id=?').run(id).changes > 0,
  /**
   * Adds the skills that come with hive-am, once each: they are ordinary skills afterwards (edit them, delete them). A
   * skill that was seeded before is never added back, and one the user already has under that name is left alone.
   */
  seedDefaults(defs: { slug: string; name: string; description: string; content: string; load?: SkillLoad }[]) {
    const t = now();
    for (const d of defs) {
      const id = `default-${d.slug}`;
      if (db.prepare('SELECT 1 FROM seeded_skills WHERE slug=?').get(d.slug)) continue;
      db.prepare('INSERT OR IGNORE INTO seeded_skills (slug) VALUES (?)').run(d.slug);
      if (db.prepare('SELECT 1 FROM skills WHERE id=?').get(id)) continue; // from an earlier build: keep it as it is
      const taken = !!db.prepare('SELECT 1 FROM skills WHERE lower(name)=lower(?)').get(d.name);
      db.prepare('INSERT INTO skills (id,name,description,content,created_at,updated_at,load) VALUES (?,?,?,?,?,?,?)').run(id, taken ? `${d.name} (hive-am)` : d.name, d.description, d.content, t, t, d.load ?? 'always');
    }
  },
  /** Agents/types using each skill, for the library view. */
  usage(): Record<string, { agents: number; types: number }> {
    const out: Record<string, { agents: number; types: number }> = {};
    for (const s of skills.list()) out[s.id] = { agents: 0, types: 0 };
    for (const r of db.prepare('SELECT skill_id, COUNT(*) c FROM agent_skills GROUP BY skill_id').all() as any[]) if (out[r.skill_id]) out[r.skill_id].agents = r.c;
    for (const r of db.prepare('SELECT skill_id, COUNT(*) c FROM type_skills GROUP BY skill_id').all() as any[]) if (out[r.skill_id]) out[r.skill_id].types = r.c;
    return out;
  },
};

// ---- skill assignments ----
const JOINS = {
  type: { table: 'type_skills', owner: 'type_id' },
  colony: { table: 'colony_skills', owner: 'colony_id' },
  agent: { table: 'agent_skills', owner: 'agent_id' },
} as const;
type JoinKind = keyof typeof JOINS;
/** How each skill assigned to this type/colony/agent is loaded. */
function loadsOf(kind: JoinKind, id: string): Record<string, SkillLoad> {
  const j = JOINS[kind], out: Record<string, SkillLoad> = {};
  for (const r of db.prepare(`SELECT skill_id, load FROM ${j.table} WHERE ${j.owner}=?`).all(id) as any[]) out[r.skill_id] = r.load === 'on_demand' ? 'on_demand' : 'always';
  return out;
}
/**
 * Replaces the skills of a type/colony/agent. A skill keeps the way it was loaded before; a new one takes what the caller
 * says, or else the skill's own suggestion.
 */
function assignSkills(kind: JoinKind, id: string, ids: string[], loads?: Record<string, SkillLoad>) {
  const j = JOINS[kind], prev = loadsOf(kind, id);
  db.transaction(() => {
    db.prepare(`DELETE FROM ${j.table} WHERE ${j.owner}=?`).run(id);
    for (const s of ids) {
      const load = loads?.[s] ?? prev[s] ?? skills.get(s)?.load ?? 'always';
      db.prepare(`INSERT OR IGNORE INTO ${j.table} (${j.owner}, skill_id, load) VALUES (?,?,?)`).run(id, s, load === 'on_demand' ? 'on_demand' : 'always');
    }
  })();
}

// ---- agent types ----
function typeRow(r: any): AgentType {
  const skill_ids = (db.prepare('SELECT skill_id FROM type_skills WHERE type_id=?').all(r.id) as any[]).map((x) => x.skill_id);
  return { ...r, skill_ids, skill_loads: loadsOf('type', r.id) };
}
export const types = {
  list: () => (db.prepare('SELECT * FROM agent_types ORDER BY role DESC, name').all() as any[]).map(typeRow),
  get(id: string) { const r = db.prepare('SELECT * FROM agent_types WHERE id=?').get(id); return r ? typeRow(r) : undefined; },
  create(p: Partial<AgentType> & { name: string; role: Role; provider: Provider }): AgentType {
    const id = uid();
    db.prepare('INSERT INTO agent_types VALUES (?,?,?,?,?,?,?,?,?,?)').run(
      id, p.name, p.description ?? '', p.role, p.provider, p.model ?? '', p.system_prompt ?? '',
      (p.permission ?? 'acceptEdits') as Permission, p.color ?? '', now());
    types.setSkills(id, p.skill_ids ?? [], p.skill_loads);
    return types.get(id)!;
  },
  update(id: string, p: Partial<AgentType>): AgentType | undefined {
    const cur = types.get(id); if (!cur) return;
    const n = { ...cur, ...p };
    db.prepare(`UPDATE agent_types SET name=?, description=?, role=?, provider=?, model=?, system_prompt=?, permission=?, color=? WHERE id=?`)
      .run(n.name, n.description, n.role, n.provider, n.model, n.system_prompt, n.permission, n.color, id);
    if (p.skill_ids || p.skill_loads) types.setSkills(id, p.skill_ids ?? cur.skill_ids, p.skill_loads);
    return types.get(id);
  },
  setSkills: (id: string, ids: string[], loads?: Record<string, SkillLoad>) => assignSkills('type', id, ids, loads),
  remove: (id: string) => db.prepare('DELETE FROM agent_types WHERE id=?').run(id).changes > 0,
};

// ---- colonies ----
const DEFAULT_INHERIT: InheritFlags = { cwd: true, permission: true, skills: true, prompt: true };
function colonyRow(r: any): Colony {
  const skill_ids = (db.prepare('SELECT skill_id FROM colony_skills WHERE colony_id=?').all(r.id) as any[]).map((x) => x.skill_id);
  const agent_ids = (db.prepare('SELECT id FROM agents WHERE colony_id=? ORDER BY name').all(r.id) as any[]).map((x) => x.id);
  let inherit = DEFAULT_INHERIT;
  try { inherit = { ...DEFAULT_INHERIT, ...JSON.parse(r.inherit) }; } catch { /* keep defaults */ }
  return { ...r, inherit, skill_ids, skill_loads: loadsOf('colony', r.id), agent_ids };
}
export const colonies = {
  list: () => (db.prepare('SELECT * FROM colonies ORDER BY name').all() as any[]).map(colonyRow),
  get(id: string) { const r = db.prepare('SELECT * FROM colonies WHERE id=?').get(id); return r ? colonyRow(r) : undefined; },
  create(p: Partial<Colony> & { name: string }): Colony {
    const id = uid();
    db.prepare('INSERT INTO colonies VALUES (?,?,?,?,?,?,?,?)').run(
      id, p.name, p.color ?? '', p.cwd ?? '', (p.permission ?? 'acceptEdits') as Permission, p.system_prompt ?? '',
      JSON.stringify({ ...DEFAULT_INHERIT, ...(p.inherit ?? {}) }), now());
    colonies.setSkills(id, p.skill_ids ?? [], p.skill_loads);
    if (p.agent_ids) colonies.setMembers(id, p.agent_ids);
    return colonies.get(id)!;
  },
  update(id: string, p: Partial<Colony>): Colony | undefined {
    const cur = colonies.get(id); if (!cur) return;
    const n = { ...cur, ...p, inherit: { ...cur.inherit, ...(p.inherit ?? {}) } };
    db.prepare('UPDATE colonies SET name=?, color=?, cwd=?, permission=?, system_prompt=?, inherit=? WHERE id=?')
      .run(n.name, n.color, n.cwd, n.permission, n.system_prompt, JSON.stringify(n.inherit), id);
    if (p.skill_ids || p.skill_loads) colonies.setSkills(id, p.skill_ids ?? cur.skill_ids, p.skill_loads);
    if (p.agent_ids) colonies.setMembers(id, p.agent_ids);
    return colonies.get(id);
  },
  setSkills: (id: string, ids: string[], loads?: Record<string, SkillLoad>) => assignSkills('colony', id, ids, loads),
  /** Replaces membership; an agent belongs to at most one colony. */
  setMembers(id: string, agentIds: string[]) {
    db.transaction(() => {
      db.prepare('UPDATE agents SET colony_id=NULL WHERE colony_id=?').run(id);
      for (const a of agentIds) db.prepare('UPDATE agents SET colony_id=? WHERE id=?').run(id, a);
    })();
  },
  remove: (id: string) => db.prepare('DELETE FROM colonies WHERE id=?').run(id).changes > 0,
};

// ---- agents ----
const FIELDS: InheritField[] = ['cwd', 'permission', 'skills', 'prompt'];
function agentRow(r: any): Agent {
  const skill_ids = (db.prepare('SELECT skill_id FROM agent_skills WHERE agent_id=?').all(r.id) as any[]).map((x) => x.skill_id);
  const worker_ids = (db.prepare('SELECT worker_id FROM assignments WHERE orchestrator_id=?').all(r.id) as any[]).map((x) => x.worker_id);
  let overrides: InheritField[] = [];
  try { overrides = (JSON.parse(r.overrides ?? '[]') as InheritField[]).filter((f) => FIELDS.includes(f)); } catch { /* none */ }
  const col = r.colony_id ? colonies.get(r.colony_id) : undefined;
  const follows = (f: InheritField) => !!col && col.inherit[f] && !overrides.includes(f);
  const inherited = FIELDS.filter(follows);
  const effective = {
    cwd: follows('cwd') && col!.cwd ? col!.cwd : r.cwd,
    permission: (follows('permission') ? col!.permission : r.permission) as Permission,
    // Colony context comes first so the agent's own instructions have the last word.
    system_prompt: [follows('prompt') ? col!.system_prompt.trim() : '', String(r.system_prompt ?? '').trim()].filter(Boolean).join('\n\n'),
    skill_ids: [...new Set([...(follows('skills') ? col!.skill_ids : []), ...skill_ids])],
    // The agent's own choice for a skill wins over its colony's.
    skill_loads: { ...(follows('skills') ? col!.skill_loads : {}), ...loadsOf('agent', r.id) } as Record<string, SkillLoad>,
    inherited,
  };
  return { ...r, skill_ids, skill_loads: loadsOf('agent', r.id), worker_ids, overrides, effective };
}

/** The agent as it actually runs: colony-inherited values already folded into cwd/permission/prompt/skills. */
export function resolved(a: Agent): Agent {
  return { ...a, cwd: a.effective.cwd, permission: a.effective.permission, system_prompt: a.effective.system_prompt, skill_ids: a.effective.skill_ids, skill_loads: a.effective.skill_loads };
}

export const agents = {
  list: () => (db.prepare('SELECT * FROM agents ORDER BY role DESC, name').all() as any[]).map(agentRow),
  get(id: string) { const r = db.prepare('SELECT * FROM agents WHERE id=?').get(id); return r ? agentRow(r) : undefined; },
  byName(name: string) { const r = db.prepare('SELECT * FROM agents WHERE lower(name)=lower(?)').get(name); return r ? agentRow(r) : undefined; },
  create(p: Partial<Agent> & { name: string; role: Role; provider: Provider; cwd: string }): Agent {
    const id = uid(), t = now();
    db.prepare('INSERT INTO agents (id,name,description,role,type_id,provider,model,system_prompt,permission,cwd,session_id,status,created_at,updated_at,colony_id,overrides) VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?)').run(
      id, p.name, p.description ?? '', p.role, p.type_id ?? null, p.provider, p.model ?? '', p.system_prompt ?? '',
      (p.permission ?? 'acceptEdits') as Permission, p.cwd ?? '', 'idle', t, t, p.colony_id ?? null, JSON.stringify(p.overrides ?? []));
    agents.setSkills(id, p.skill_ids ?? [], p.skill_loads);
    agents.setWorkers(id, p.worker_ids ?? []);
    return agents.get(id)!;
  },
  update(id: string, p: Partial<Agent>): Agent | undefined {
    const cur = agents.get(id); if (!cur) return;
    const n = { ...cur, ...p };
    db.prepare(`UPDATE agents SET name=?, description=?, role=?, type_id=?, provider=?, model=?, system_prompt=?, permission=?, cwd=?, colony_id=?, overrides=?, updated_at=? WHERE id=?`)
      .run(n.name, n.description, n.role, n.type_id, n.provider, n.model, n.system_prompt, n.permission, n.cwd, n.colony_id ?? null, JSON.stringify(n.overrides ?? []), now(), id);
    if (p.skill_ids || p.skill_loads) agents.setSkills(id, p.skill_ids ?? cur.skill_ids, p.skill_loads);
    if (p.worker_ids) agents.setWorkers(id, p.worker_ids);
    return agents.get(id);
  },
  setInstrHash: (id: string, hash: string | null) => db.prepare('UPDATE agents SET instr_hash=? WHERE id=?').run(hash, id),
  setStatus: (id: string, status: string) => db.prepare('UPDATE agents SET status=?, updated_at=? WHERE id=?').run(status, now(), id),
  setSession(a: Agent, sessionId: string | null) {
    db.prepare('UPDATE agents SET session_id=?, session_cwd=?, instr_hash=NULL, updated_at=? WHERE id=?').run(sessionId, sessionId ? a.effective.cwd : null, now(), a.id);
    if (sessionId) {
      db.prepare(`INSERT INTO agent_sessions (agent_id, provider, session_id, cwd, first_seen, last_seen) VALUES (?,?,?,?,?,?)
        ON CONFLICT(agent_id, session_id) DO UPDATE SET last_seen=excluded.last_seen`)
        .run(a.id, a.provider, sessionId, a.effective.cwd, now(), now());
    }
  },
  /** Logs a native session without making it the agent's current conversation (used for delegations). */
  recordSession(a: Agent, sessionId: string, kind: 'direct' | 'delegation', fromId?: string, task?: string) {
    db.prepare(`INSERT INTO agent_sessions (agent_id, provider, session_id, cwd, first_seen, last_seen, kind, from_id, task) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(agent_id, session_id) DO UPDATE SET last_seen=excluded.last_seen`)
      .run(a.id, a.provider, sessionId, a.effective.cwd, now(), now(), kind, fromId ?? null, task ? task.slice(0, 500) : null);
  },
  setSkills: (id: string, ids: string[], loads?: Record<string, SkillLoad>) => assignSkills('agent', id, ids, loads),
  setWorkers(id: string, ids: string[]) {
    db.transaction(() => {
      db.prepare('DELETE FROM assignments WHERE orchestrator_id=?').run(id);
      for (const w of ids) if (w !== id) db.prepare('INSERT OR IGNORE INTO assignments VALUES (?,?)').run(id, w);
    })();
  },
  remove: (id: string) => db.prepare('DELETE FROM agents WHERE id=?').run(id).changes > 0,
  sessions: (id: string) => db.prepare('SELECT s.*, f.name from_name FROM agent_sessions s LEFT JOIN agents f ON f.id=s.from_id WHERE s.agent_id=? ORDER BY s.last_seen DESC').all(id) as any[],
  allSessions: () => db.prepare(`SELECT s.*, a.name agent_name, a.role agent_role, f.name from_name FROM agent_sessions s JOIN agents a ON a.id=s.agent_id LEFT JOIN agents f ON f.id=s.from_id ORDER BY s.last_seen DESC`).all() as any[],
};

// ---- dispatch log ----
export const dispatches = {
  start(from: string, to: string, task: string) {
    const id = uid();
    db.prepare('INSERT INTO dispatches (id, from_id, to_id, task, status, result, created_at, finished_at) VALUES (?,?,?,?,?,NULL,?,NULL)').run(id, from, to, task, 'running', now());
    return id;
  },
  setSession: (id: string, sessionId: string) => db.prepare('UPDATE dispatches SET session_id=? WHERE id=?').run(sessionId, id),
  finish: (id: string, status: string, result: string) =>
    db.prepare('UPDATE dispatches SET status=?, result=?, finished_at=? WHERE id=?').run(status, result.slice(0, 20000), now(), id),
  recent: (limit = 50) => db.prepare('SELECT * FROM dispatches ORDER BY created_at DESC LIMIT ?').all(limit) as any[],
};

// Agents left 'running' by a crash/blackout are simply idle again: their session is intact on disk.
db.prepare("UPDATE agents SET status='idle' WHERE status='running'").run();
db.prepare("UPDATE dispatches SET status='interrupted' WHERE status='running'").run();
