import { connections, threads } from '../../connections/store.js';
import { publicConnection } from '../../connections/public.js';
import { testConnection } from '../../connections/manager.js';
import { createConnection, removeConnection, restartConnection, updateConnection } from '../../services/connections.js';
import { body } from '../body.js';
import { bad, notFound } from '../errors.js';
import { route } from '../router.js';

route('GET', '/api/connections', () => connections.list().map(publicConnection));
route('POST', '/api/connections', async ({ req }) => createConnection(await body(req)));
route('PATCH', '/api/connections/:id', async ({ req, params }) => updateConnection(params[0], await body(req)));
route('DELETE', '/api/connections/:id', async ({ params }) => { await removeConnection(params[0]); return { ok: true }; });
route('POST', '/api/connections/:id/restart', ({ params }) => restartConnection(params[0]));
route('POST', '/api/connections/:id/test', async ({ params }) => {
  if (!connections.get(params[0])) throw notFound('Connection not found');
  try { return { ok: true, detail: await testConnection(params[0]) }; } catch (e) { throw bad(e instanceof Error ? e.message : String(e)); }
});
route('PATCH', '/api/connections/:id/threads/:threadId', async ({ req, params }) => {
  const th = threads.get(params[1]);
  if (!th || th.connection_id !== params[0]) throw notFound('Thread not found');
  const p = await body(req);
  if (typeof p.muted === 'boolean') threads.setMuted(th.id, p.muted);
  return threads.get(th.id);
});
route('GET', '/api/connections/:id/threads', ({ params }) => {
  if (!connections.get(params[0])) throw notFound('Connection not found');
  return threads.forConnection(params[0]);
});
