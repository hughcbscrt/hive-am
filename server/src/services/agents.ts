import { agents, db, resolved } from '../db.js';
import { channelPermissionError } from '../connections/rules.js';
import { liveTurn, notifyAgentsChanged, stopAgent } from '../runtime.js';
import { findRepo } from '../git/repo.js';
import type { Agent, AgentType } from '../types.js';
import { bad, notFound } from '../http/errors.js';
import { trimmed, type AgentInput } from '../http/validate.js';

type NewAgent = Parameters<typeof agents.create>[0];
const NO_FOLDER = 'Choose a working folder, or put the agent in a colony that provides one.';

export const agentOrFail = (id: string): Agent => agents.get(id) ?? (() => { throw notFound('Agent not found'); })();
/** The folder the agent really works in (its own, or its colony's when it inherits). */
export const agentCwd = (id: string): string => resolved(agentOrFail(id)).cwd;

const uniqueName = (name: string, exceptId?: string) => { const o = agents.byName(name); if (o && o.id !== exceptId) throw bad(`An agent named "${name}" already exists`); };

/** Creates an agent. With no folder of its own and none inherited it could never run, so it is removed again. */
function create(p: NewAgent): Agent {
  const a = agents.create(p);
  if (!a.effective.cwd) { agents.remove(a.id); throw bad(NO_FOLDER); }
  notifyAgentsChanged();
  return a;
}
export function createAgent(p: AgentInput): Agent {
  const name = trimmed(p.name);
  uniqueName(name);
  return create({ ...p, name, cwd: p.cwd ?? '' } as NewAgent);
}
/** A new agent that starts from a type: the type lends everything but name, description, folder and colony. */
export function spawnFromType(t: AgentType, p: AgentInput & { description?: string }): Agent {
  const name = trimmed(p.name);
  uniqueName(name);
  return create({
    name, description: p.description ?? t.description, role: t.role, type_id: t.id, provider: t.provider, model: t.model,
    system_prompt: t.system_prompt, permission: t.permission, cwd: p.cwd ?? '', skill_ids: t.skill_ids, skill_loads: t.skill_loads, colony_id: p.colony_id ?? null,
  });
}

export function updateAgent(id: string, p: AgentInput): Agent | undefined {
  const cur = agentOrFail(id);
  if (p.name && p.name.toLowerCase() !== cur.name.toLowerCase()) uniqueName(p.name, id);
  // Changing provider invalidates the native session pointer. (A changed folder is detected when the next turn starts.)
  // All-or-nothing: a change that would leave a linked agent in Plan mode is rolled back.
  const a = db.transaction(() => {
    const u = agents.update(id, p)!;
    const why = channelPermissionError(u.id); if (why) throw bad(why);
    return u;
  })();
  if (p.provider && p.provider !== cur.provider) agents.setSession(a, null);
  if (!agents.get(a.id)!.effective.cwd) throw bad('Choose a working folder, or keep inheriting the colony’s folder.');
  notifyAgentsChanged();
  return agents.get(id);
}

export function removeAgent(id: string): void {
  stopAgent(id);
  if (!agents.remove(id)) throw notFound('Agent not found');
  notifyAgentsChanged();
}

/** The session to read: the requested one must belong to the agent (its own or a delegated one). */
export function sessionToRead(a: Agent, requested: string | null): string | null {
  const sid = requested ?? a.session_id;
  if (sid && sid !== a.session_id && !agents.sessions(a.id).some((s) => s.session_id === sid)) throw bad('That session does not belong to this agent');
  return sid;
}

/** Only the agent's own conversations can be made current; delegated ones are read-only. */
export function resumeSession(a: Agent, sessionId: unknown): void {
  if (!agents.sessions(a.id).some((s) => s.session_id === sessionId && s.kind !== 'delegation')) throw bad('Only the agent’s own conversations can be made current. Delegated sessions are read-only.');
  agents.setSession(a, sessionId as string); notifyAgentsChanged();
}

/** Which other agents are working in the same repository right now (a branch switch moves their files too). */
export async function othersInRepo(agentId: string, cwd: string): Promise<{ id: string; name: string }[]> {
  const others: { id: string; name: string }[] = [];
  const here = await findRepo(cwd);
  if (here.ok) for (const a of agents.list()) {
    if (a.id === agentId || !(a.status === 'running' || liveTurn(a.id))) continue;
    const there = await findRepo(resolved(a).cwd);
    if (there.ok && there.repo.root === here.repo.root) others.push({ id: a.id, name: a.name });
  }
  return others;
}
