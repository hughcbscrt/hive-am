// Colony objects without a model: a server kept running (state, port wait, logs, stop, restart, reattach after hive-am restarts, exit codes),
// Docker (container hive-am creates, compose, an existing container) with real containers named hive-am-test-*, and bad input. Usage:
//   HIVE_AM_OBJECT_POLL_MS=500 HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-objects.ts
// The Docker part uses a local image (nginx:1.25-alpine by default; HIVE_TEST_IMAGE) and skips itself when Docker is not available. It never
// touches a container it did not create.
import './_guard.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { colonies } from '../src/db.js';
import { composeServices, inspectMachine, listContainers, listImages, listNetworks, listVolumes, maskVar } from '../src/objects/docker-info.js';
import { ObjectError, createObject, objectAction, objectInspect, objectInspectRaw, objectLogs, removeObject, stateOf, statsOf, updateObject } from '../src/objects/index.js';
import { HttpError } from '../src/http/errors.js';
import { match } from '../src/http/router.js';
import '../src/http/routes/resources.js';
import { objectsStore } from '../src/objects/store.js';

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const rejects = async (fn: () => unknown, re: RegExp) => { try { await fn(); return false; } catch (e) { return e instanceof ObjectError && re.test(e.message); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => Promise<boolean> | boolean, ms = 15000) => { for (let t = 0; t < ms; t += 150) { if (await cond()) return true; await sleep(150); } return false; };
const freePort = () => new Promise<number>((res) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => res(p)); }); });
const st = async (id: string) => (await stateOf(objectsStore.get(id)!)).status;

const dir = mkdtempSync(join(tmpdir(), 'objects-'));
const colony = colonies.create({ name: 'test-colony', color: '#e8a317', cwd: dir, permission: 'acceptEdits', system_prompt: '', skill_ids: [] } as any);

// ---------------------------------------------------------------- server
const port = await freePort();
writeFileSync(join(dir, 'app.js'), `let n = 0; setInterval(() => console.log('tick ' + (++n)), 200);
setTimeout(() => require('http').createServer((q, r) => r.end('ok')).listen(${port}, '127.0.0.1'), 1200);
process.on('SIGTERM', () => { console.log('bye'); process.exit(0); });`);
const srv = createObject({ name: 'web-app', kind: 'server', colony_id: colony.id, config: { cwd: dir, start: 'node app.js', port } });
check((await st(srv.id)) === 'stopped', 'a server object starts out stopped');

await objectAction(srv.id, 'start');
check((await st(srv.id)) === 'starting', 'with a port it is "starting" until something listens');
check(await until(async () => (await st(srv.id)) === 'running'), 'and "running" once the port answers');
const pid = (await stateOf(objectsStore.get(srv.id)!)).pid!;
check(await rejects(() => objectAction(srv.id, 'start'), /already running/), 'starting it twice is refused');

await sleep(700);
const first = await objectLogs(srv.id, { tail: 50 });
check(/tick \d+/.test(first.text) && first.text.includes('▶ node app.js'), 'the logs have the command and what it printed');
await sleep(700);
const more = await objectLogs(srv.id, { after: first.cursor });
check(/tick \d+/.test(more.text) && !more.text.includes('▶'), 'asking after a cursor returns only what is new');
check(Number(more.cursor) > Number(first.cursor), 'and the cursor moves forward');

await objectAction(srv.id, 'stop');
check((await st(srv.id)) === 'stopped', 'stopping it leaves it stopped (not an error)');
check(!existsProcess(pid), 'and the process is really gone');
check((await objectLogs(srv.id, { tail: 20 })).text.includes('bye'), 'the program had the chance to shut down (SIGTERM)');

await objectAction(srv.id, 'restart');
check(await until(async () => (await st(srv.id)) === 'running'), 'restart brings it back');
const pid2 = (await stateOf(objectsStore.get(srv.id)!)).pid!;
check(pid2 !== pid, 'with a new process');
const sst = await statsOf(srv.id);
check(typeof sst.cpu === 'number' && (sst.memBytes ?? 0) > 1_000_000 && (sst.pids ?? 0) >= 1 && sst.info.pid === pid2, 'a running server reports the CPU, memory and processes of its group');

// a stubborn one is killed after the grace time, with its children
const stub = createObject({ name: 'stubborn', kind: 'server', config: { cwd: dir, start: `sh -c 'trap "" TERM; while true; do sleep 1; done'` } });
await objectAction(stub.id, 'start'); await sleep(500);
const sp = (await stateOf(objectsStore.get(stub.id)!)).pid!;
await objectAction(stub.id, 'stop');
check((await st(stub.id)) === 'stopped' && !existsProcess(sp), 'a process that ignores SIGTERM is killed after the grace period');

// exit codes
const bad = createObject({ name: 'crashes', kind: 'server', config: { cwd: dir, start: 'echo boom; exit 3' } });
await objectAction(bad.id, 'start'); await sleep(600);
const bs = await stateOf(objectsStore.get(bad.id)!);
check(bs.status === 'error' && /code 3/.test(bs.detail ?? ''), 'a command that exits with an error is "error" with its code');
const ok0 = createObject({ name: 'finishes', kind: 'server', config: { cwd: dir, start: 'echo done' } });
await objectAction(ok0.id, 'start'); await sleep(600);
check((await st(ok0.id)) === 'stopped', 'one that ends cleanly is just stopped');

// custom stop command
const marker = join(dir, 'stopped.txt');
const cs = createObject({ name: 'custom-stop', kind: 'server', config: { cwd: dir, start: 'sleep 300', stop: `echo stopped > ${marker}` } });
await objectAction(cs.id, 'start'); await sleep(300); await objectAction(cs.id, 'stop');
check(existsSync(marker), 'the optional stop command runs');

// survives hive-am: started by another process, found again here
const other = createObject({ name: 'detached', kind: 'server', config: { cwd: dir, start: 'sleep 300' } });
const helper = join(dir, 'start-elsewhere.ts');
writeFileSync(helper, `import { objectAction } from '${join(import.meta.dirname, '..', 'src', 'objects', 'index.js')}';\n(async () => { await objectAction('${other.id}', 'start'); process.exit(0); })();`);
spawnSync('npx', ['tsx', helper], { env: process.env, cwd: join(import.meta.dirname, '..'), stdio: 'ignore' });
check((await st(other.id)) === 'running', 'a server started by an earlier hive-am process is still seen as running');
await objectAction(other.id, 'stop');
check((await st(other.id)) === 'stopped', 'and can be stopped from the new one');

// ---------------------------------------------------------------- input
check(await rejects(() => createObject({ name: 'web-app', kind: 'server', config: { cwd: dir, start: 'x' } }), /already a resource/), 'names are unique');
check(await rejects(() => createObject({ name: 'x1', kind: 'server', config: { cwd: 'relative', start: 'x' } }), /absolute/), 'a relative folder is refused');
check(await rejects(() => createObject({ name: 'x2', kind: 'server', config: { cwd: dir, start: '' } }), /command/), 'an empty command is refused');
check(await rejects(() => createObject({ name: 'x3', kind: 'server', config: { cwd: dir, start: 'x', port: 70000 } }), /port/), 'a port out of range is refused');
check(await rejects(() => createObject({ name: 'x4', kind: 'server', config: { cwd: dir, start: 'x', env: { 'A B': '1' } } }), /variable name/), 'a bad variable name is refused');
check(await rejects(() => createObject({ name: 'x5', kind: 'docker', config: { mode: 'container', image: '--privileged' } }), /image/), 'an image that looks like an option is refused');
check(await rejects(() => createObject({ name: 'x6', kind: 'docker', config: { mode: 'container', image: 'nginx', ports: ['80'] } }), /port mapping/), 'a bad port mapping is refused');
check(await rejects(() => createObject({ name: 'x7', kind: 'docker', config: { mode: 'container', image: 'nginx', volumes: ['--rm'] } }), /volume/), 'a volume that looks like an option is refused');
check(await rejects(() => createObject({ name: 'x7b', kind: 'docker', config: { mode: 'container', image: 'nginx', volumes: ['data:'] } }), /both sides/) && await rejects(() => createObject({ name: 'x7c', kind: 'docker', config: { mode: 'container', image: 'nginx', volumes: [':/data'] } }), /both sides/), 'a volume with no path in the container, or no source, is refused (it would only fail in docker run)');
check(await rejects(() => createObject({ name: 'x8', kind: 'docker', config: { mode: 'existing', container: '-f' } }), /container name/), 'a container name that looks like an option is refused');
check(await rejects(() => createObject({ name: 'x9', kind: 'server', colony_id: 'nope', config: { cwd: dir, start: 'x' } }), /colony/), 'an unknown colony is refused');
check(updateObject(srv.id, { name: 'web-app-2' }).name === 'web-app-2', 'an object can be renamed');
for (const o of [srv, stub, bad, ok0, cs, other]) await removeObject(o.id);
check(objectsStore.list().filter((o) => o.kind === 'server').length === 0, 'deleting removes the objects (and stops what was running)');
check(!existsProcess(pid2), 'deleting a running server stops its process');

// ---------------------------------------------------------------- inspect is open like the other reads, and says "Docker is off" without an error
const routeStatus = async (method: string, path: string, origin?: string, host = '127.0.0.1:4400') => {
  const url = new URL(`http://127.0.0.1:4400${path}`), m = match(method, url.pathname); if (!m) return 404;
  try { await m.route.handler({ req: { headers: { host, ...(origin ? { origin } : {}) } } as unknown as IncomingMessage, res: null as never, params: m.params, url }); return 200; }
  catch (e) { return e instanceof HttpError ? e.status : e instanceof ObjectError ? 400 : 500; }
};
// The app is also opened through other names on the network, so these reads have no guard, like the other reads of resources.
const named = await Promise.all(['/api/objects/nope/inspect', '/api/objects/nope/inspect/raw', '/api/docker/inspect?kind=image&ref=-x'].map((u) => routeStatus('GET', u, 'http://my-box.lan:4401', 'my-box.lan:4400')));
check(named.every((s) => s === 400), 'the inspect routes answer a page that opened hive-am by another name (they reach the lookup: 400, not 403)');
check(await routeStatus('GET', '/api/docker/inspect?kind=container&ref=-f') === 400 && await routeStatus('GET', '/api/docker/inspect?kind=network&ref=--help') === 400 && await routeStatus('GET', '/api/docker/inspect?kind=image&ref=') === 400, 'a reference that looks like an option (or is empty) is refused with 400');
check(maskVar('DB_PASSWORD=hunter2') === 'DB_PASSWORD=••••••••' && maskVar('HELLO=world') === 'HELLO=world' && maskVar('NOVALUE') === 'NOVALUE', 'a secret-looking variable is hidden whole, an ordinary one is left alone');
check(maskVar('DATABASE_URL=postgres://u:urlpass@h/db') === 'DATABASE_URL=postgres://u:••••••••@h/db' && maskVar('OPTS=--a=redis://:p4ss@cache:6379/0 --b=amqp://guest:g@mq') === 'OPTS=--a=redis://:••••••••@cache:6379/0 --b=amqp://guest:••••••••@mq', 'the password of a URL with credentials is hidden, wherever it sits in the value');
check(maskVar('API=http://host:8080/path@x') === 'API=http://host:8080/path@x' && maskVar('MIRROR=https://user@example.com/x') === 'MIRROR=https://user@example.com/x', 'a port with an @ later in the path, or a user with no password, is not mistaken for a password');
check(await rejects(() => inspectMachine('system', 'x'), /container, an image/) && await rejects(() => inspectMachine('volume', 'a b'), /not a valid volume/), 'only containers, images, volumes and networks with a valid name are inspected');
// Without Docker (or with its daemon down) inspect still says what is configured, with one notice instead of an error.
const here = dirname(fileURLToPath(import.meta.url));
const probe = join(dir, 'probe.mts');
writeFileSync(probe, `import { inspectDocker } from ${JSON.stringify(join(here, '../src/objects/docker.ts'))};\nconsole.log(JSON.stringify(await inspectDocker('abcdef0123456789', { mode: 'container', image: 'nginx:1', ports: ['8080:80'], env: { HELLO: 'world' } })));`);
const probeWith = (env: NodeJS.ProcessEnv) => { const r = spawnSync(process.execPath, ['--import', 'tsx', probe], { cwd: join(here, '..'), env, encoding: 'utf8', timeout: 60000 }); try { return JSON.parse(r.stdout.trim().split('\n').pop() ?? ''); } catch { return { stderr: r.stderr }; } };
const noBin = probeWith({ ...process.env, PATH: mkdtempSync(join(tmpdir(), 'no-docker-')) });
check(noBin.exists === false && noBin.reason === 'no-docker' && /not installed/.test(noBin.error) && noBin.configured?.image === 'nginx:1' && noBin.configured.ports[0] === '8080:80', 'with no docker command, inspect says Docker is missing and still shows what is configured');
const noDaemon = probeWith({ ...process.env, DOCKER_HOST: `unix://${join(dir, 'no-docker.sock')}` });
check(noDaemon.exists === false && noDaemon.reason === 'no-docker' && noDaemon.configured?.env?.[0]?.name === 'HELLO', 'with the Docker daemon not answering, the same notice (not an error)');

// ---------------------------------------------------------------- what Docker has (inventory), read-only, with a fake docker command
// The fake answers the four listings from canned output and writes down every command it gets, to prove the listings never change anything.
const fakeBin = mkdtempSync(join(tmpdir(), 'fake-docker-')), fakeLog = join(fakeBin, 'calls.log');
const canned = {
  ps: [
    { ID: 'a'.repeat(64), Names: 'web', Image: 'nginx', State: 'running', Status: 'Up', Ports: '', Labels: 'hive-am.object=abc,hive-am.cfg=1', Mounts: 'appdata,/srv/site', Networks: 'appnet,bridge' },
    { ID: 'b'.repeat(64), Names: 'db', Image: 'postgres:16', State: 'exited', Status: 'Exited (0)', Ports: '', Labels: '', Mounts: 'appdata,' + 'f'.repeat(64), Networks: 'appnet' },
  ],
  images: [{ Repository: 'nginx', Tag: 'latest', ID: 'i1', Size: '40MB', CreatedSince: '1 day ago' }, { Repository: 'postgres', Tag: '16', ID: 'i2', Size: '400MB', CreatedSince: '2 days ago' }, { Repository: 'redis', Tag: '7', ID: 'i3', Size: '30MB', CreatedSince: '3 days ago' }],
  volume: [{ Name: 'appdata', Driver: 'local', Labels: 'hive-am.created=1' }, { Name: 'f'.repeat(64), Driver: 'local', Labels: 'com.docker.volume.anonymous=' }, { Name: 'spare', Driver: 'local', Labels: '' }],
  network: [{ Name: 'appnet', ID: 'n1', Driver: 'bridge', Scope: 'local', Labels: '' }, { Name: 'bridge', ID: 'n2', Driver: 'bridge', Scope: 'local', Labels: '' }, { Name: 'host', ID: 'n3', Driver: 'host', Scope: 'local', Labels: '' }],
};
for (const [k, rows] of Object.entries(canned)) writeFileSync(join(fakeBin, `${k}.out`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
writeFileSync(join(fakeBin, 'docker'), `#!/bin/sh\necho "$*" >> ${JSON.stringify(fakeLog)}\ncase "$1" in ps|images) cat ${JSON.stringify(fakeBin)}/$1.out ;; volume|network) [ "$2" = ls ] && cat ${JSON.stringify(fakeBin)}/$1.out || exit 1 ;; *) exit 1 ;; esac\n`);
chmodSync(join(fakeBin, 'docker'), 0o755);
const inventory = join(dir, 'inventory.mts');
writeFileSync(inventory, `import * as di from ${JSON.stringify(join(here, '../src/objects/docker-info.ts'))};\nconsole.log(JSON.stringify(await Promise.all([di.listContainers(), di.listImages(), di.listVolumes(), di.listNetworks()])));`);
const inventoryWith = (env: NodeJS.ProcessEnv) => { const r = spawnSync(process.execPath, ['--import', 'tsx', inventory], { cwd: join(here, '..'), env, encoding: 'utf8', timeout: 60000 }); try { return JSON.parse(r.stdout.trim().split('\n').pop() ?? ''); } catch { return [{}, {}, {}, {}]; } };
{
  const [fc, fi, fv, fn] = inventoryWith({ ...process.env, PATH: `${fakeBin}:${process.env.PATH}` });
  const web = fc.containers?.find((c: any) => c.name === 'web'), db = fc.containers?.find((c: any) => c.name === 'db');
  check(fc.available && web?.mounts.join() === 'appdata,/srv/site' && web.networks.join() === 'appnet,bridge' && web.managed && web.id.length === 12 && db?.networks.join() === 'appnet' && !db.managed, 'each container lists its mounts (volume names and host folders) and networks, with the short id');
  const img = (ref: string) => fi.images?.find((i: any) => i.ref === ref)?.inUse;
  check(fi.available && img('nginx:latest') === 1 && img('postgres:16') === 1 && img('redis:7') === 0, 'each image says how many containers use it (nginx and nginx:latest are the same)');
  const vol = (name: string) => fv.volumes?.find((v: any) => v.name === name);
  check(fv.available && vol('appdata')?.inUse === 2 && vol('appdata')?.managed && vol('spare')?.inUse === 0 && !vol('spare')?.managed && vol('f'.repeat(64))?.anonymous && !vol('appdata')?.anonymous && fv.volumes.at(-1)?.anonymous, 'volumes: how many containers mount each, which hive-am created, and the anonymous ones last');
  const net = (name: string) => fn.networks?.find((x: any) => x.name === name);
  check(fn.available && net('appnet')?.inUse === 2 && !net('appnet')?.builtin && net('bridge')?.builtin && net('bridge')?.inUse === 1 && net('host')?.builtin && net('host')?.inUse === 0 && fn.networks[0]?.builtin, 'networks: how many containers use each, and Docker\'s own (bridge, host, none) marked builtin and first');
  const calls = readFileSync(fakeLog, 'utf8').trim().split('\n');
  check(calls.length > 0 && calls.every((c) => /^(ps -a --no-trunc|images|volume ls|network ls) --format \{\{json \.\}\}$/.test(c)), 'the listings only ever run read-only commands (ps, images, volume ls, network ls)');
  check(calls.filter((c) => c.startsWith('ps ')).length === 1, 'the four lists asked at once share a single docker ps (images, volumes and networks count from it)');
}
{
  const none = inventoryWith({ ...process.env, PATH: mkdtempSync(join(tmpdir(), 'no-docker-')) });
  check(none.every((r: any) => r.available === false && /not installed/.test(r.error)) && none[0].containers.length === 0 && none[1].images.length === 0 && none[2].volumes.length === 0 && none[3].networks.length === 0, 'without Docker every list is empty, with available: false and why');
}
check(await routeStatus('GET', '/api/docker/volumes', 'http://my-box.lan:4401', 'my-box.lan:4400') === 200 && await routeStatus('GET', '/api/docker/networks', 'http://my-box.lan:4401', 'my-box.lan:4400') === 200, 'the volume and network lists are open like the container and image lists');

// ---------------------------------------------------------------- docker
const image = process.env.HIVE_TEST_IMAGE ?? 'nginx:1.25-alpine';
const dockerOk = (() => { try { execFileSync('docker', ['image', 'inspect', image], { stdio: 'ignore', timeout: 15000 }); return true; } catch { return false; } })();
if (!dockerOk) console.log(`SKIP  Docker tests (no docker, or the image ${image} is not here)`);
else {
  const hp = await freePort();
  const cont = createObject({ name: 'test-container', kind: 'docker', colony_id: colony.id, config: { mode: 'container', image, ports: [`127.0.0.1:${hp}:80`], env: { HELLO: 'world', DB_PASSWORD: 'hunter2', DATABASE_URL: 'postgres://u:urlpass@db/app' } } });
  const cname = `hive-am-${cont.id.slice(0, 8)}`;
  check((await st(cont.id)) === 'stopped', 'a container that does not exist yet is "stopped"');
  await objectAction(cont.id, 'start');
  check(await until(async () => (await st(cont.id)) === 'running'), 'starting creates and runs the container');
  const cst = await statsOf(cont.id);
  check(cst.info.image === image && (cst.memBytes ?? 0) > 0 && /18|80/.test(String(cst.info.ports ?? '')) && cst.info.restartPolicy === 'no', 'a container reports its usage, image, ports and restart policy');
  const resp = await fetch(`http://127.0.0.1:${hp}/`).then((r) => r.status).catch(() => 0);
  check(resp === 200, 'the port mapping works');
  check(execFileSync('docker', ['inspect', '-f', '{{index .Config.Labels "hive-am.object"}}', cname], { encoding: 'utf8' }).trim() === cont.id, 'it carries a label that says hive-am made it');
  await fetch(`http://127.0.0.1:${hp}/probe-line`).catch(() => undefined); await sleep(800);
  const l1 = await objectLogs(cont.id, { tail: 50 });
  check(/probe-line/.test(l1.text) && !/^\d{4}-\d\d-\d\dT/m.test(l1.text), 'logs show the output without docker\'s timestamps');
  await fetch(`http://127.0.0.1:${hp}/second-probe`).catch(() => undefined); await sleep(800);
  const l2 = await objectLogs(cont.id, { after: l1.cursor });
  check(/second-probe/.test(l2.text) && !/probe-line/.test(l2.text), 'asking after a cursor returns only the new lines');
  await objectAction(cont.id, 'restart');
  check(await until(async () => (await st(cont.id)) === 'running'), 'restart works');
  await objectAction(cont.id, 'stop');
  check((await st(cont.id)) === 'stopped', 'stop works');
  const ic = await objectInspect(cont.id);
  check(ic.exists && ic.status === 'exited' && ic.labels['hive-am.object'] === cont.id && !!ic.labels['hive-am.cfg'] && ic.configured.image === image && !ic.cfgStale, 'a stopped container is inspected: Docker\'s detail (exited), its labels and what is configured');
  const raw = await objectInspectRaw(cont.id, undefined, false);
  const rawJ = JSON.parse(raw.text)[0];
  check(raw.available && rawJ.Name === `/${cname}` && rawJ.Config.Env.includes('HELLO=world') && rawJ.Config.Env.includes('DB_PASSWORD=••••••••') && !raw.text.includes('hunter2') && rawJ.Config.Env.includes('DATABASE_URL=postgres://u:••••••••@db/app') && !raw.text.includes('urlpass') && raw.masked === 2, 'the raw inspect is the whole JSON, with the secret-looking variable and the password of a URL hidden by the server');
  const shown = await objectInspectRaw(cont.id, undefined, true);
  check(JSON.parse(shown.text)[0].Config.Env.includes('DB_PASSWORD=hunter2') && JSON.parse(shown.text)[0].Config.Env.includes('DATABASE_URL=postgres://u:urlpass@db/app') && shown.masked === 0, 'and in the clear only when asked to reveal it');
  check(await rejects(() => inspectMachine('container', 'hive-am-does-not-exist'), /has no container/), 'a container that is not there is a clear error');
  const imgRaw = await inspectMachine('image', image);
  check(imgRaw.available && Array.isArray(JSON.parse(imgRaw.text)) && JSON.parse(imgRaw.text)[0].Id.startsWith('sha256:'), 'an image of the machine can be inspected raw too');
  const fresh = createObject({ name: 'test-not-created', kind: 'docker', config: { mode: 'container', image, ports: ['127.0.0.1:1:80'], env: { DB_PASSWORD: 'x' } } });
  const inc = await objectInspect(fresh.id);
  check(!inc.exists && inc.reason === 'not-created' && inc.configured.image === image && inc.configured.ports[0] === '127.0.0.1:1:80' && inc.configured.env[0]?.name === 'DB_PASSWORD', 'a container never started is not an error: what is configured, and that Docker does not have it yet');
  await removeObject(fresh.id);

  // adopting an existing container: never removed
  const adopted = createObject({ name: 'test-existing', kind: 'docker', config: { mode: 'existing', container: cname } });
  await objectAction(adopted.id, 'start');
  check(await until(async () => (await st(adopted.id)) === 'running'), 'an existing container can be started');
  const ie = await objectInspect(adopted.id);
  check(ie.exists && ie.name === cname && ie.labels['hive-am.object'] === cont.id && ie.configured.name === cname && !ie.cfgStale, 'an existing container can be inspected, with its labels');
  await removeObject(adopted.id);
  check(execFileSync('docker', ['inspect', '-f', '{{.State.Running}}', cname], { encoding: 'utf8' }).trim() === 'true', 'deleting an adopted container object leaves the container alone');
  const missing = createObject({ name: 'test-missing', kind: 'docker', config: { mode: 'existing', container: 'hive-am-does-not-exist' } });
  check((await st(missing.id)) === 'unknown', 'a container that is not there is "unknown", not an error');
  check(await rejects(() => objectAction(missing.id, 'start'), /no container named/), 'and starting it explains why it cannot');
  const im = await objectInspect(missing.id);
  check(!im.exists && im.reason === 'not-found' && im.configured.name === 'hive-am-does-not-exist', 'inspecting an existing container that is not there says Docker cannot find it');
  await removeObject(missing.id);

  // compose
  const cdir = mkdtempSync(join(tmpdir(), 'compose-'));
  const cport = await freePort();
  writeFileSync(join(cdir, 'docker-compose.yml'), `services:\n  web:\n    image: ${image}\n    ports:\n      - "127.0.0.1:${cport}:80"\n`);
  const comp = createObject({ name: 'test-compose', kind: 'docker', config: { mode: 'compose', file: join(cdir, 'docker-compose.yml'), project: 'hivetest' + Date.now().toString(36) } });
  const ins = await objectInspect(comp.id, 'web');
  check(!ins.exists && ins.reason === 'no-service' && ins.configured.image === image && ins.configured.ports[0] === `127.0.0.1:${cport}:80`, 'a compose service with no container: what the compose file says, and that it has to be started');
  check(await rejects(() => objectInspect(comp.id), /which service/), 'a compose project is inspected one service at a time');
  check(await rejects(() => objectInspectRaw(comp.id, 'web', false), /has no container/), 'the raw inspect of a service with no container says to start it');
  await objectAction(comp.id, 'start');
  check(await until(async () => (await st(comp.id)) === 'running'), 'a compose project can be started');
  check((await fetch(`http://127.0.0.1:${cport}/`).then((r) => r.status).catch(() => 0)) === 200, 'and serves');
  check((await objectLogs(comp.id, { tail: 20 })).text.length >= 0, 'its logs can be read');
  const cs = await composeServices(join(cdir, 'docker-compose.yml'));
  check(cs.services.join() === 'web' && cs.source === 'docker' && /^[a-z0-9_-]+$/.test(cs.project), 'the services of a compose file are listed, with a project name suggestion');
  writeFileSync(join(cdir, 'broken.yml'), 'services:\n  alpha:\n    image: ${MISSING_VAR:?must be set}\n  beta:\n    image: x # comment\n  # gamma:\nvolumes:\n  data:\n');
  const cb = await composeServices(join(cdir, 'broken.yml'));
  check(cb.services.join() === 'alpha,beta' && cb.source === 'file', 'when Docker cannot read it, the services are taken from the file itself');
  check(await rejects(() => composeServices('/etc/passwd'), /compose file/) && await rejects(() => composeServices(join(cdir, 'nope.yml')), /does not exist/), 'only existing .yml / .yaml files are read');
  // the inventory with real Docker: a volume, a network and a container (created, never started) made by this test, then removed
  const tag = Date.now().toString(36), tvol = `hive-am-test-vol-${tag}`, tnet = `hive-am-test-net-${tag}`, tcon = `hive-am-test-inv-${tag}`;
  try {
    execFileSync('docker', ['volume', 'create', tvol], { stdio: 'ignore', timeout: 30000 });
    execFileSync('docker', ['network', 'create', tnet], { stdio: 'ignore', timeout: 30000 });
    execFileSync('docker', ['create', '--name', tcon, '-v', `${tvol}:/data`, '-v', `${cdir}:/site:ro`, '--network', tnet, image], { stdio: 'ignore', timeout: 30000 });
    const [rc, rv, rn, ri] = await Promise.all([listContainers(), listVolumes(), listNetworks(), listImages()]);
    const tc = rc.containers.find((c) => c.name === tcon);
    check(!!tc && tc.mounts.includes(tvol) && tc.mounts.includes(cdir) && tc.networks.join() === tnet, 'with real Docker a container lists its volume, its host folder (in full) and its network');
    check(rv.available && rv.volumes.find((v) => v.name === tvol)?.inUse === 1 && rn.available && rn.networks.find((x) => x.name === tnet)?.inUse === 1 && rn.networks.some((x) => x.name === 'bridge' && x.builtin), 'and the volume and the network say one container uses them');
    check((ri.images.find((i) => i.ref === image)?.inUse ?? 0) >= 1, 'the image it was created from counts it');
  } finally {
    for (const args of [['rm', '-f', tcon], ['volume', 'rm', tvol], ['network', 'rm', tnet]]) try { execFileSync('docker', args, { stdio: 'ignore', timeout: 30000 }); } catch { /* cleanup */ }
  }
  check(spawnSync('docker', ['volume', 'inspect', tvol], { stdio: 'ignore' }).status !== 0 && spawnSync('docker', ['network', 'inspect', tnet], { stdio: 'ignore' }).status !== 0, 'the test removes what it created');
  const lc = await listContainers(); const li = await listImages();
  check(lc.available && lc.containers.some((c) => c.name === cname && c.managed) && li.images.some((i) => i.ref === image), 'the containers and images of this machine are listed (and the ones hive-am created are marked)');
  const kst = await statsOf(comp.id);
  check(kst.services?.length === 1 && kst.services[0].name === 'web' && kst.services[0].state === 'running', 'a compose project lists its services');
  const isv = await objectInspect(comp.id, 'web');
  check(isv.exists && isv.status === 'running' && isv.labels['com.docker.compose.service'] === 'web' && isv.configured.name === 'web' && !isv.cfgStale, 'a running compose service is inspected with its compose labels');
  const svcRaw = JSON.parse((await objectInspectRaw(comp.id, 'web', false)).text)[0];
  check(svcRaw.Config.Labels['com.docker.compose.service'] === 'web', 'each compose service has its own raw inspect');
  await objectAction(comp.id, 'stop');
  check((await st(comp.id)) === 'stopped', 'and stopped');
  const proj = (objectsStore.get(comp.id)!.config as any).project;
  await removeObject(comp.id);
  try { execFileSync('docker', ['compose', '-f', join(cdir, 'docker-compose.yml'), '-p', proj, 'down', '-v'], { stdio: 'ignore', timeout: 60000 }); } catch { /* cleanup */ }

  updateObject(cont.id, { config: { ...(objectsStore.get(cont.id)!.config as any), env: { HELLO: 'changed' } } });
  const ist = await objectInspect(cont.id);
  check(ist.exists && ist.cfgStale && ist.configured.env[0]?.value === 'changed', 'after the settings change, inspect says the container will be created again (cfgStale)');
  await removeObject(cont.id);
  check(spawnSync('docker', ['inspect', cname], { stdio: 'ignore' }).status !== 0, 'deleting an object hive-am created removes its container');
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);

function existsProcess(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
