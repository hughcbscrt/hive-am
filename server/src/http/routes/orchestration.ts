import { agents, dispatches } from '../../db.js';
import { cancelTask, openTasks, startTask, taskStatus } from '../../dispatches.js';
import { dispatch, liveTurn, notifyAgentsChanged } from '../../runtime.js';
import { agentOrFail } from '../../services/agents.js';
import { body } from '../body.js';
import { bad } from '../errors.js';
import { route } from '../router.js';
import { strList, text } from '../validate.js';

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
// `background: true` returns at once and the orchestrator is told the result later; `poll: true` returns at once too, for a caller that waits
// with /api/dispatch/status (the synchronous `dispatch` tool). With neither, the request is held until the worker answers, as it always was.
route('POST', '/api/dispatch', async ({ req }) => {
  const { from, agent, task, background, poll } = await body(req);
  if (!from || !agent || !task) throw bad('from, agent and task are required');
  if (background === true || poll === true) return startTask(text(from), text(agent), text(task), background === true);
  try { return await dispatch(from as string, agent as string, task as string); } catch (e) { throw bad(e instanceof Error ? e.message : String(e)); }
});
route('POST', '/api/dispatch/status', async ({ req }) => {
  const { from, id, wait_seconds } = await body(req);
  if (!from) throw bad('from is required');
  return taskStatus(text(from), text(id), wait_seconds);
});
// Cancelling answers the final state: `cancelled`, or the one the task already had (it is not an error).
route('POST', '/api/dispatch/cancel', async ({ req }) => {
  const { from, id } = await body(req);
  if (!from) throw bad('from is required');
  return cancelTask(text(from), text(id));
});
route('POST', '/api/dispatch/list', async ({ req }) => {
  const { from } = await body(req);
  if (!from) throw bad('from is required');
  return openTasks(text(from));
});
route('GET', '/api/dispatches', () => dispatches.recent());
// From the web: the person can cancel any task, as they can stop any agent.
route('POST', '/api/dispatches/:id/cancel', ({ params }) => cancelTask(null, params[0]));
