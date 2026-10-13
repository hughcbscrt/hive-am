import { colonies, db } from '../db.js';
import { channelPermissionError } from '../connections/rules.js';
import { notifyAgentsChanged } from '../runtime.js';
import type { Colony } from '../types.js';
import { bad, notFound } from '../http/errors.js';
import { trimmed, type ColonyInput } from '../http/validate.js';

const sameName = (name: string, exceptId?: string) => colonies.list().some((c) => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase());

export function createColony(p: ColonyInput): Colony {
  const name = trimmed(p.name);
  if (sameName(name)) throw bad(`A colony named "${p.name}" already exists`);
  const c = colonies.create({ ...p, name });
  notifyAgentsChanged();
  return c;
}

export function updateColony(id: string, p: ColonyInput): Colony {
  const cur = colonies.get(id); if (!cur) throw notFound('Colony not found');
  if (p.name && p.name.toLowerCase() !== cur.name.toLowerCase() && sameName(trimmed(p.name))) throw bad(`A colony named "${p.name}" already exists`);
  // A colony can lend Plan mode to an agent that has a channel: all-or-nothing.
  const c = db.transaction(() => {
    const u = colonies.update(id, p.name ? { ...p, name: trimmed(p.name) } : p)!;
    for (const aid of u.agent_ids) { const why = channelPermissionError(aid); if (why) throw bad(why); }
    return u;
  })();
  notifyAgentsChanged();
  return c;
}

export function removeColony(id: string): void {
  if (!colonies.remove(id)) throw notFound('Colony not found');
  notifyAgentsChanged();
}
