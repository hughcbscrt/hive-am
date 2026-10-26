import { agentColonies } from '../../services/colony-admin.js';
import { body } from '../body.js';
import { route } from '../router.js';

// The tools `colony_*` of the "Colony builder" skill: one route, the operation in the path; `from` is the agent, and the skill, the
// read-only rule, the secrets and the guards that keep it from cutting off its own access are checked in services/colony-admin.ts.
route('POST', '/api/agent-colonies/:op', async ({ req, params }) => agentColonies(params[0], await body(req)));
