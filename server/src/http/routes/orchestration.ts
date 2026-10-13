import { agents, dispatches } from '../../db.js';
import { dispatch, liveTurn, notifyAgentsChanged } from '../../runtime.js';
import { agentOrFail } from '../../services/agents.js';
import { body } from '../body.js';
import { bad } from '../errors.js';
import { route } from '../router.js';
import { strList } from '../validate.js';

route('GET', '/api/orchestrators/:id/workers', ({ params }) => {
  const o = agentOrFail(params[0]);
  return o.worker_ids.map((id) => agents.get(id)).filter((w): w is NonNullable<typeof w> => !!w).map((w) => ({ name: w.name, role: w.role, description: w.description, provider: w.provider, busy: !!liveTurn(w.id) }));
});
route('PUT', '/api/orchestrators/:id/workers', async ({ req, params }) => {
  const o = agentOrFail(params[0]);
  if (o.role !== 'orchestrator') throw bad('Only orchestrators can have subagents');
  const { worker_ids } = await body(req);
  agents.setWorkers(o.id, worker_ids === undefined || worker_ids === null ? [] : strList(worker_ids)); notifyAgentsChanged();
  return agents.get(o.id);
});
route('POST', '/api/dispatch', async ({ req }) => {
  const { from, agent, task } = await body(req);
  if (!from || !agent || !task) throw bad('from, agent and task are required');
  try { return await dispatch(from as string, agent as string, task as string); } catch (e) { throw bad(e instanceof Error ? e.message : String(e)); }
});
route('GET', '/api/dispatches', () => dispatches.recent());
