import { notifyAgentsChanged } from '../../runtime.js';
import { DRIVER_PROPS } from '../../objects/driver-props.js';
import { composeServices, inspectMachine, listContainers, listImages, listNetworks, listVolumes } from '../../objects/docker-info.js';
import { agentObjectAction, agentObjectLogs, agentObjects } from '../../objects/agent.js';
import { agentDb } from '../../objects/agent-db.js';
import { dbColumnsOf, dbHistory, dbHistoryClear, dbRun, dbSavedAdd, dbSavedList, dbSavedRemove, dbSavedUpdate, dbSchemaOf, dbTestConfig, createObject, statsOf, httpDescribe, httpSession, httpSessionClear, httpSessionSet, httpInspect, httpExport, httpFileRead, httpFileWrite, httpFileCreate, httpRun, httpHistory, httpDocs, httpHistoryClear, httpScan, listObjects, setObjectManager, setAgentObjects, objectAction, objectServiceAction, listTemplates, createFromTemplate, objectInspect, objectInspectRaw, objectLogs, removeObject, updateObject } from '../../objects/index.js';
import { body, type Body } from '../body.js';
import { notFound } from '../errors.js';
import { requireLocal } from '../guards.js';
import { route, type Ctx } from '../router.js';
import { text } from '../validate.js';

// ObjectError becomes a 400 in http/errors.ts. "Object" is the old name of "resource": the paths keep it.
const p = (url: URL, key: string) => url.searchParams.get(key) ?? undefined;
/** Resources run commands and open connections with saved passwords, so, like the git actions, they only accept requests from the local app. */
const local = (req: Ctx['req']) => requireLocal(req, 'Resources can only be changed from the local app');
/** A route that changes things: local app only, with the JSON body already read. */
const write = (method: string, path: string, fn: (b: Body, ctx: Ctx) => unknown) =>
  route(method, path, async (ctx) => { local(ctx.req); return fn(await body(ctx.req), ctx); });
/** A route that answers from a resource but is still local only (it reaches a database with its saved password). */
const guarded = (path: string, fn: (ctx: Ctx) => unknown, method = 'GET') => route(method, path, (ctx) => { local(ctx.req); return fn(ctx); });

// The agents' side (tools `object_list`, `object_action`, `object_logs`): `from` is the agent; scope and permission are checked in objects/agent.ts.
route('POST', '/api/agent-objects/list', async ({ req }) => { const b = await body(req); return { objects: agentObjects(b.from) }; });
route('POST', '/api/agent-objects/action', async ({ req }) => { const b = await body(req); return agentObjectAction(b.from, b.name, b.action); });
route('POST', '/api/agent-objects/logs', async ({ req }) => { const b = await body(req); return agentObjectLogs(b.from, b.name, b.tail); });
// The tools `object_db_*` of the "Database management" skill: one route, the operation in the path; scope and permission are checked in objects/agent-db.ts.
route('POST', '/api/agent-objects/db/:op', async ({ req, params }) => agentDb(params[0], await body(req)));
route('GET', '/api/objects', () => listObjects());
write('POST', '/api/objects', (b) => createObject(b as Parameters<typeof createObject>[0]));
write('PATCH', '/api/objects/:id', (b, { params }) => updateObject(params[0], b as Parameters<typeof updateObject>[1]));
route('DELETE', '/api/objects/:id', async ({ req, params }) => { local(req); if (!(await removeObject(params[0]))) throw notFound('Object not found'); return { ok: true }; });
route('GET', '/api/object-templates', () => listTemplates());
write('PUT', '/api/objects/:id/manager', (b, { params }) => { const r = setObjectManager(params[0], b.agent_id); if (r.skillAdded) notifyAgentsChanged(); return r; });
write('PUT', '/api/agents/:id/resources', (b, { params }) => { const r = setAgentObjects(params[0], b.object_ids); if (r.skillAdded) notifyAgentsChanged(); return r; });
write('POST', '/api/objects/from-template', (b) => createFromTemplate(b as Parameters<typeof createFromTemplate>[0]));
// Reads, open like the other reads of resources (the app is also reached by other names on the network). Secret-looking variables and the
// passwords of URLs come hidden in the raw one unless `reveal=1`.
route('GET', '/api/objects/:id/inspect', ({ params, url }) => objectInspect(params[0], p(url, 'service')));
route('GET', '/api/objects/:id/inspect/raw', ({ params, url }) => objectInspectRaw(params[0], p(url, 'service'), url.searchParams.get('reveal') === '1'));
// The whole `docker inspect` of anything on this machine (container, image, volume, network).
route('GET', '/api/docker/inspect', ({ url }) => inspectMachine(url.searchParams.get('kind') ?? '', url.searchParams.get('ref') ?? '', url.searchParams.get('reveal') === '1'));
write('POST', '/api/objects/:id/service', (b, { params }) => objectServiceAction(params[0], b.service, b.action));
write('POST', '/api/objects/:id/action', (b, { params }) => objectAction(params[0], b.action));
// What Docker knows, to suggest in the forms (containers, images, volumes, networks, the services of a compose file).
route('GET', '/api/docker/containers', () => listContainers());
route('GET', '/api/docker/images', () => listImages());
route('GET', '/api/docker/volumes', () => listVolumes());
route('GET', '/api/docker/networks', () => listNetworks());
route('GET', '/api/docker/compose-services', ({ url }) => composeServices(url.searchParams.get('file') ?? ''));
route('GET', '/api/objects/:id/stats', ({ params }) => statsOf(params[0]));
route('GET', '/api/objects/:id/http', ({ params }) => httpScan(params[0]));
route('GET', '/api/objects/:id/http/export', ({ params, url }) => httpExport(params[0], url.searchParams.get('file') ?? '', Number(url.searchParams.get('index')), (url.searchParams.get('format') ?? 'curl') as never, p(url, 'env'), url.searchParams.get('redact') === '1'));
route('GET', '/api/objects/:id/http/variables', ({ params, url }) => httpInspect(params[0], p(url, 'file'), url.searchParams.has('index') ? Number(url.searchParams.get('index')) : undefined, p(url, 'env')));
route('GET', '/api/objects/:id/http/file', ({ params, url }) => httpFileRead(params[0], url.searchParams.get('file') ?? ''));
write('POST', '/api/objects/:id/http/file', (b, { params }) => httpFileCreate(params[0], text(b.file), text(b.content)));
write('PUT', '/api/objects/:id/http/file', (b, { params }) => httpFileWrite(params[0], text(b.file), text(b.content)));
route('GET', '/api/objects/:id/http/session', ({ params }) => httpSession(params[0]));
write('POST', '/api/objects/:id/http/session', (b, { params }) => httpSessionSet(params[0], text(b.name), text(b.value)));
guarded('/api/objects/:id/http/session', ({ params, url }) => httpSessionClear(params[0], p(url, 'name')), 'DELETE');
route('GET', '/api/objects/:id/http/describe', ({ params, url }) => httpDescribe(params[0], url.searchParams.get('file') ?? '', Number(url.searchParams.get('index') ?? 0), p(url, 'env')));
route('GET', '/api/objects/:id/http/docs', ({ params, url }) => httpDocs(params[0], url.searchParams.get('format') === 'postman' ? 'postman' : 'markdown', p(url, 'file')));
route('GET', '/api/objects/:id/http/history', ({ params }) => httpHistory(params[0]));
guarded('/api/objects/:id/http/history', ({ params }) => httpHistoryClear(params[0]), 'DELETE');
write('POST', '/api/objects/:id/http/run', (b, { params }) => httpRun(params[0], text(b.file), Number(b.index ?? 0), b.env ? String(b.env) : undefined));
// ---- database resources (a connection opens per request; local app only, because it uses the saved password) ----
route('GET', '/api/object-db/props', () => DRIVER_PROPS);
write('POST', '/api/object-db/test', (b) => dbTestConfig(b));
guarded('/api/objects/:id/db/schema', ({ params, url }) => dbSchemaOf(params[0], p(url, 'database')));
guarded('/api/objects/:id/db/columns', ({ params, url }) => dbColumnsOf(params[0], { database: p(url, 'database'), schema: url.searchParams.get('schema') ?? '', table: url.searchParams.get('table') ?? '' }));
write('POST', '/api/objects/:id/db/query', (b, { params }) => dbRun(params[0], { sql: text(b.sql), database: b.database ? String(b.database) : undefined }));
guarded('/api/objects/:id/db/history', ({ params }) => dbHistory(params[0]));
guarded('/api/objects/:id/db/history', ({ params }) => dbHistoryClear(params[0]), 'DELETE');
guarded('/api/objects/:id/db/saved', ({ params }) => dbSavedList(params[0]));
write('POST', '/api/objects/:id/db/saved', (b, { params }) => dbSavedAdd(params[0], b));
write('PATCH', '/api/objects/:id/db/saved/:sid', (b, { params }) => dbSavedUpdate(params[0], params[1], b));
guarded('/api/objects/:id/db/saved/:sid', ({ params }) => dbSavedRemove(params[0], params[1]), 'DELETE');
route('GET', '/api/objects/:id/logs', ({ params, url }) => objectLogs(params[0], { tail: url.searchParams.get('tail') ? Number(url.searchParams.get('tail')) : undefined, after: p(url, 'after') }));
