// The HTTP layer: error mapping, body limits, the local-only guard, unknown routes and route table sanity. No model.
// Usage: HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4410 npx tsx scripts/test-http-core.ts
import './_guard.js';
import { createServer, request, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { handle } from '../src/api.js';
import { JSON_LIMIT, UPLOAD_LIMIT, body } from '../src/http/body.js';
import { HttpError, bad, toHttpError } from '../src/http/errors.js';
import { isLocalRequest, requireLocal } from '../src/http/guards.js';
import { routes } from '../src/http/router.js';
import { ChannelError, SendError } from '../src/connections/manager.js';
import { CronError } from '../src/cron.js';
import { GitOpError } from '../src/git/ops.js';
import { PathError } from '../src/git/repo.js';
import { ObjectError } from '../src/objects/model.js';
import { NotebookError } from '../src/skills/notebook.js';
import { ScheduleError } from '../src/schedules.js';
import { TerminalError } from '../src/terminals.js';
import { WakeError } from '../src/wake.js';
import { WatchError } from '../src/watch.js';

let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); if (!ok) fail++; };
const fakeReq = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;
const refused = (f: () => void) => { try { f(); return 'allowed'; } catch (e) { return e instanceof HttpError ? e.status : 'other'; } };

// ---- error mapping ----
for (const [name, e] of Object.entries({ ChannelError: new ChannelError('x'), SendError: new SendError('x'), CronError: new CronError('x'), GitOpError: new GitOpError('x'), PathError: new PathError('x'), ObjectError: new ObjectError('x'), NotebookError: new NotebookError('x'), ScheduleError: new ScheduleError('x'), TerminalError: new TerminalError('x'), WakeError: new WakeError('x'), WatchError: new WatchError('x') })) {
  const h = toHttpError(e); eq(`${name} maps to 400 with its message`, [h?.status, h?.message], [400, 'x']);
}
eq('an HttpError keeps its status', toHttpError(new HttpError(403, 'no'))?.status, 403);
eq('an unknown error is not mapped (the caller answers 500)', toHttpError(new Error('boom')), null);
eq('a non-error is not mapped', toHttpError('text'), null);

// ---- local guard (unit) ----
eq('no origin (curl, MCP) passes', refused(() => requireLocal(fakeReq({ host: '127.0.0.1:4400' }), 'm')), 'allowed');
eq('a localhost page passes', refused(() => requireLocal(fakeReq({ host: '127.0.0.1:4400', origin: 'http://localhost:4401' }), 'm')), 'allowed');
eq('a [::1] page passes', refused(() => requireLocal(fakeReq({ host: '[::1]:4400', origin: 'http://[::1]:4401' }), 'm')), 'allowed');
eq('a foreign page is refused with 403', refused(() => requireLocal(fakeReq({ host: '127.0.0.1:4400', origin: 'https://evil.example' }), 'm')), 403);
eq('an invalid origin is refused', refused(() => requireLocal(fakeReq({ host: '127.0.0.1:4400', origin: 'not a url' }), 'm')), 403);
eq('the page served from the same host passes (lenient)', refused(() => requireLocal(fakeReq({ host: 'hive.lan:4400', origin: 'http://hive.lan:4401' }), 'm')), 'allowed');
eq('strict: a non-loopback Host is refused even with no origin', refused(() => requireLocal(fakeReq({ host: 'hive.lan:4400' }), 'm', { strict: true })), 403);
eq('strict: the same host is not enough', isLocalRequest(fakeReq({ host: 'hive.lan:4400', origin: 'http://hive.lan:4401' })), false);
eq('strict: loopback host and origin pass', isLocalRequest(fakeReq({ host: 'localhost:4400', origin: 'http://localhost:4401' })), true);
eq('the refusal carries the message given', (() => { try { requireLocal(fakeReq({ origin: 'https://evil.example' }), 'only here'); } catch (e) { return (e as Error).message; } })(), 'only here');

// ---- route table ----
const samples = routes.map((r) => ({ r, path: r.pattern.replace(/:[^/]+/g, 'x') }));
eq('no route is shadowed by an earlier one', samples.filter(({ r, path }) => routes.find((o) => o.method === r.method && o.re.test(path)) !== r).map((s) => `${s.r.method} ${s.r.pattern}`), []);
eq('there are no duplicate routes', routes.length, new Set(routes.map((r) => `${r.method} ${r.pattern}`)).size);

// ---- over HTTP ----
const port = Number(process.env.HIVE_AM_PORT ?? 4410);
const server = createServer((req, res) => { void handle(req, res); });
await new Promise<void>((done) => server.listen(port, '127.0.0.1', done));
const base = `http://127.0.0.1:${port}`;
const call = (method: string, path: string, payload?: string | Buffer, headers: Record<string, string> = {}) => new Promise<{ status: number; json: any; headers: Record<string, unknown> }>((resolve, reject) => {
  const data = payload === undefined ? undefined : Buffer.from(payload);
  const rq = request(base + path, { method, headers: { ...(data ? { 'content-type': 'application/json', 'content-length': String(data.length) } : {}), ...headers } }, (res) => {
    const chunks: Buffer[] = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => { const t = Buffer.concat(chunks).toString(); let json: any = null; try { json = JSON.parse(t); } catch { /* not json */ } resolve({ status: res.statusCode ?? 0, json, headers: res.headers }); });
  });
  rq.on('error', reject); if (data) rq.write(data); rq.end();
});

const nf = await call('GET', '/api/does-not-exist');
eq('an unknown route is 404 with a JSON error', [nf.status, nf.json], [404, { error: 'No such route' }]);
eq('a known path with another method is 404', (await call('DELETE', '/api/health')).status, 404);
eq('health answers', (await call('GET', '/api/health')).json, { ok: true });
eq('OPTIONS answers 204 with CORS headers', await call('OPTIONS', '/api/agents').then((r) => [r.status, r.headers['access-control-allow-origin']]), [204, '*']);
eq('a malformed %-escape is 400, not a crash', (await call('GET', '/api/agents/%E0%A4%A')).status, 400);
eq('a missing agent is 404', await call('GET', '/api/agents/nope').then((r) => [r.status, r.json]), [404, { error: 'Agent not found' }]);
eq('a domain error becomes 400 (WakeError)', await call('POST', '/api/wake', JSON.stringify({ from: 'nobody', minutes: 5 })).then((r) => r.status), 400);
eq('a domain error becomes 400 (NotebookError path: unknown agent)', await call('POST', '/api/notebook/read', JSON.stringify({ from: 'nobody' })).then((r) => [r.status, r.json]), [400, { error: 'Unknown agent' }]);

// body: validity and limits
eq('invalid JSON is 400', await call('POST', '/api/skills', '{nope').then((r) => [r.status, r.json]), [400, { error: 'Request body is not valid JSON' }]);
eq('a JSON array is 400', await call('POST', '/api/skills', '[1]').then((r) => r.status), 400);
eq('JSON null is 400', await call('POST', '/api/skills', 'null').then((r) => r.status), 400);
eq('an empty body is {} (name required)', await call('POST', '/api/skills').then((r) => [r.status, r.json]), [400, { error: 'Name is required' }]);
const okSkill = await call('POST', '/api/skills', JSON.stringify({ name: 'big-but-fine', content: 'x'.repeat(JSON_LIMIT - 1024) }));
eq('a body just under the limit is accepted', okSkill.status, 200);
const big = await call('POST', '/api/skills', JSON.stringify({ name: 'too-big', content: 'x'.repeat(JSON_LIMIT + 10) }));
eq('a body over the limit is 413', [big.status, big.headers.connection], [413, 'close']);
eq('the server still answers after a 413', (await call('GET', '/api/health')).status, 200);
eq('and nothing was created by it', (await call('GET', '/api/skills')).json.some((s: { name: string }) => s.name === 'too-big'), false);

// the upload limit is a separate, larger one
eq('uploads may be larger than plain JSON', UPLOAD_LIMIT > JSON_LIMIT * 10, true);
const probe = createServer((req, res) => { body(req, req.url === '/up' ? UPLOAD_LIMIT : 100).then((b) => { res.end(JSON.stringify({ ok: Object.keys(b).length })); }, (e) => { res.writeHead(e.status ?? 500); res.end(); }); });
await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
const pp = (probe.address() as AddressInfo).port;
const probeCall = (path: string, size: number) => new Promise<number>((resolve, reject) => { const d = Buffer.from(JSON.stringify({ a: 'x'.repeat(size) })); const r = request({ port: pp, host: '127.0.0.1', path, method: 'POST', headers: { 'content-length': String(d.length) } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); }); r.on('error', reject); r.end(d); });
eq('a small limit refuses 1 KB', await probeCall('/small', 1024), 413);
eq('the upload limit takes 3 MB', await probeCall('/up', 3 * 1024 * 1024), 200);
eq('without Content-Length (chunked) the limit still applies', await new Promise<number>((resolve, reject) => { const r = request({ port: pp, host: '127.0.0.1', path: '/small', method: 'POST', headers: { 'transfer-encoding': 'chunked' } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); }); r.on('error', reject); r.write('{"a":"' + 'x'.repeat(500)); r.end('"}'); }), 413);
probe.close();

// the local guard over HTTP: a foreign page cannot change resources, run git actions, edit a notebook or reach terminals
const evil = { origin: 'https://evil.example' };
eq('resources: a foreign origin is 403', await call('POST', '/api/objects', '{}', evil).then((r) => [r.status, r.json]), [403, { error: 'Resources can only be changed from the local app' }]);
eq('resources: no origin reaches the validation (ObjectError is 400)', await call('POST', '/api/objects', '{}').then((r) => r.status), 400);
eq('resources: a local page reaches it too', await call('POST', '/api/objects', '{}', { origin: 'http://localhost:4401' }).then((r) => r.status), 400);
eq('database resources: GET with a foreign origin is 403', await call('GET', '/api/objects/x/db/schema', undefined, evil).then((r) => r.status), 403);
eq('git actions: a foreign origin is 403', await call('POST', '/api/agents/nope/git/fetch', '{}', evil).then((r) => [r.status, r.json]), [403, { error: 'Git actions are only allowed from the local app' }]);
eq('git actions: no origin reaches the agent lookup (404)', await call('POST', '/api/agents/nope/git/fetch', '{}').then((r) => r.status), 404);
eq('notebook edit: a foreign origin is 403', await call('PUT', '/api/agents/nope/notebook', '{}', evil).then((r) => r.status), 403);
eq('terminals: a foreign origin is 403', await call('GET', '/api/terminals', undefined, evil).then((r) => r.status), 403);
eq('terminals: a foreign Host is 403', await call('GET', '/api/terminals', undefined, { host: 'rebind.example' }).then((r) => r.status), 403);
eq('terminals: this machine is fine', await call('GET', '/api/terminals').then((r) => [r.status, typeof r.json.enabled]), [200, 'boolean']);
eq('reads stay open to any origin (CORS *)', await call('GET', '/api/health', undefined, evil).then((r) => r.status), 200);

server.close();
console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
process.exit(fail ? 1 : 0);
