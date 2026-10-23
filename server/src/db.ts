import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { migrate } from './db/migrations.js';
import { parseJson } from './db/json.js';
import type { Agent, AgentType, Colony, InheritField, InheritFlags, Skill, SkillLoad, Provider, Role, Permission } from './types.js';

export const DATA_DIR = process.env.HIVE_AM_HOME ?? join(homedir(), '.hive-am');
mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(join(DATA_DIR, 'hive-am.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Every table and column is created by the numbered migrations (db/migrations.ts); modules that own a table import `db` from here, so it is ready by then.
migrate(db);

const now = () => Date.now();
const uid = () => randomUUID();

// Statements are prepared once and reused (the SQL text is the key; the few dynamic ones only vary by table name).
const prepared = new Map<string, Database.Statement>();
const q = (sql: string): Database.Statement => { let st = prepared.get(sql); if (!st) prepared.set(sql, (st = db.prepare(sql))); return st; };

// Rows as SQLite returns them. A repository turns each into the public type, adding what lives in other tables.
type SkillRow = Skill;
type TypeRow = Omit<AgentType, 'skill_ids' | 'skill_loads'>;
type ColonyRow = Omit<Colony, 'inherit' | 'skill_ids' | 'skill_loads' | 'agent_ids'> & { inherit: string };
type AgentRow = Omit<Agent, 'skill_ids' | 'skill_loads' | 'worker_ids' | 'overrides' | 'effective' | 'browser'> & { overrides: string | null; browser: number };
interface LoadRow { skill_id: string; load: string }
interface CountRow { skill_id: string; c: number }
export interface SessionRow { agent_id: string; provider: Provider; session_id: string; cwd: string; first_seen: number; last_seen: number; kind: 'direct' | 'delegation'; from_id: string | null; task: string | null; from_name: string | null; permission: Permission | null }
export interface SessionWithAgentRow extends SessionRow { agent_name: string; agent_role: Role }
export interface DispatchRow {
  id: string; from_id: string; to_id: string; task: string; status: string; result: string | null; created_at: number; finished_at: number | null; session_id: string | null;
  mode: 'sync' | 'background'; origin: string | null; notified_at: number | null; read_at: number | null;
}

// ---- skills ----
export const skills = {
  list: () => q('SELECT * FROM skills ORDER BY name').all() as SkillRow[],
  get: (id: string) => q('SELECT * FROM skills WHERE id=?').get(id) as SkillRow | undefined,
  create(p: Pick<Skill, 'name' | 'description' | 'content'> & { load?: SkillLoad }): Skill {
    const id = uid(), t = now();
    q('INSERT INTO skills (id,name,description,content,created_at,updated_at,load) VALUES (?,?,?,?,?,?,?)').run(id, p.name, p.description ?? '', p.content ?? '', t, t, p.load ?? ((p.content ?? '').length > 2000 ? 'on_demand' : 'always'));
    return skills.get(id)!;
  },
  update(id: string, p: Partial<Pick<Skill, 'name' | 'description' | 'content' | 'load'>>): Skill | undefined {
    const cur = skills.get(id); if (!cur) return;
    const n = { ...cur, ...p };
    q('UPDATE skills SET name=?, description=?, content=?, load=?, updated_at=? WHERE id=?').run(n.name, n.description, n.content, n.load, now(), id);
    return skills.get(id);
  },
  remove: (id: string) => q('DELETE FROM skills WHERE id=?').run(id).changes > 0,
  /**
   * Adds the skills that come with hive-am, once each: they are ordinary skills afterwards (edit them, delete them). A
   * skill that was seeded before is never added back, and one the user already has under that name is left alone.
   */
  seedDefaults(defs: { slug: string; name: string; description: string; content: string; load?: SkillLoad }[]) {
    const t = now();
    db.transaction(() => {
      for (const d of defs) {
        const id = `default-${d.slug}`;
        if (q('SELECT 1 FROM seeded_skills WHERE slug=?').get(d.slug)) continue;
        q('INSERT OR IGNORE INTO seeded_skills (slug) VALUES (?)').run(d.slug);
        if (q('SELECT 1 FROM skills WHERE id=?').get(id)) continue; // from an earlier build: keep it as it is
        const taken = !!q('SELECT 1 FROM skills WHERE lower(name)=lower(?)').get(d.name);
        q('INSERT INTO skills (id,name,description,content,created_at,updated_at,load) VALUES (?,?,?,?,?,?,?)').run(id, taken ? `${d.name} (hive-am)` : d.name, d.description, d.content, t, t, d.load ?? 'always');
      }
    })();
  },
  /** Agents/types using each skill, for the library view. */
  usage(): Record<string, { agents: number; types: number }> {
    const out: Record<string, { agents: number; types: number }> = {};
    for (const s of skills.list()) out[s.id] = { agents: 0, types: 0 };
    for (const r of q('SELECT skill_id, COUNT(*) c FROM agent_skills GROUP BY skill_id').all() as CountRow[]) if (out[r.skill_id]) out[r.skill_id].agents = r.c;
    for (const r of q('SELECT skill_id, COUNT(*) c FROM type_skills GROUP BY skill_id').all() as CountRow[]) if (out[r.skill_id]) out[r.skill_id].types = r.c;
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
  for (const r of q(`SELECT skill_id, load FROM ${j.table} WHERE ${j.owner}=?`).all(id) as LoadRow[]) out[r.skill_id] = r.load === 'on_demand' ? 'on_demand' : 'always';
  return out;
}
const skillIdsOf = (kind: JoinKind, id: string): string[] => { const j = JOINS[kind]; return (q(`SELECT skill_id FROM ${j.table} WHERE ${j.owner}=?`).all(id) as { skill_id: string }[]).map((x) => x.skill_id); };
/**
 * Replaces the skills of a type/colony/agent. A skill keeps the way it was loaded before; a new one takes what the caller
 * says, or else the skill's own suggestion.
 */
function assignSkills(kind: JoinKind, id: string, ids: string[], loads?: Record<string, SkillLoad>) {
  const j = JOINS[kind], prev = loadsOf(kind, id);
  db.transaction(() => {
    q(`DELETE FROM ${j.table} WHERE ${j.owner}=?`).run(id);
    for (const s of ids) {
      const load = loads?.[s] ?? prev[s] ?? skills.get(s)?.load ?? 'always';
      q(`INSERT OR IGNORE INTO ${j.table} (${j.owner}, skill_id, load) VALUES (?,?,?)`).run(id, s, load === 'on_demand' ? 'on_demand' : 'always');
    }
  })();
}

// ---- agent types ----
function typeOf(r: TypeRow): AgentType {
  return { ...r, skill_ids: skillIdsOf('type', r.id), skill_loads: loadsOf('type', r.id) };
}
export const types = {
  list: () => (q('SELECT * FROM agent_types ORDER BY role DESC, name').all() as TypeRow[]).map(typeOf),
  get(id: string) { const r = q('SELECT * FROM agent_types WHERE id=?').get(id) as TypeRow | undefined; return r ? typeOf(r) : undefined; },
  create: db.transaction((p: Partial<AgentType> & { name: string; role: Role; provider: Provider }): AgentType => {
    const id = uid();
    q('INSERT INTO agent_types (id,name,description,role,provider,model,effort,system_prompt,permission,color,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
      id, p.name, p.description ?? '', p.role, p.provider, p.model ?? '', p.effort ?? '', p.system_prompt ?? '',
      (p.permission ?? 'acceptEdits') as Permission, p.color ?? '', now());
    types.setSkills(id, p.skill_ids ?? [], p.skill_loads);
    return types.get(id)!;
  }),
  update: db.transaction((id: string, p: Partial<AgentType>): AgentType | undefined => {
    const cur = types.get(id); if (!cur) return;
    const n = { ...cur, ...p };
    q('UPDATE agent_types SET name=?, description=?, role=?, provider=?, model=?, effort=?, system_prompt=?, permission=?, color=? WHERE id=?')
      .run(n.name, n.description, n.role, n.provider, n.model, n.effort ?? '', n.system_prompt, n.permission, n.color, id);
    if (p.skill_ids || p.skill_loads) types.setSkills(id, p.skill_ids ?? cur.skill_ids, p.skill_loads);
    return types.get(id);
  }),
  setSkills: (id: string, ids: string[], loads?: Record<string, SkillLoad>) => assignSkills('type', id, ids, loads),
  remove: (id: string) => q('DELETE FROM agent_types WHERE id=?').run(id).changes > 0,
};

// ---- colonies ----
const DEFAULT_INHERIT: InheritFlags = { cwd: true, permission: true, skills: true, prompt: true };
function colonyOf(r: ColonyRow): Colony {
  const agent_ids = (q('SELECT id FROM agents WHERE colony_id=? ORDER BY name').all(r.id) as { id: string }[]).map((x) => x.id);
  const inherit: InheritFlags = { ...DEFAULT_INHERIT, ...parseJson<Partial<InheritFlags>>(r.inherit, {}, `colony ${r.id} inherit`) };
  return { ...r, inherit, skill_ids: skillIdsOf('colony', r.id), skill_loads: loadsOf('colony', r.id), agent_ids };
}
export const colonies = {
  list: () => (q('SELECT * FROM colonies ORDER BY name').all() as ColonyRow[]).map(colonyOf),
  get(id: string) { const r = q('SELECT * FROM colonies WHERE id=?').get(id) as ColonyRow | undefined; return r ? colonyOf(r) : undefined; },
  create: db.transaction((p: Partial<Colony> & { name: string }): Colony => {
    const id = uid();
    q('INSERT INTO colonies (id,name,color,cwd,permission,system_prompt,inherit,created_at) VALUES (?,?,?,?,?,?,?,?)').run(
      id, p.name, p.color ?? '', p.cwd ?? '', (p.permission ?? 'acceptEdits') as Permission, p.system_prompt ?? '',
      JSON.stringify({ ...DEFAULT_INHERIT, ...(p.inherit ?? {}) }), now());
    colonies.setSkills(id, p.skill_ids ?? [], p.skill_loads);
    if (p.agent_ids) colonies.setMembers(id, p.agent_ids);
    return colonies.get(id)!;
  }),
  update: db.transaction((id: string, p: Partial<Colony>): Colony | undefined => {
    const cur = colonies.get(id); if (!cur) return;
    const n = { ...cur, ...p, inherit: { ...cur.inherit, ...(p.inherit ?? {}) } };
    q('UPDATE colonies SET name=?, color=?, cwd=?, permission=?, system_prompt=?, inherit=? WHERE id=?')
      .run(n.name, n.color, n.cwd, n.permission, n.system_prompt, JSON.stringify(n.inherit), id);
    if (p.skill_ids || p.skill_loads) colonies.setSkills(id, p.skill_ids ?? cur.skill_ids, p.skill_loads);
    if (p.agent_ids) colonies.setMembers(id, p.agent_ids);
    return colonies.get(id);
  }),
  setSkills: (id: string, ids: string[], loads?: Record<string, SkillLoad>) => assignSkills('colony', id, ids, loads),
  /** Replaces membership; an agent belongs to at most one colony. */
  setMembers: db.transaction((id: string, agentIds: string[]) => {
    q('UPDATE agents SET colony_id=NULL WHERE colony_id=?').run(id);
    for (const a of agentIds) q('UPDATE agents SET colony_id=? WHERE id=?').run(id, a);
  }),
  /** Members stay (their colony becomes none through the foreign key); the colony's own skill assignments go with it. */
  remove: (id: string) => q('DELETE FROM colonies WHERE id=?').run(id).changes > 0,
};

// ---- agents ----
const FIELDS: InheritField[] = ['cwd', 'permission', 'skills', 'prompt'];
function agentOf(r: AgentRow): Agent {
  const skill_ids = skillIdsOf('agent', r.id);
  const worker_ids = (q('SELECT worker_id FROM assignments WHERE orchestrator_id=?').all(r.id) as { worker_id: string }[]).map((x) => x.worker_id);
  const overrides = parseJson<InheritField[]>(r.overrides, [], `agent ${r.id} overrides`).filter((f) => FIELDS.includes(f));
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
  return { ...r, browser: !!r.browser, skill_ids, skill_loads: loadsOf('agent', r.id), worker_ids, overrides, effective };
}

/** The agent as it actually runs: colony-inherited values already folded into cwd/permission/prompt/skills. */
export function resolved(a: Agent): Agent {
  return { ...a, cwd: a.effective.cwd, permission: a.effective.permission, system_prompt: a.effective.system_prompt, skill_ids: a.effective.skill_ids, skill_loads: a.effective.skill_loads };
}

export const agents = {
  list: () => (q('SELECT * FROM agents ORDER BY role DESC, name').all() as AgentRow[]).map(agentOf),
  get(id: string) { const r = q('SELECT * FROM agents WHERE id=?').get(id) as AgentRow | undefined; return r ? agentOf(r) : undefined; },
  byName(name: string) { const r = q('SELECT * FROM agents WHERE lower(name)=lower(?)').get(name) as AgentRow | undefined; return r ? agentOf(r) : undefined; },
  /** The agent, its skills and its workers are written together: either all of it exists afterwards or none. */
  create: db.transaction((p: Partial<Agent> & { name: string; role: Role; provider: Provider; cwd: string }): Agent => {
    const id = uid(), t = now();
    q('INSERT INTO agents (id,name,description,role,type_id,provider,model,effort,system_prompt,permission,cwd,session_id,status,created_at,updated_at,colony_id,overrides,browser,cloned_from) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?)').run(
      id, p.name, p.description ?? '', p.role, p.type_id ?? null, p.provider, p.model ?? '', p.effort ?? '', p.system_prompt ?? '',
      (p.permission ?? 'acceptEdits') as Permission, p.cwd ?? '', 'idle', t, t, p.colony_id ?? null, JSON.stringify(p.overrides ?? []), p.browser && p.provider === 'claude' ? 1 : 0, p.cloned_from ?? null);
    agents.setSkills(id, p.skill_ids ?? [], p.skill_loads);
    agents.setWorkers(id, p.worker_ids ?? []);
    return agents.get(id)!;
  }),
  update: db.transaction((id: string, p: Partial<Agent>): Agent | undefined => {
    const cur = agents.get(id); if (!cur) return;
    const n = { ...cur, ...p };
    q('UPDATE agents SET name=?, description=?, role=?, type_id=?, provider=?, model=?, effort=?, system_prompt=?, permission=?, cwd=?, colony_id=?, overrides=?, browser=?, updated_at=? WHERE id=?')
      .run(n.name, n.description, n.role, n.type_id, n.provider, n.model, n.effort ?? '', n.system_prompt, n.permission, n.cwd, n.colony_id ?? null, JSON.stringify(n.overrides ?? []), n.browser && n.provider === 'claude' ? 1 : 0, now(), id);
    if (p.skill_ids || p.skill_loads) agents.setSkills(id, p.skill_ids ?? cur.skill_ids, p.skill_loads);
    if (p.worker_ids) agents.setWorkers(id, p.worker_ids);
    return agents.get(id);
  }),
  setInstrHash: (id: string, hash: string | null) => q('UPDATE agents SET instr_hash=? WHERE id=?').run(hash, id),
  setStatus: (id: string, status: string) => q('UPDATE agents SET status=?, updated_at=? WHERE id=?').run(status, now(), id),
  setSession: db.transaction((a: Agent, sessionId: string | null) => {
    q('UPDATE agents SET session_id=?, session_cwd=?, instr_hash=NULL, updated_at=? WHERE id=?').run(sessionId, sessionId ? a.effective.cwd : null, now(), a.id);
    if (sessionId) {
      // The permission is written once, when the session is first seen: it never changes on conflict, or a later change of permission would be hidden.
      q(`INSERT INTO agent_sessions (agent_id, provider, session_id, cwd, first_seen, last_seen, permission) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(agent_id, session_id) DO UPDATE SET last_seen=excluded.last_seen`)
        .run(a.id, a.provider, sessionId, a.effective.cwd, now(), now(), a.effective.permission);
    }
  }),
  /** Logs a native session without making it the agent's current conversation (used for delegations). */
  recordSession(a: Agent, sessionId: string, kind: 'direct' | 'delegation', fromId?: string, task?: string) {
    q(`INSERT INTO agent_sessions (agent_id, provider, session_id, cwd, first_seen, last_seen, kind, from_id, task, permission) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(agent_id, session_id) DO UPDATE SET last_seen=excluded.last_seen`)
      .run(a.id, a.provider, sessionId, a.effective.cwd, now(), now(), kind, fromId ?? null, task ? task.slice(0, 500) : null, a.effective.permission);
  },
  setSkills: (id: string, ids: string[], loads?: Record<string, SkillLoad>) => assignSkills('agent', id, ids, loads),
  /** Replaces the workers an orchestrator may dispatch to (never itself). */
  setWorkers: db.transaction((id: string, ids: string[]) => {
    q('DELETE FROM assignments WHERE orchestrator_id=?').run(id);
    for (const w of ids) if (w !== id) q('INSERT OR IGNORE INTO assignments (orchestrator_id, worker_id) VALUES (?,?)').run(id, w);
  }),
  remove: (id: string) => q('DELETE FROM agents WHERE id=?').run(id).changes > 0,
  sessions: (id: string) => q('SELECT s.*, f.name from_name FROM agent_sessions s LEFT JOIN agents f ON f.id=s.from_id WHERE s.agent_id=? ORDER BY s.last_seen DESC').all(id) as SessionRow[],
  allSessions: () => q(`SELECT s.*, a.name agent_name, a.role agent_role, f.name from_name FROM agent_sessions s JOIN agents a ON a.id=s.agent_id LEFT JOIN agents f ON f.id=s.from_id ORDER BY s.last_seen DESC`).all() as SessionWithAgentRow[],
};

// ---- dispatch log ----
// A delegation is `queued` until the worker's turn starts (it waits behind the worker's other turns), then `running`, then `done`, `failed`,
// `interrupted` (the server stopped while it was queued or running) or `cancelled` (its orchestrator or the person took it back). Only a
// row still queued or running is closed, so the first of the end of the turn and a cancel sets the one final state.
export const dispatches = {
  start(from: string, to: string, task: string, mode: 'sync' | 'background' = 'sync', origin: string | null = null) {
    const id = uid();
    q('INSERT INTO dispatches (id, from_id, to_id, task, status, result, created_at, finished_at, mode, origin) VALUES (?,?,?,?,?,NULL,?,NULL,?,?)').run(id, from, to, task, 'queued', now(), mode, origin);
    return id;
  },
  get: (id: string) => q('SELECT * FROM dispatches WHERE id=?').get(id) as DispatchRow | undefined,
  setRunning: (id: string) => q("UPDATE dispatches SET status='running' WHERE id=? AND status='queued'").run(id),
  setSession: (id: string, sessionId: string) => q('UPDATE dispatches SET session_id=? WHERE id=?').run(sessionId, id),
  finish: (id: string, status: string, result: string) =>
    q("UPDATE dispatches SET status=?, result=?, finished_at=? WHERE id=? AND status IN ('queued','running')").run(status, result.slice(0, 20000), now(), id).changes > 0,
  /** Cancels a task that has not finished; false if it already had. Cancelled by its orchestrator, it is never announced (the tool told it). */
  cancel: (id: string, result: string, byOrchestrator: boolean) => {
    const at = now();
    return q("UPDATE dispatches SET status='cancelled', result=?, finished_at=?, notified_at=CASE WHEN ? THEN ? ELSE notified_at END WHERE id=? AND status IN ('queued','running')").run(result, at, byOrchestrator ? 1 : 0, at, id).changes > 0;
  },
  markNotified: (id: string) => q('UPDATE dispatches SET notified_at=? WHERE id=? AND notified_at IS NULL').run(now(), id),
  markRead: (id: string) => q('UPDATE dispatches SET read_at=? WHERE id=? AND read_at IS NULL').run(now(), id),
  /** Background tasks of an orchestrator that have not finished yet. */
  unfinished: (from: string) => (q("SELECT COUNT(*) AS n FROM dispatches WHERE from_id=? AND mode='background' AND status IN ('queued','running')").get(from) as { n: number }).n,
  /** Every task of an orchestrator that has not finished, oldest first. */
  open: (from: string) => q("SELECT * FROM dispatches WHERE from_id=? AND status IN ('queued','running') ORDER BY created_at, id").all(from) as DispatchRow[],
  /** Finished background tasks whose result was not handed to the orchestrator yet. */
  undelivered: () => q("SELECT * FROM dispatches WHERE mode='background' AND status NOT IN ('queued','running') AND notified_at IS NULL ORDER BY created_at").all() as DispatchRow[],
  /** At startup nothing is running any more: what was queued or running is interrupted (a task is never resumed). */
  interruptLeftovers: () => q("UPDATE dispatches SET status='interrupted', finished_at=? WHERE status IN ('queued','running')").run(now()).changes,
  /** The newest rows, plus any older one that has not finished (so the interface can always show and cancel it). */
  recent: (limit = 50) => q("SELECT * FROM (SELECT * FROM dispatches ORDER BY created_at DESC LIMIT ?) UNION SELECT * FROM dispatches WHERE status IN ('queued','running') ORDER BY created_at DESC").all(limit) as DispatchRow[],
};

// Agents left 'running' by a crash/blackout are simply idle again: their session is intact on disk.
q("UPDATE agents SET status='idle' WHERE status='running'").run();
dispatches.interruptLeftovers();
