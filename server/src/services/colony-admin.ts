import { agents, colonies, db, resolved, skills } from '../db.js';
import { connections } from '../connections/store.js';
import { effortOptions } from '../efforts.js';
import { mcpCaps } from '../instructions.js';
import { listModels } from '../models.js';
import { listObjects, createObject, removeObject, setObjectManager, updateObject } from '../objects/index.js';
import { isKind, kindOf, type ObjectView } from '../objects/model.js';
import { maskConfig, objectsStore } from '../objects/store.js';
import { notebooks } from '../skills/notebook.js';
import { notifyAgentsChanged } from '../runtime.js';
import { createAgent, removeAgent, updateAgent } from './agents.js';
import { createColony, removeColony, updateColony } from './colonies.js';
import { PROVIDERS, isProvider, providerStatus } from './providers.js';
import { bad } from '../http/errors.js';
import { isRecord, text, trimmed, validateAgentInput, validateColony, type AgentInput, type ColonyInput } from '../http/validate.js';
import type { Agent, Colony, InheritField, Permission, SkillLoad } from '../types.js';

/**
 * What an agent with the "Colony builder" skill can do: create, read, change and delete colonies, agents and resources of ANY colony,
 * through the same services the web app uses (their checks are the ones that apply). On top of them, enforced here and not only written
 * in the skill:
 *  - a read-only (Plan mode) agent can look but not change anything;
 *  - no secret leaves (database passwords, secret HTTP variables, `env` values) and none comes in (they are set in the web app);
 *  - Telegram/Slack connections are not reachable, and an agent linked to one is not deleted from here;
 *  - an agent cannot delete itself, the orchestrator it works for, an agent it has a task open with, or its own colony, and no change may
 *    take away its own access to these tools (or leave it read-only): such a change is rolled back whole;
 *  - deleting needs `confirm` equal to the exact name of what is deleted; without it nothing is deleted and the answer says what would be.
 * Arguments use names, never ids: the names of colonies, agents, skills and resources are unique regardless of case.
 */
type Args = Record<string, any>;

const NO_SKILL = 'You do not have the "Colony builder" skill.';
const READ_ONLY = 'You are read-only: you can look at colonies, agents and resources but not change them.';
const SELF_LOCKOUT = 'That change would take away your own Colony builder access (or make you read-only). Ask the person to do it from the web app.';
const NO_SECRETS = 'Set secrets in the web app (Resources); never put them in a chat.';
const PERMISSIONS: Permission[] = ['plan', 'acceptEdits', 'bypassPermissions'];
const FIELDS: InheritField[] = ['cwd', 'permission', 'skills', 'prompt'];
const MASK = '***';

function whoAsks(from: unknown): Agent {
  const a = typeof from === 'string' ? agents.get(from) : undefined;
  if (!a || !mcpCaps(resolved(a)).includes('colonies')) throw bad(NO_SKILL);
  return a;
}
const writer = (a: Agent) => { if (a.effective.permission === 'plan') throw bad(READ_ONLY); };
/** Keeps the caller able to use these tools: the change runs in a transaction that is rolled back if it would not be. */
function keepingAccess<T>(a: Agent, change: () => T): T {
  return db.transaction(() => {
    const out = change();
    const me = agents.get(a.id);
    if (!me || !mcpCaps(resolved(me)).includes('colonies') || me.effective.permission === 'plan') throw bad(SELF_LOCKOUT);
    return out;
  })();
}

// ---- names to records -----------------------------------------------------------------------------------------------------------------

const same = (a: string, b: unknown) => a.toLowerCase() === trimmed(b).toLowerCase();
const names = (xs: { name: string }[]) => xs.map((x) => x.name).join(', ') || '(none)';
const isNone = (v: unknown) => v === null || ['', 'none', 'null'].includes(trimmed(v).toLowerCase());

function colonyNamed(name: unknown): Colony {
  const all = colonies.list(), c = all.find((x) => same(x.name, name));
  if (!c) throw bad(`There is no colony named "${text(name)}". Colonies: ${names(all)}.`);
  return c;
}
function agentNamed(name: unknown): Agent {
  const a = agents.byName(trimmed(name));
  if (!a) throw bad(`There is no agent named "${text(name)}". Agents: ${names(agents.list())}.`);
  return a;
}
function resourceNamed(name: unknown): ObjectView {
  const all = listObjects(), o = all.find((x) => same(x.name, name));
  if (!o) throw bad(`There is no resource named "${text(name)}". Resources: ${names(all)}.`);
  return o;
}
/** `null`, '' or "none" is no colony; anything else must be the name of one. */
const colonyArg = (v: unknown): string | null => (isNone(v) ? null : colonyNamed(v).id);
const colonyName = (id: string | null) => (id ? colonies.get(id)?.name ?? null : null);
const agentName = (id: string) => agents.get(id)?.name ?? id;

/** `[{ name, load }]` (or plain names) to the ids and loads the repositories take. */
function skillsArg(v: unknown): { skill_ids: string[]; skill_loads: Record<string, SkillLoad> } {
  if (!Array.isArray(v)) throw bad('skills must be a list of { name, load }');
  const all = skills.list(), skill_ids: string[] = [], skill_loads: Record<string, SkillLoad> = {};
  for (const item of v) {
    const r: Record<string, unknown> = isRecord(item) ? item : { name: item };
    const s = all.find((x) => same(x.name, r.name));
    if (!s) throw bad(`There is no skill named "${text(r.name)}". Call colony_skill_list for the names.`);
    if (r.load !== undefined && r.load !== 'always' && r.load !== 'on_demand') throw bad('A skill load must be always or on_demand');
    skill_ids.push(s.id);
    skill_loads[s.id] = (r.load as SkillLoad | undefined) ?? s.load;
  }
  return { skill_ids, skill_loads };
}
const skillsOut = (ids: string[], loads: Record<string, SkillLoad>) => ids.map((id) => skills.get(id)).filter((s) => !!s).map((s) => ({ name: s!.name, load: loads[s!.id] ?? s!.load }));
const permissionArg = (v: unknown): Permission => { if (!PERMISSIONS.includes(v as Permission)) throw bad(`permission must be ${PERMISSIONS.join(', ')}`); return v as Permission; };

// ---- what is shown (never a secret, a session or a token) -----------------------------------------------------------------------------

const colonyOut = (c: Colony) => ({
  name: c.name, color: c.color, cwd: c.cwd, permission: c.permission, system_prompt: c.system_prompt, inherit: c.inherit,
  skills: skillsOut(c.skill_ids, c.skill_loads), agents: c.agent_ids.map(agentName),
});
const colonyLine = (c: Colony) => ({ name: c.name, cwd: c.cwd, permission: c.permission, agents: c.agent_ids.map(agentName), skills: skillsOut(c.skill_ids, c.skill_loads).map((s) => s.name) });
const linkedTo = (id: string) => connections.list().filter((c) => c.agent_id === id);
const bossesOf = (id: string) => agents.list().filter((o) => o.role === 'orchestrator' && o.worker_ids.includes(id));
function agentOut(a: Agent) {
  return {
    name: a.name, description: a.description, role: a.role, provider: a.provider, model: a.model, effort: a.effort, permission: a.permission, cwd: a.cwd,
    colony: colonyName(a.colony_id), browser: a.browser, overrides: a.overrides, inherited: a.effective.inherited, system_prompt: a.system_prompt,
    skills: skillsOut(a.skill_ids, a.skill_loads), workers: a.worker_ids.map(agentName), orchestrators: bossesOf(a.id).map((o) => o.name),
    effective: { cwd: a.effective.cwd, permission: a.effective.permission, skills: skillsOut(a.effective.skill_ids, a.effective.skill_loads), system_prompt: a.effective.system_prompt },
    chat_connections: linkedTo(a.id).length, status: a.status,
  };
}
const agentLine = (a: Agent) => ({ name: a.name, role: a.role, provider: a.provider, model: a.model, permission: a.effective.permission, colony: colonyName(a.colony_id), description: a.description, status: a.status });
/** `env` of servers and containers keeps its names and hides its values (maskConfig already empties passwords and secret HTTP variables). */
function configOut(o: ObjectView) {
  const c = { ...(o.config as unknown as Record<string, unknown>) };
  if (isRecord(c.env)) c.env = Object.fromEntries(Object.keys(c.env).map((k) => [k, MASK]));
  if (o.kind === 'cluster' && Array.isArray(c.members)) c.members = c.members.map((id) => objectsStore.get(String(id))?.name ?? id);
  return c;
}
const resourceLine = (o: ObjectView) => ({ name: o.name, kind: o.kind, colony: colonyName(o.colony_id), status: o.state.status, detail: o.state.detail ?? null, manager: o.manager_id ? agentName(o.manager_id) : null });

// ---- input ----------------------------------------------------------------------------------------------------------------------------

function colonyInput(args: Args, partial: boolean): ColonyInput {
  const p: Record<string, unknown> = {};
  for (const k of ['name', 'color', 'cwd', 'system_prompt'] as const) if (args[k] !== undefined) p[k] = text(args[k]);
  if (args.permission !== undefined) p.permission = permissionArg(args.permission);
  if (args.inherit !== undefined) {
    if (!isRecord(args.inherit) || Object.entries(args.inherit).some(([k, v]) => !FIELDS.includes(k as InheritField) || typeof v !== 'boolean')) throw bad(`inherit takes true or false for ${FIELDS.join(', ')}`);
    p.inherit = args.inherit;
  }
  if (args.skills !== undefined) Object.assign(p, skillsArg(args.skills));
  if (args.agents !== undefined) {
    if (!partial) throw bad('Create the colony first, then add agents with colony_update (or set their colony)');
    if (!Array.isArray(args.agents)) throw bad('agents must be a list of agent names');
    p.agent_ids = args.agents.map((n: unknown) => agentNamed(n).id);
  }
  return validateColony(p, partial);
}

function agentInput(args: Args, cur?: Agent): AgentInput {
  const p: Record<string, unknown> = {};
  for (const k of ['name', 'description', 'role', 'provider', 'model', 'effort', 'cwd', 'system_prompt'] as const) if (args[k] !== undefined) p[k] = args[k] === null ? '' : text(args[k]);
  if (!cur) { p.role ??= 'worker'; if (p.provider === undefined) throw bad(`Choose the provider: ${Object.keys(PROVIDERS).join(', ')} (colony_options says which are installed)`); }
  if (args.permission !== undefined) p.permission = permissionArg(args.permission);
  if (args.browser !== undefined) p.browser = args.browser;
  if (args.colony !== undefined) p.colony_id = colonyArg(args.colony);
  if (args.overrides !== undefined) {
    if (!Array.isArray(args.overrides) || args.overrides.some((f: unknown) => !FIELDS.includes(f as InheritField))) throw bad(`overrides must be a list of ${FIELDS.join(', ')}`);
    p.overrides = [...new Set(args.overrides)];
  }
  if (args.skills !== undefined) Object.assign(p, skillsArg(args.skills));
  if (args.workers !== undefined) {
    if ((p.role ?? cur?.role) !== 'orchestrator') throw bad('Only an orchestrator has workers');
    if (!Array.isArray(args.workers)) throw bad('workers must be a list of agent names');
    p.worker_ids = args.workers.map((n: unknown) => agentNamed(n).id);
    if (cur && (p.worker_ids as string[]).includes(cur.id)) throw bad('An orchestrator cannot be its own worker');
  }
  return validateAgentInput(p, !!cur);
}

/** A secret written here would stay in the conversation: database passwords and the values of secret HTTP variables come from the web app. */
function refuseSecrets(kind: string, config: unknown) {
  if (!isRecord(config)) return;
  if (kind === 'database' && typeof config.password === 'string' && config.password !== '') throw bad(NO_SECRETS);
  if (kind === 'http' && isRecord(config.variables)) {
    for (const vars of Object.values(config.variables)) if (isRecord(vars)) for (const v of Object.values(vars)) if (isRecord(v) && v.secret && typeof v.value === 'string' && v.value !== '') throw bad(NO_SECRETS);
  }
}
/**
 * `variables` of an HTTP resource, merged by environment and by name with the saved ones (masked: a secret comes empty and the store keeps
 * its value). A variable that is not sent stays; a plain one is removed by sending it (or its whole environment) as null. A saved secret
 * cannot be removed, emptied or made plain from here: the person does that in the web app.
 */
function mergeVariables(saved: unknown, incoming: unknown) {
  if (incoming === null) incoming = Object.fromEntries(Object.keys(isRecord(saved) ? saved : {}).map((env) => [env, null]));
  if (!isRecord(incoming)) throw bad('variables must be an object: { environment: { NAME: { value, secret } } }');
  const out: Record<string, Record<string, unknown>> = Object.fromEntries(Object.entries(isRecord(saved) ? saved : {}).map(([env, vars]) => [env, { ...(vars as Record<string, unknown>) }]));
  const secretOf = (env: string, k: string) => { const v = out[env]?.[k]; return isRecord(v) && !!v.secret; };
  const refuse = (env: string, k: string) => bad(`${env}.${k} is a secret saved in the web app: it cannot be removed, emptied or made plain from here. Ask the person to do it in the web app.`);
  for (const [env, vars] of Object.entries(incoming)) {
    if (vars === null) {
      const secret = Object.keys(out[env] ?? {}).find((k) => secretOf(env, k));
      if (secret) throw refuse(env, secret);
      delete out[env];
      continue;
    }
    if (!isRecord(vars)) throw bad(`variables.${env} must be an object of NAME: { value, secret } (or null to remove it)`);
    const cur = out[env] ?? {};
    for (const [k, v] of Object.entries(vars)) {
      if (secretOf(env, k)) {
        if (!isRecord(v) || !v.secret) throw refuse(env, k);
        cur[k] = { value: '', secret: true };
      } else if (v === null) delete cur[k];
      else cur[k] = v;
    }
    out[env] = cur;
  }
  return out;
}
/** Cluster members by name (ids still work). */
function membersById(config: unknown) {
  if (!isRecord(config) || !Array.isArray(config.members)) return config;
  return { ...config, members: config.members.map((m) => objectsStore.get(String(m))?.id ?? objectsStore.byName(trimmed(m))?.id ?? m) };
}

// ---- deleting -------------------------------------------------------------------------------------------------------------------------

const confirmed = (name: string, confirm: unknown) => confirm !== undefined && confirm !== null && same(name, confirm);
const notYet = (name: string, what: string) => ({ deleted: false, name, would_delete: what });
const count = (sql: string, id: string) => (db.prepare(sql).get(id) as { n: number }).n;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

function deleteColony(a: Agent, args: Args) {
  const c = colonyNamed(args.name);
  if (a.colony_id === c.id) throw bad(`"${c.name}" is your own colony: deleting it would take away your folder, permission, skills and prompt. Ask the person to do it from the web app.`);
  const members = c.agent_ids.map((id) => agents.get(id)!).filter(Boolean);
  const stranded = members.filter((m) => !m.cwd.trim()).map((m) => m.name);
  if (!confirmed(c.name, args.confirm)) {
    return notYet(c.name, `the colony "${c.name}". Its agents are NOT deleted: ${members.length ? `${members.map((m) => m.name).join(', ')} would be left without a colony` : 'it has none'}${stranded.length ? `, and ${stranded.join(', ')} would have no working folder (they could not run until they get one)` : ''}. Its own skill assignments and prompt go with it; its resources stay, without a colony.`);
  }
  removeColony(c.id);
  return { deleted: true, name: c.name, left_without_colony: members.map((m) => m.name), without_folder: members.filter((m) => !agents.get(m.id)?.effective.cwd).map((m) => m.name) };
}

function deleteAgent(a: Agent, args: Args) {
  const t = agentNamed(args.name);
  if (t.id === a.id) throw bad('You cannot delete yourself: ask the person to do it from the web app.');
  if (t.worker_ids.includes(a.id)) throw bad(`"${t.name}" is your orchestrator: deleting it would cancel the task you are working on. Ask the person to do it from the web app.`);
  const open = db.prepare("SELECT from_id, to_id, task FROM dispatches WHERE status IN ('queued','running') AND ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?))").get(a.id, t.id, t.id, a.id) as { from_id: string; to_id: string; task: string } | undefined;
  if (open) throw bad(`"${t.name}" has a task open with you (${agentName(open.from_id)} to ${agentName(open.to_id)}: "${open.task.replace(/\s+/g, ' ').slice(0, 80)}"). Wait until it ends or cancel it first.`);
  const links = linkedTo(t.id);
  if (links.length) throw bad(`"${t.name}" is linked to a chat connection (${links.map((c) => c.name).join(', ')}): deleting it would switch off that channel. Ask the person to do it from the web app.`);
  if (!confirmed(t.name, args.confirm)) {
    const sessions = agents.sessions(t.id).length, notes = notebooks.get(t.id).content.trim().length;
    const schedules = count('SELECT COUNT(*) n FROM agent_schedules WHERE agent_id=?', t.id), wakeups = count('SELECT COUNT(*) n FROM agent_wakeups WHERE agent_id=?', t.id);
    const managed = listObjects().filter((o) => o.manager_id === t.id).map((o) => o.name), bosses = bossesOf(t.id).map((o) => o.name);
    return notYet(t.name, `the agent "${t.name}" (${t.role}, ${t.provider}): its record of ${plural(sessions, 'conversation')} (the CLI's own files stay), ${notes ? 'its notebook' : 'its empty notebook'}, ${plural(schedules, 'schedule')} and ${plural(wakeups, 'pending wake-up')}${bosses.length ? `; it stops being a worker of ${bosses.join(', ')}` : ''}${t.worker_ids.length ? `; its team (${t.worker_ids.map(agentName).join(', ')}) is unlinked, not deleted` : ''}${managed.length ? `; ${managed.join(', ')} go back to their colony's agents` : ''}. A turn it is running is stopped.`);
  }
  removeAgent(t.id);
  return { deleted: true, name: t.name };
}

async function deleteResource(args: Args) {
  const o = resourceNamed(args.name);
  if (!confirmed(o.name, args.confirm)) {
    return notYet(o.name, `the ${o.kind} resource "${o.name}"${o.kind === 'server' ? ': it is stopped first' : o.kind === 'docker' ? ': its container is stopped, and removed if hive-am created it' : o.kind === 'database' ? ': the database itself is not touched, only hive-am forgets the connection, its saved queries and history' : ''}.`);
  }
  await removeObject(o.id);
  return { deleted: true, name: o.name };
}

// ---- the operations -------------------------------------------------------------------------------------------------------------------

async function options(args: Args) {
  const status = await providerStatus();
  const wanted = args.provider !== undefined ? (isProvider(args.provider) ? [args.provider] : (() => { throw bad(`Unknown provider "${text(args.provider)}"`); })()) : status.filter((p) => p.installed).map((p) => p.id);
  const providers = await Promise.all(status.map(async (p) => {
    if (!wanted.includes(p.id)) return { id: p.id, installed: p.installed, version: p.version };
    const model = args.provider === p.id ? text(args.model) : '';
    const efforts = effortOptions(p.id, model);
    return { id: p.id, installed: p.installed, version: p.version, models: (await listModels(p.id)).map((m) => m.id), efforts: efforts.options.map((v) => v.id), efforts_known: efforts.known };
  }));
  return {
    providers, roles: ['orchestrator', 'worker'], permissions: { plan: 'Read-only (Plan mode)', acceptEdits: 'Edit files', bypassPermissions: 'Full access' },
    inherit_fields: FIELDS, skill_loads: ['always', 'on_demand'], resource_kinds: ['server', 'docker', 'http', 'database', 'cluster'],
  };
}

export async function agentColonies(op: unknown, body: Args): Promise<unknown> {
  const a = whoAsks(body.from);
  const args: Args = { ...body }; delete args.from;
  switch (String(op ?? '')) {
    case 'options': return options(args);

    case 'list': return { colonies: colonies.list().map(colonyLine) };
    case 'get': return colonyOut(colonyNamed(args.name));
    case 'create': { writer(a); return { created: true, colony: colonyOut(createColony(colonyInput(args, false))) }; }
    case 'update': {
      writer(a);
      const c = colonyNamed(args.name), p = { ...args }; delete p.name;
      if (args.new_name !== undefined) { p.name = args.new_name; delete p.new_name; }
      return { updated: true, colony: colonyOut(keepingAccess(a, () => updateColony(c.id, colonyInput(p, true)))) };
    }
    case 'delete': { writer(a); return deleteColony(a, args); }

    case 'agent_list': {
      const col = args.colony === undefined ? undefined : colonyArg(args.colony);
      return { agents: agents.list().filter((x) => col === undefined || (x.colony_id ?? null) === col).map(agentLine) };
    }
    case 'agent_get': return agentOut(agentNamed(args.name));
    case 'agent_create': { writer(a); return { created: true, agent: agentOut(createAgent(agentInput(args))) }; }
    case 'agent_update': {
      writer(a);
      const t = agentNamed(args.name), p = { ...args }; delete p.name;
      if (args.new_name !== undefined) { p.name = args.new_name; delete p.new_name; }
      const input = agentInput(p, t);
      return { updated: true, agent: agentOut(keepingAccess(a, () => updateAgent(t.id, input))!) };
    }
    case 'agent_delete': { writer(a); return deleteAgent(a, args); }

    case 'skill_list': {
      const usage = skills.usage();
      return { skills: skills.list().map((s) => ({ name: s.name, description: s.description, load: s.load, agents: usage[s.id]?.agents ?? 0, types: usage[s.id]?.types ?? 0 })) };
    }

    case 'resource_list': {
      const col = args.colony === undefined ? undefined : colonyArg(args.colony);
      return { resources: listObjects().filter((o) => col === undefined || (o.colony_id ?? null) === col).map(resourceLine) };
    }
    case 'resource_get': { const o = resourceNamed(args.name); return { ...resourceLine(o), config: configOut(o) }; }
    case 'resource_create': {
      writer(a);
      const kind = kindOf(args.kind);
      if (!isKind(kind)) throw bad('kind must be server, docker, http, database or cluster');
      refuseSecrets(kind, args.config);
      const made = createObject({ name: args.name, kind, colony_id: args.colony === undefined ? null : colonyArg(args.colony), config: membersById(args.config) });
      return { created: true, resource: { ...resourceLine(made), config: configOut(made) } };
    }
    case 'resource_update': {
      writer(a);
      const o = resourceNamed(args.name);
      if (args.config !== undefined && !isRecord(args.config)) throw bad('config must be an object with the fields to change');
      refuseSecrets(o.kind, args.config);
      const p: { name?: unknown; colony_id?: unknown; config?: unknown } = {};
      if (args.new_name !== undefined) p.name = args.new_name;
      if (args.colony !== undefined) p.colony_id = colonyArg(args.colony);
      if (args.config !== undefined) {
        // Only the keys sent change. It starts from the masked config, so an empty password or secret is kept by the store as it does for the web
        // app; HTTP `variables` are merged by environment and name.
        const stored = objectsStore.get(o.id)!, base = { ...(maskConfig(stored).config as unknown as Record<string, unknown>) };
        delete base.passwordSet;
        const next: Record<string, unknown> = { ...base, ...(membersById(args.config) as Record<string, unknown>) };
        if (o.kind === 'http' && args.config.variables !== undefined) next.variables = mergeVariables(base.variables, args.config.variables);
        // `env` is replaced whole (its values are not shown): the keys to keep are sent as ***, which only stands for a key already saved.
        const savedEnv = (stored.config as { env?: Record<string, string> }).env ?? {};
        if (isRecord(next.env)) next.env = Object.fromEntries(Object.entries(next.env).map(([k, v]) => {
          if (v !== MASK) return [k, v];
          if (!(k in savedEnv)) throw bad(`env ${k} is not saved, so *** has nothing to keep: give it a value (or leave it out)`);
          return [k, savedEnv[k]];
        }));
        p.config = next;
      }
      const v = updateObject(o.id, p);
      return { updated: true, resource: { ...resourceLine(v), config: configOut(v) } };
    }
    case 'resource_delete': { writer(a); return deleteResource(args); }
    case 'resource_manager': {
      writer(a);
      const o = resourceNamed(args.name);
      const r = setObjectManager(o.id, isNone(args.agent) ? null : agentNamed(args.agent).id);
      if (r.skillAdded) notifyAgentsChanged();
      return { name: o.name, manager: r.object.manager_id ? agentName(r.object.manager_id) : null, skill_added: r.skillAdded };
    }
    default: throw bad(`Unknown operation "${text(op)}"`);
  }
}
