import { agents } from '../db.js';
import { mcpCaps } from '../instructions.js';
import { objectAction, objectLogs, listObjects } from './index.js';
import { ObjectError, type ObjectView } from './model.js';
import { noteServer } from './runner.js';

/**
 * What an agent with the "Colony objects" skill can do with objects: see them, read their logs and start / stop / restart them. Never
 * create, change or delete. The rules are enforced here, not just written in the skill:
 *  - only the objects of the agent's own colony (or the ones with no colony, for an agent with none);
 *  - a read-only agent can look but not act;
 *  - an unknown or foreign object looks the same as one that does not exist.
 */
function whoAsks(from: unknown) {
  const a = typeof from === 'string' ? agents.get(from) : undefined;
  if (!a) throw new ObjectError('Unknown agent');
  if (!mcpCaps(a).includes('objects')) throw new ObjectError('You do not have the "Colony objects" skill.');
  return a;
}
const visibleTo = (colonyId: string | null) => (o: ObjectView) => (o.colony_id ?? null) === (colonyId ?? null);

export function agentObjects(from: unknown) {
  const a = whoAsks(from);
  return listObjects().filter(visibleTo(a.colony_id)).map((o) => ({ name: o.name, kind: o.kind, status: o.state.status, detail: o.state.detail ?? null, since: o.state.since ?? null }));
}

function pick(from: unknown, name: unknown) {
  const a = whoAsks(from);
  const o = listObjects().filter(visibleTo(a.colony_id)).find((x) => x.name.toLowerCase() === String(name ?? '').trim().toLowerCase());
  if (!o) throw new ObjectError(`There is no object named "${String(name ?? '')}" in your colony. Call object_list for the names.`);
  return { a, o };
}

export async function agentObjectAction(from: unknown, name: unknown, action: unknown) {
  const { a, o } = pick(from, name);
  if (action !== 'start' && action !== 'stop' && action !== 'restart') throw new ObjectError('The action must be start, stop or restart');
  if (a.permission === 'plan') throw new ObjectError('You are read-only: you can look at objects but not start, stop or restart them.');
  if (o.kind === 'server') noteServer(o.id, `${a.name} asked to ${action}`);
  const v = await objectAction(o.id, action);
  return { name: v.name, status: v.state.status, detail: v.state.detail ?? null };
}

export async function agentObjectLogs(from: unknown, name: unknown, tail: unknown) {
  const { o } = pick(from, name);
  const n = Number(tail);
  return { name: o.name, text: (await objectLogs(o.id, { tail: Number.isFinite(n) && n > 0 ? Math.min(n, 500) : 80 })).text };
}
