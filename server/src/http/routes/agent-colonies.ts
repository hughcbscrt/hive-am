import { agentColonies } from '../../services/colony-admin.js';
import { body } from '../body.js';
import { requireLocal } from '../guards.js';
import { route } from '../router.js';

// The tools `colony_*` of the "Colony builder" skill: one route, the operation in the path; `from` is the agent, and the skill, the
// secrets and the guards that keep it from cutting off its own access are checked in services/colony-admin.ts. They create
// servers with their commands and agents with Full access, so, like the writes of resources, a page of another origin is refused (the MCP sends none).
route('POST', '/api/agent-colonies/:op', async ({ req, params }) => {
  requireLocal(req, 'Colonies can only be changed from the local app');
  return agentColonies(params[0], await body(req));
});
