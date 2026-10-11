// HTTP-requests objects and cluster objects, without a model: the .http format (names, variables, environments, private env, file variables,
// dynamic values, body from a file, response handlers), running a request against a local server, what is refused (a path outside the folder,
// a missing variable, a bad URL), and clusters (grouping, start order, stop order, state, logs with the member's name, rules). Usage:
//   HIVE_AM_OBJECT_POLL_MS=60000 HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-object-kinds.ts
import './_guard.js';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { colonies } from '../src/db.js';
import { ObjectError, createObject, objectServiceAction, httpDocs, httpExport, httpHistory, httpHistoryClear, httpFileCreate, httpDescribe, httpFileRead, httpFileWrite, httpInspect, httpRun as runForObject, httpScan, httpSession, httpSessionClear, httpSessionSet, objectAction, objectLogs, refreshStates, removeObject, stateOf, updateObject, viewOf } from '../src/objects/index.js';
import { parseHttpFile, runHttp as httpRun } from '../src/objects/http.js';
import { objectsStore } from '../src/objects/store.js';

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const rejects = async (fn: () => unknown, re: RegExp) => { try { await fn(); return false; } catch (e) { return e instanceof ObjectError && re.test(e.message); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => Promise<boolean> | boolean, ms = 12000) => { for (let t = 0; t < ms; t += 150) { if (await cond()) return true; await sleep(150); } return false; };

// ---------------------------------------------------------------- a server to ask things of
const seen: { method: string; url: string; headers: Record<string, unknown>; body: string }[] = [];
const target = createServer((req, res) => {
  let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
    seen.push({ method: req.method!, url: req.url!, headers: req.headers, body: b });
    if (req.url === '/login') { res.setHeader('content-type', 'application/json'); res.setHeader('x-session', 'sess-42'); return void res.end(JSON.stringify({ token: 'tok-' + Date.now().toString(36), id: 17, user: 'ana', roles: ['admin'] })); }
    if (req.url === '/me') { const a = String(req.headers.authorization ?? ''); res.setHeader('content-type', 'application/json'); res.statusCode = a.startsWith('Bearer tok-') ? 200 : 401; return void res.end(JSON.stringify({ user: a.startsWith('Bearer tok-') ? 'ana' : null, auth: a })); }
    if (req.url === '/slow') return void setTimeout(() => res.end('late'), 2000);
    if (req.url === '/bin') { res.setHeader('content-type', 'image/png'); return void res.end(Buffer.from([137, 80, 78, 71, 0, 1, 2])); }
    res.setHeader('content-type', 'application/json'); res.setHeader('x-hello', 'world'); res.statusCode = req.url === '/missing' ? 404 : 200;
    res.end(JSON.stringify({ ok: true, echo: b ? JSON.parse(b) : null }));
  });
});
await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
const port = (target.address() as any).port;

const dir = mkdtempSync(join(tmpdir(), 'http-'));
mkdirSync(join(dir, 'sub'));
writeFileSync(join(dir, 'http-client.env.json'), JSON.stringify({ $shared: { greeting: 'hi' }, dev: { host: `http://127.0.0.1:${port}`, token: 'public-token' }, prod: { host: `http://127.0.0.1:${port}/prod` } }));
writeFileSync(join(dir, 'http-client.private.env.json'), JSON.stringify({ dev: { token: 'SECRET-TOKEN-123456' } }));
writeFileSync(join(dir, 'payload.json'), '{"from":"file"}');
writeFileSync(join(dir, 'api.http'), `@version = v2
# comment
### List things
GET {{host}}/things/{{version}}?a=1
    &b=2
Accept: application/json

### Create a thing
# @name create
POST {{host}}/things HTTP/1.1
Content-Type: application/json
Authorization: Bearer {{token}}

{"name": "{{greeting}} world", "id": "{{$uuid}}"}

> {% client.global.set("x", response.body.id); %}

###
POST {{host}}/from-file
Content-Type: application/json

< ./payload.json

### Missing one
GET {{host}}/x/{{nope}}

### Not found
GET {{host}}/missing

### Relative
GET /nothing

### Binary
GET {{host}}/bin
`);
writeFileSync(join(dir, 'sub', 'more.rest'), `GET {{host}}/in-sub\n`);

// ---------------------------------------------------------------- the format
const parsed = parseHttpFile(readFileSync(join(dir, 'api.http'), 'utf8'), 'api.http');
check(parsed.requests.length === 7, 'every request of the file is found (7)');
check(parsed.fileVariables.version === 'v2', 'a file variable (@name = value) is read');
check(parsed.requests[0].name === 'List things', 'the text after ### is the name');
check(parsed.requests[0].url === '{{host}}/things/{{version}}?a=1&b=2', 'indented ?/& lines continue the URL');
check(parsed.requests[1].name === 'create' && parsed.requests[1].method === 'POST', '# @name names a request');
check(parsed.requests[1].headers.length === 2 && parsed.requests[1].headers[1].name === 'Authorization', 'headers are read');
check(!parsed.requests[1].body!.includes('client.global') && parsed.requests[1].body!.startsWith('{"name"'), 'response handlers are not part of the body');
check(parsed.requests[1].variables.includes('token') && parsed.requests[1].variables.includes('$uuid'), 'the variables of a request are listed');
check(parsed.requests[2].name === 'POST /from-file', 'an unnamed request is named after its method and path');

const web = createObject({ name: 'api-requests', kind: 'http', config: { folder: dir, env: 'dev' } });
const scan = httpScan(web.id);
check(scan.files.length === 2 && scan.files.map((f) => f.relFile).sort().join() === 'api.http,sub/more.rest', 'the scan finds .http and .rest files in sub-folders');
check(scan.used.map((u) => u.name).includes('token') && scan.used.map((u) => u.name).includes('host') && !scan.used.some((u) => u.name.startsWith('$')), 'the scan lists the variables the requests use (not the generated ones)');
check(scan.used.find((u) => u.name === 'host')!.count >= 6 && scan.fileDefined.join() === 'version', 'with how many requests use each, and the ones a file defines itself');
check(scan.environments.join() === 'dev,prod', 'the environments come from the env files ($shared is not one)');
check((await stateOf(objectsStore.get(web.id)!)).status === 'ready' && /8 requests/.test((await stateOf(objectsStore.get(web.id)!)).detail ?? ''), 'the object is "ready" and says how many requests it has');

// ---------------------------------------------------------------- running
const list = await httpRun(dir, 'api.http', 0, 'dev');
check(list.status === 200 && seen.at(-1)!.url === '/things/v2?a=1&b=2', 'a request runs with its variables filled in');
check(JSON.parse(list.body).ok === true && list.headers.some((h) => h.name === 'x-hello') && list.durationMs >= 0 && list.size > 0, 'the answer has status, headers, body, size and time');

const create = await httpRun(dir, 'api.http', 1, 'dev');
const sent = seen.at(-1)!;
check(sent.method === 'POST' && sent.headers.authorization === 'Bearer SECRET-TOKEN-123456', 'the private env file overrides the public one');
check(JSON.parse(sent.body).name === 'hi world' && /^[0-9a-f-]{36}$/.test(JSON.parse(sent.body).id), '$shared values and {{$uuid}} are filled in');
check(!JSON.stringify(create.request.headers).includes('SECRET-TOKEN') && create.request.headers.find((h) => h.name === 'Authorization')!.value.includes('••••'), 'the echoed request hides credentials');

await httpRun(dir, 'api.http', 2, 'dev');
check(JSON.parse(seen.at(-1)!.body).from === 'file', 'a body can come from a file next to the .http file');
const sub = await httpRun(dir, 'sub/more.rest', 0, 'dev');
check(sub.status === 200 && seen.at(-1)!.url === '/in-sub', 'files in sub-folders use the env files above them');
check((await httpRun(dir, 'api.http', 4, 'dev')).status === 404, 'an error status is an answer, not a failure');
const bin = await httpRun(dir, 'api.http', 6, 'dev');
check(bin.binary && bin.body === '' && bin.size === 7, 'a binary answer is reported, not printed');
const prod = await httpRun(dir, 'api.http', 0, 'prod');
check(seen.at(-1)!.url === '/prod/things/v2?a=1&b=2', 'another environment changes the host');

check(await rejects(() => httpRun(dir, 'api.http', 3, 'dev'), /\{\{nope\}\}/), 'a variable with no value is named and nothing is sent');
check(await rejects(() => httpRun(dir, 'api.http', 5, 'dev'), /full URL/), 'a URL without a host is refused');
check(await rejects(() => httpRun(dir, 'api.http', 0, 'staging'), /not in the env files/), 'an unknown environment is refused');
check(await rejects(() => httpRun(dir, '../etc/passwd', 0), /outside the folder/), 'a path outside the folder is refused');
check(await rejects(() => httpRun(dir, 'payload.json', 0), /not a .http file/), 'only .http / .rest files are read');
check(await rejects(() => httpRun(dir, 'api.http', 99, 'dev'), /not in/), 'a request number that does not exist is refused');
check(await rejects(() => httpRun('relative/folder', 'api.http', 0), /absolute/), 'a relative folder is refused');
const d = httpDescribe(web.id, 'api.http', 3, 'dev');
check(d.missing.join() === 'nope' && d.environments.join() === 'dev,prod', 'describing a request says which values are missing');
check(httpDescribe(web.id, 'api.http', 3).missing.join() === 'nope', 'and the default environment of the object is used when none is given');
check(await rejects(() => objectAction(web.id, 'start'), /not started or stopped/), 'an HTTP object cannot be started');
check((await objectLogs(web.id, {})).text === '', 'and has no logs');
check(await rejects(() => createObject({ name: 'bad-http', kind: 'http', config: { folder: 'x' } }), /absolute/), 'its folder must be absolute');
check((await stateOf(createObject({ name: 'gone-http', kind: 'http', config: { folder: join(dir, 'nope') } }))).status === 'error', 'a folder that is not there makes it an error');

// ---------------------------------------------------------------- chains: handlers keep values for the next request
const chain = mkdtempSync(join(tmpdir(), 'http-chain-'));
writeFileSync(join(chain, 'flow.http'), `@host = http://127.0.0.1:${port}
@token = from-file

### Login
# @name login
POST {{host}}/login
Content-Type: application/json

{"user":"ana"}

> {%
  client.global.set("token", response.body.token);
  client.global.set("who", response.body.user);
  client.test("login answered 200", function () { client.assert(response.status === 200, "status"); });
%}

### Me
GET {{host}}/me
Authorization: Bearer {{token}}

> {%
  client.test("me is ana", function () { client.assert(response.body.user === "ana", "wrong user"); });
  client.test("deliberately wrong", function () { client.assert(response.status === 201, "expected 201"); });
%}

### Uses the login answer
GET {{host}}/items/{{login.response.body.id}}/{{login.response.headers.X-Session}}/{{login.response.body.roles[0]}}

### Unsupported handler
GET {{host}}/items/1

> {% for (let i = 0; i < 3; i++) { client.global.set("loop", i); } %}

### Handler file
GET {{host}}/items/2

> ./checks.js
`);
const chainObj = createObject({ name: 'chain', kind: 'http', config: { folder: chain } });
const cs = httpScan(chainObj.id);
check(cs.setBy.token?.join() === 'login' && cs.setBy.who?.join() === 'login', 'the scan knows which requests keep which variables (read from their handlers)');
check(!cs.used.some((u) => u.name.includes('.response.')) && cs.files[0].requests[4].refs.join() === '' && cs.files[0].requests[2].refs.join() === 'login', 'references to answers are not "variables to define", and the request knows which answers it uses');
check(cs.files[0].requests[1].script?.includes('login answered') !== true && cs.files[0].requests[0].script?.includes('client.global.set("token"') === true, 'the handler is kept with its request, not in the body');
check(cs.files[0].requests[0].body === '{"user":"ana"}', 'and the body stays clean');

const before = httpDescribe(chainObj.id, 'flow.http', 2);
check(before.needsRun.join() === 'login' && before.missing.length === 3, 'before login, the request that uses its answer says it must be run first');
check(await rejects(() => runForObject(chainObj.id, 'flow.http', 2), /“login”.*run it first/), 'and running it is refused with that reason');
const noTok = await runForObject(chainObj.id, 'flow.http', 1);
check(noTok.status === 401 && JSON.parse(noTok.body).auth === 'Bearer from-file', 'without a login the file’s own @token is used (and the server says 401)');

const lg = await runForObject(chainObj.id, 'flow.http', 0);
check(lg.status === 200 && lg.set.join() === 'token,who' && lg.tests.length === 1 && lg.tests[0].passed && !lg.scriptError, 'the login handler keeps the token, runs its test, and the answer says what it kept');
check(httpSession(chainObj.id).globals.who === 'ana' && httpSession(chainObj.id).responses.some((r) => r.name === 'login'), 'the session shows the kept values and the answers it remembers');
const me = await runForObject(chainObj.id, 'flow.http', 1);
check(me.status === 200 && JSON.parse(me.body).user === 'ana', 'the next request uses what the handler kept: it overrides the @token of the file');
check(me.tests.length === 2 && me.tests[0].passed && !me.tests[1].passed && me.tests[1].message === 'expected 201', 'its tests are reported one by one, with the message of the one that failed');
const ref = await runForObject(chainObj.id, 'flow.http', 2);
check(ref.status === 200 && ref.request.url.endsWith('/items/17/sess-42/admin'), 'the answer of a named request is used with {{name.response.body…}}, headers and array indexes');
const unsupported = await runForObject(chainObj.id, 'flow.http', 3);
check(unsupported.status === 200 && /"for" is not supported/.test(unsupported.scriptError ?? '') && httpSession(chainObj.id).globals.loop === undefined, 'a handler with something unsupported is not run, and says so; the request itself is still sent');
const hf = await runForObject(chainObj.id, 'flow.http', 4);
check(hf.status === 200 && hf.scriptFile === './checks.js', 'a handler file is reported (hive-am does not run files)');
check(httpDescribe(chainObj.id, 'flow.http', 2).missing.length === 0 && httpDescribe(chainObj.id, 'flow.http', 2).needsRun.length === 0, 'after the login nothing is missing for the request that uses it');

httpSessionSet(chainObj.id, 'extra', 'by-hand');
check(httpSession(chainObj.id).globals.extra === 'by-hand', 'a value can be set by hand in the session');
check(await rejects(() => httpSessionSet(chainObj.id, 'bad name', 'x'), /not a valid variable name/), 'with a valid name');
httpSessionClear(chainObj.id, 'extra');
check(httpSession(chainObj.id).globals.extra === undefined && httpSession(chainObj.id).globals.token !== undefined, 'one value can be forgotten without the others');
httpSessionClear(chainObj.id);
check(Object.keys(httpSession(chainObj.id).globals).length === 0 && httpSession(chainObj.id).responses.length === 0, 'forgetting everything also forgets the answers');
check(await rejects(() => runForObject(chainObj.id, 'flow.http', 2), /run it first/), 'and then the chain has to be run again');
const otherObj = createObject({ name: 'chain2', kind: 'http', config: { folder: chain } });
await runForObject(otherObj.id, 'flow.http', 0);
check(httpSession(chainObj.id).globals.token === undefined && httpSession(otherObj.id).globals.token !== undefined, 'each HTTP object has its own session');
await removeObject(otherObj.id); await removeObject(chainObj.id);

// ---------------------------------------------------------------- inspecting: every variable with its value and where it comes from
const insp = mkdtempSync(join(tmpdir(), 'http-insp-'));
writeFileSync(join(insp, 'http-client.env.json'), JSON.stringify({ $shared: { region: 'eu' }, dev: { host: `http://127.0.0.1:${port}`, who: 'from-env', token: 'public-token' } }));
writeFileSync(join(insp, 'http-client.private.env.json'), JSON.stringify({ dev: { token: 'PRIVATE-TOKEN-1' } }));
writeFileSync(join(insp, 'i.http'), `@who = from-file
@unusedInFile = nobody-uses-me

### Login
# @name login
POST {{host}}/login

### Probe
GET {{host}}/probe/{{who}}/{{token}}/{{apiKey}}/{{region}}?id={{login.response.body.id}}&n={{$uuid}}&gone={{nowhere}}
X-Key: {{apiKey}}
Authorization: Bearer {{token}}
`);
const io = createObject({ name: 'inspected', kind: 'http', config: { folder: insp, variables: { dev: { who: { value: 'from-hive' }, apiKey: { value: 'HIVE-SECRET-KEY', secret: true }, host: { value: 'http://hive-host' } }, $shared: { region: { value: 'us' }, extra: { value: 'only-hive' } } } } });
const hv2 = (objectsStore.get(io.id)!.config as any).variables;
const byName = (vs: { name: string }[]) => Object.fromEntries(vs.map((v) => [v.name, v])) as Record<string, any>;
const one = byName(httpInspect(io.id, 'i.http', 1, 'dev').vars);
check(one.who.value === 'from-env' && one.who.source === 'envfile' && one.who.overridden.map((o: any) => `${o.source}:${o.value}`).join() === 'hive:from-hive,file:from-file', 'the environment wins over the @ of the file, and the weaker values it hides are listed with their value');
check(one.host.source === 'envfile' && one.host.from === 'dev' && one.host.overridden[0].source === 'hive', 'an env file wins over hive-am’s own value, and says so');
check(one.region.source === 'envfile' && one.region.from === '$shared' && one.region.value === 'eu' && one.region.overridden[0].source === 'hive', 'shared values of the env file are told apart from the environment’s');
check(one.token.value === 'PRIVATE-TOKEN-1' && one.token.secret === true && one.token.source === 'envfile', 'a value from a private env file is flagged secret (the interface masks it)');
check(one.apiKey.source === 'hive' && one.apiKey.value === null && one.apiKey.hidden === true && one.apiKey.secret === true, 'a secret stored in hive-am is never returned: hidden');
check(JSON.stringify(httpInspect(io.id, undefined, undefined, 'dev')).includes('HIVE-SECRET-KEY') === false, 'in no inspection, whatever the scope');
check(one['$uuid'].source === 'dynamic' && one['$uuid'].value === null, 'a generated value is described, not shown');
check(one.nowhere.source === 'missing' && one['login.response.body.id'].source === 'missing' && one['login.response.body.id'].hint === 'run:login', 'what has no value is missing; a reference to an unrun request says which one to run');
const pv = httpInspect(io.id, 'i.http', 1, 'dev').preview!;
check(pv.url.includes('/probe/from-env/PRIVATE-TOKEN-1/••••/eu?id={{login.response.body.id}}&n={{$uuid}}&gone={{nowhere}}'), 'the preview fills in what is known, hides hive’s secrets, and keeps generated and missing ones as they are');
check(pv.headers.find((h) => h.name === 'Authorization')!.value.includes('••••') && !pv.headers.find((h) => h.name === 'Authorization')!.value.includes('PRIVATE'), 'and masks credentials in the headers');
check(pv.unresolved.sort().join() === 'login.response.body.id,nowhere', 'and lists what is unresolved');
const ex = (f: any, redact = false) => httpExport(io.id, 'i.http', 1, f, 'dev', redact);
const cu = ex('curl');
check(cu.text.startsWith(`curl 'http://127.0.0.1:${port}/probe/from-env/PRIVATE-TOKEN-1/HIVE-SECRET-KEY/eu?id={{login.response.body.id}}`) && cu.text.includes("-H 'X-Key: HIVE-SECRET-KEY'") && cu.unresolved.includes('nowhere'), 'copying as cURL uses the values in effect and leaves the missing ones as {{name}}');
check(!ex('curl', true).text.includes('Bearer PRIVATE') && ex('curl', true).text.includes('••••'), 'credential headers can be masked');
check(ex('fetch').text.includes('method: "GET"') && ex('python').text.includes('requests.request') && ex('httpie').text.startsWith('http GET') && ex('http').text.startsWith('GET http://127.0.0.1') && ex('http').text.includes('Host: 127.0.0.1'), 'and as fetch, Python, HTTPie and a raw HTTP message');
for (const f of ['wget', 'powershell', 'axios', 'go', 'php', 'java', 'csharp', 'ruby', 'rust']) check(ex(f).text.includes('/probe/from-env/') && ex(f).text.includes('X-Key'), `copying as ${f} carries the url and the headers`);
check(await rejects(async () => ex('nope'), /Unknown format/), 'an unknown format is refused');
await runForObject(io.id, 'i.http', 0, 'dev').catch(() => undefined);
const fileScope = byName(httpInspect(io.id, 'i.http', undefined, 'dev').vars);
check(fileScope.unusedInFile && fileScope.unusedInFile.usedBy === 0 && fileScope.unusedInFile.source === 'file', 'for a whole file, the @ variables nobody uses are listed too');
check(fileScope.host.usedBy === 2 && fileScope.who.usedBy === 1, 'with how many requests use each');
const all = byName(httpInspect(io.id, undefined, undefined, 'dev').vars);
check(all.extra.source === 'hive' && all.extra.value === 'only-hive' && all.region.value === 'eu', 'for everything: also what only hive-am defines, with the same priorities');
const noEnv = byName(httpInspect(io.id, undefined, undefined, undefined).vars);
check(noEnv.host.source === 'missing' && noEnv.region.value === 'eu', 'without an environment only the shared values apply (what an environment defines is missing)');
httpSessionSet(io.id, 'who', 'from-session');
const ses = byName(httpInspect(io.id, 'i.http', 1, 'dev').vars);
check(ses.who.value === 'from-session' && ses.who.source === 'session' && ses.who.overridden.length === 3, 'a value of the session beats everything, and the rest is listed under it');
httpSessionClear(io.id);

writeFileSync(join(insp, 'basic.http'), '### b\nGET http://h/\nAuthorization: Basic ana s3cret\n');
check(httpExport(io.id, 'basic.http', 0, 'curl', 'dev').text.includes(`Authorization: Basic ${Buffer.from('ana:s3cret').toString('base64')}`), 'Authorization: Basic user password is sent encoded');
const hh = httpHistory(io.id);
check(hh.length >= 1 && hh[0].file === 'i.http' && hh[0].name === 'login' && hh[0].method === 'POST' && (hh[0].run || hh[0].error), 'a run is kept in the history of the object (newest first), with its request name');
const hn = hh.length; httpHistoryClear(io.id);
check(httpHistory(io.id).length === 0 && hn >= 1, 'and the history can be cleared');
const md = httpDocs(io.id, 'markdown', 'i.http').content;
check(md.startsWith('# i.http') && md.includes('## login') && md.includes('POST {{host}}/login') && md.includes('`who` = `from-file`'), 'a file can be exported as Markdown documentation');
const pm = JSON.parse(httpDocs(io.id, 'postman').content);
check(pm.info.schema.includes('v2.1.0') && pm.item.some((f: any) => f.name === 'i.http' && f.item[0].request.method === 'POST') && pm.variable.some((v: any) => v.key === 'who'), 'or as a Postman collection (with the variables of the files)');
check(httpDocs(io.id, 'postman', 'i.http').filename === 'i.postman_collection.json' && await rejects(async () => httpDocs(io.id, 'markdown', 'nope.http'), /not one of/), 'for one file or all of them; an unknown file is refused');
check(await rejects(async () => objectServiceAction(io.id, 'web', 'start'), /Only a compose project/), 'a service action is only for a compose project');
// files: create
check(httpFileCreate(io.id, 'new/made.http', '### x\nGET http://h/\n').file === 'new/made.http' && httpFileRead(io.id, 'new/made.http').content.includes('GET http://h/'), 'a new .http file can be created (folders included)');
check(await rejects(async () => httpFileCreate(io.id, 'new/made.http', ''), /already exists/) && await rejects(async () => httpFileCreate(io.id, '../out.http', ''), /Use a name/) && await rejects(async () => httpFileCreate(io.id, 'notes.txt', ''), /Use a name/), 'but never over an existing one, outside the folder or with another extension');
// files: read and save
check(httpFileRead(io.id, 'i.http').content.startsWith('@who = from-file'), 'a .http file can be read');
httpFileWrite(io.id, 'i.http', httpFileRead(io.id, 'i.http').content.replace('from-file', 'edited'));
check(byName(httpInspect(io.id, 'i.http', 1, 'dev').vars).who.overridden.find((o: any) => o.source === 'file').value === 'edited', 'and saved: the next inspection sees the change');
check(await rejects(() => httpFileWrite(io.id, '../outside.http', 'x'), /outside the folder/) && await rejects(() => httpFileWrite(io.id, 'http-client.env.json', '{}'), /\.http and \.rest/) && await rejects(() => httpFileWrite(io.id, 'new-file.http', 'x'), /does not exist/), 'saving refuses a path outside the folder, other kinds of file, and creating files');
check(await rejects(() => httpFileWrite(io.id, 'i.http', 'x'.repeat(1_100_000)), /too large/) && await rejects(() => httpFileRead(io.id, '../x.http'), /outside the folder/), 'and a file that is too large');
await removeObject(io.id);

// ---------------------------------------------------------------- variables of hive-am (no env file needed)
const bare = mkdtempSync(join(tmpdir(), 'http-bare-'));
writeFileSync(join(bare, 'one.http'), `GET {{host}}/vars/{{who}}\nAuthorization: Bearer {{token}}\n`);
const vobj = createObject({ name: 'own-vars', kind: 'http', config: { folder: bare, env: 'local', variables: { $shared: { who: { value: 'everyone' } }, local: { host: { value: `http://127.0.0.1:${port}` }, token: { value: 'HIDDEN-TOKEN-777', secret: true } }, other: { host: { value: `http://127.0.0.1:${port}/other` } } } } });
check(httpScan(vobj.id).environments.join() === 'local,other', 'the environments of hive-am are listed when there is no env file');
check(await rejects(() => httpRun(bare, 'one.http', 0), /Variables of this object/), 'without them the request is refused and says where to define them');
const hv = { local: { host: { value: `http://127.0.0.1:${port}` }, token: { value: 'HIDDEN-TOKEN-777' } }, $shared: { who: { value: 'everyone' } } };
const vr = await httpRun(bare, 'one.http', 0, 'local', hv);
check(vr.status === 200 && seen.at(-1)!.url === '/vars/everyone' && seen.at(-1)!.headers.authorization === 'Bearer HIDDEN-TOKEN-777', 'with them it runs: environment values and the shared ones are filled in');
check(JSON.stringify(vobj.config).includes('HIDDEN-TOKEN-777') === false && (vobj.config as any).variables.local.token.set === true && (vobj.config as any).variables.local.token.value === '', 'a secret is hidden in what the API returns, and says there is one');
check(JSON.stringify(viewOf(objectsStore.get(vobj.id)!)).includes('HIDDEN-TOKEN-777') === false, 'in every view of the object');
const kept = updateObject(vobj.id, { config: { folder: bare, env: 'local', variables: { local: { host: { value: `http://127.0.0.1:${port}` }, token: { value: '', secret: true } }, $shared: { who: { value: 'changed' } } } } });
check((objectsStore.get(vobj.id)!.config as any).variables.local.token.value === 'HIDDEN-TOKEN-777' && (kept.config as any).variables.local.token.set === true, 'saving a secret left empty keeps the stored value');
const swapped = updateObject(vobj.id, { config: { folder: bare, env: 'local', variables: { local: { host: { value: `http://127.0.0.1:${port}` }, token: { value: 'NEW-ONE', secret: true } }, $shared: { who: { value: 'everyone' } } } } });
check((objectsStore.get(vobj.id)!.config as any).variables.local.token.value === 'NEW-ONE' && !JSON.stringify(swapped).includes('NEW-ONE'), 'typing a new value replaces it, and it is not returned either');
check((await httpRun(bare, 'one.http', 0, 'local', (objectsStore.get(vobj.id)!.config as any).variables)).status === 200, 'the stored (real) values are the ones that are sent');
// an env file wins over hive-am's own value
writeFileSync(join(bare, 'http-client.env.json'), JSON.stringify({ local: { who: 'from-file' } }));
await httpRun(bare, 'one.http', 0, 'local', { local: { host: { value: `http://127.0.0.1:${port}` }, token: { value: 't' }, who: { value: 'from-hive' } } });
check(seen.at(-1)!.url === '/vars/from-file', 'when an env file defines the same variable, the file wins');
check(httpScan(vobj.id).fileVars.local.join() === 'who', 'and the scan says which variables the files define');
check(await rejects(() => createObject({ name: 'bad-var', kind: 'http', config: { folder: bare, variables: { dev: { '1bad': { value: 'x' } } } } }), /valid variable name/), 'a bad variable name is refused');
await removeObject(vobj.id);

// ---------------------------------------------------------------- clusters
const colony = colonies.create({ name: 'cluster-colony', color: '#2f8f5b', cwd: dir, permission: 'acceptEdits', system_prompt: '', skill_ids: [] } as any);
const other = colonies.create({ name: 'other-colony', color: '#d4663f', cwd: dir, permission: 'acceptEdits', system_prompt: '', skill_ids: [] } as any);
const order = join(dir, 'order.txt');
const mk = (name: string, extra = '') => createObject({ name, kind: 'server', colony_id: colony.id, config: { cwd: dir, start: `echo "${name} started" >> ${order}; ${extra} while true; do echo "${name} says hi"; sleep 1; done`, stop: `echo "${name} stopped" >> ${order}` } });
const db = mk('db'), api = mk('api'), web2 = mk('web');
const cluster = createObject({ name: 'stack', kind: 'cluster', colony_id: colony.id, config: { members: [db.id, api.id, web2.id] } });
check((await stateOf(objectsStore.get(cluster.id)!)).status === 'stopped', 'a cluster with all members stopped is stopped');

await objectAction(cluster.id, 'start'); await sleep(1500); await refreshStates();
check((await stateOf(objectsStore.get(cluster.id)!)).status === 'running' && viewOf(objectsStore.get(cluster.id)!).state.detail === '3/3 running', 'starting a cluster starts all members and it reports 3/3 running');
const lines = readFileSync(order, 'utf8').trim().split('\n');
check(lines.join() === 'db started,api started,web started', 'they start in the order they are listed');
await objectAction(cluster.id, 'start');
check(readFileSync(order, 'utf8').trim().split('\n').length === 3, 'starting a cluster that is up does not start anything twice');

await sleep(1200);
const l1 = await objectLogs(cluster.id, { tail: 50 });
check(/\[db\] db says hi/.test(l1.text) && /\[api\] api says hi/.test(l1.text) && /\[web\] web says hi/.test(l1.text), 'the logs of a cluster carry the name of each member');
await sleep(1500);
const l2 = await objectLogs(cluster.id, { after: l1.cursor });
check(/says hi/.test(l2.text) && !/▶/.test(l2.text), 'following with the cursor returns only what is new');

await objectAction(updated(api.id, 'stop'), 'stop').catch(() => undefined);
function updated(id: string, _w: string) { return id; }
await refreshStates();
const partial = await stateOf(objectsStore.get(cluster.id)!);
check(partial.status === 'error' && /2\/3/.test(partial.detail ?? '') && /api/.test(partial.detail ?? ''), 'a cluster with one member down says which, and counts them');

await objectAction(cluster.id, 'stop'); await sleep(300); await refreshStates();
check((await stateOf(objectsStore.get(cluster.id)!)).status === 'stopped', 'stopping a cluster stops all members');
const lines2 = readFileSync(order, 'utf8').trim().split('\n').filter((l) => /stopped/.test(l));
check(lines2.slice(-3).join() === 'web stopped,api stopped,db stopped', 'and they stop in the opposite order');

const bad = createObject({ name: 'broken', kind: 'server', colony_id: colony.id, config: { cwd: dir, start: 'exit 4' } });
const b2 = createObject({ name: 'cluster-2', kind: 'cluster', colony_id: colony.id, config: { members: [bad.id, db.id] } });
await objectAction(b2.id, 'start');
await sleep(800); await refreshStates();
check((await stateOf(objectsStore.get(db.id)!)).status === 'running', 'a member that crashes does not keep the other from starting');
check((await stateOf(objectsStore.get(b2.id)!)).status === 'error' && /broken/.test((await stateOf(objectsStore.get(b2.id)!)).detail ?? ''), 'and the cluster says which one failed');
await objectAction(db.id, 'stop');

// rules
const foreign = createObject({ name: 'elsewhere', kind: 'server', colony_id: other.id, config: { cwd: dir, start: 'sleep 1' } });
check(await rejects(() => createObject({ name: 'cluster-x', kind: 'cluster', colony_id: colony.id, config: { members: [foreign.id] } }), /same colony/), 'a cluster cannot group an object of another colony');
check(await rejects(() => createObject({ name: 'cluster-y', kind: 'cluster', colony_id: colony.id, config: { members: [cluster.id] } }), /only servers and Docker/), 'nor another cluster');
check(await rejects(() => createObject({ name: 'cluster-z', kind: 'cluster', colony_id: colony.id, config: { members: [web.id] } }), /only servers and Docker/), 'nor an HTTP object');
check(createObject({ name: 'old-name', kind: 'boss' as any, colony_id: colony.id, config: { members: [] } }).kind === 'cluster', "the old name 'boss' still creates a cluster");
check(await rejects(() => createObject({ name: 'cluster-w', kind: 'cluster', colony_id: colony.id, config: { members: ['nope'] } }), /does not exist/), 'nor something that does not exist');
await removeObject(web2.id);
check(!(objectsStore.get(cluster.id)!.config as any).members.includes(web2.id), 'deleting a member takes it out of its cluster');
updateObject(api.id, { colony_id: other.id });
check(!(objectsStore.get(cluster.id)!.config as any).members.includes(api.id), 'moving a member to another colony takes it out too');
check(await rejects(() => updateObject(cluster.id, { config: { members: [foreign.id] } }), /same colony/), 'and editing a cluster follows the same rules');

for (const o of objectsStore.list()) await removeObject(o.id);
target.close();
console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
