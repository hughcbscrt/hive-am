import { agents } from '../db.js';
import { connections } from './store.js';

/** Plan mode is read-only and blocks the reply tool, so an agent with a live connection needs at least "edit files". */
export function channelPermissionError(agentId: string): string | null {
  const a = agents.get(agentId);
  if (!a || connections.forAgent(a.id).length === 0) return null;
  return a.effective.permission === 'plan'
    ? `"${a.name}" is linked to an external connection, so it needs at least "Edit files" permission: in Plan mode it cannot reply.`
    : null;
}
