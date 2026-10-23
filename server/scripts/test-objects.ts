// Colony objects without a model: a server kept running (state, port wait, logs, stop, restart, reattach after hive-am restarts, exit codes),
// Docker (container hive-am creates, compose, an existing container) with real containers named hive-am-test-*, and bad input. Usage:
//   HIVE_AM_OBJECT_POLL_MS=500 HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-objects.ts
// The Docker part uses a local image (nginx:1.25-alpine by default; HIVE_TEST_IMAGE) and skips itself when Docker is not available. It never
// touches a container it did not create.
import './_guard.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, statSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, colonies } from '../src/db.js';
import { composeServices, inspectMachine, listContainers, listImages, listNetworks, listVolumes, maskVar } from '../src/objects/docker-info.js';
import { DOCKERFILE_NAME, applyDocker, buildImage, cfgHash, createMade, managedCopy, planChange, removeMade, runArgs } from '../src/objects/docker.js';
import { assertCopyName, copySource, etagOf, readSource, writeSource } from '../src/objects/files.js';
import { ObjectError, objectApply, objectManagedCopy, objectPlan, composeFileCopy, composeFileRead, composeFileWrite, createObject, objectAction, objectInspect, objectInspectRaw, objectLogs, removeObject, stateOf, statsOf, updateObject } from '../src/objects/index.js';
import { HttpError } from '../src/http/errors.js';
import { match } from '../src/http/router.js';
import '../src/http/routes/resources.js';
import '../src/http/routes/fs.js';
import { objectsStore } from '../src/objects/store.js';
import { parseDocker } from '../src/objects/model.js';

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
    { ID: 'b'.repeat(64), Names: 'db', Image: 'postgres:16', State: 'exited', Status: 'Exited (0)', Ports: '', Labels: 'com.docker.compose.project=shop,com.docker.compose.service=db,com.docker.compose.oneoff=False', Mounts: 'appdata,' + 'f'.repeat(64), Networks: 'appnet' },
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
  check(web?.object === 'abc' && !web.project && db?.project === 'shop' && db.service === 'db' && !db.object, 'and the resource that created it, or its compose project and service (for the relations map)');
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

// ---------------------------------------------------------------- creating and removing networks, volumes and images, with a fake docker command
// The fake knows four networks: mine (hive-am's, unused), busy (hive-am's, used by a stopped container), theirs (no label) and bridge. Every
// command is written down, to prove what each action runs and that a refused removal never reaches `rm`.
{
  const bin = mkdtempSync(join(tmpdir(), 'fake-docker-make-')), log = join(bin, 'calls.log');
  writeFileSync(join(bin, 'docker'), `#!/bin/sh
echo "$*" >> ${JSON.stringify(log)}
case "$1 $2" in
  "network inspect"|"volume inspect") n="$5"; case "$n" in mine|busy) echo "$n|{\\"hive-am.created\\":\\"1\\"}" ;; theirs) echo "$n|{}" ;; bridge) echo "bridge|{}" ;; abc) echo "theirs|{\\"hive-am.created\\":\\"1\\"}" ;; *) echo "Error: No such $1: $n" >&2; exit 1 ;; esac ;;
  "ps -a") [ "$5" = "network=busy" ] && echo 0123456789ab; exit 0 ;;
  "network create"|"volume create"|"network rm"|"volume rm") exit 0 ;;
  build*) case "$3" in bad:1) i=0; while [ $i -lt 30 ]; do echo "step $i" >&2; i=$((i+1)); done; echo "ERROR: failed to solve" >&2; exit 1 ;; *) echo "naming to $3 done" >&2 ;; esac ;;
  *) exit 1 ;;
esac
`);
  chmodSync(join(bin, 'docker'), 0o755);
  const df = join(bin, 'Dockerfile'); writeFileSync(df, 'FROM scratch\n');
  const ops = join(dir, 'make.mts');
  writeFileSync(ops, `import * as d from ${JSON.stringify(join(dirname(fileURLToPath(import.meta.url)), '../src/objects/docker.ts'))};
const out: Record<string, unknown> = {};
const tryIt = async (k: string, f: () => Promise<unknown>) => { try { out[k] = await f(); } catch (e) { out[k] = { error: (e as Error).message }; } };
await tryIt('createNew', () => d.createMade('network', 'fresh'));
await tryIt('createAgain', () => d.createMade('network', 'mine'));
await tryIt('removeMine', () => d.removeMade('network', 'mine'));
await tryIt('removeBusy', () => d.removeMade('network', 'busy'));
await tryIt('removeTheirs', () => d.removeMade('network', 'theirs'));
await tryIt('removeByIdPrefix', () => d.removeMade('network', 'abc'));
await tryIt('removeBridge', () => d.removeMade('network', 'bridge'));
await tryIt('removeAnonymous', () => d.removeMade('volume', '${'f'.repeat(64)}'));
await tryIt('createOption', () => d.createMade('volume', '--help'));
await tryIt('createNetworkId', () => d.createMade('network', '${'a'.repeat(64)}'));
await tryIt('removeNetworkId', () => d.removeMade('network', '${'b'.repeat(64)}'));
await tryIt('build', () => d.buildImage({ dockerfile: ${JSON.stringify(df)}, tag: 'my-app:dev' }));
await tryIt('buildFails', () => d.buildImage({ dockerfile: ${JSON.stringify(df)}, tag: 'bad:1' }));
console.log(JSON.stringify(out));`);
  const r = spawnSync(process.execPath, ['--import', 'tsx', ops], { cwd: join(dirname(fileURLToPath(import.meta.url)), '..'), env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8', timeout: 60000 });
  let o: any = {}; try { o = JSON.parse(r.stdout.trim().split('\n').pop() ?? ''); } catch { console.log(r.stderr); }
  const calls = readFileSync(log, 'utf8').trim().split('\n');
  const net = (n: string) => `network inspect -f {{.Name}}|{{json .Labels}} ${n}`;
  check(o.createNew?.created === true && o.createAgain?.created === false, 'a new network is created, one that exists is left alone (created: false)');
  check(o.removeMine?.removed === true, 'hive-am\'s own network with no container is removed');
  check(/used by 1 container/.test(o.removeBusy?.error) && /did not create/.test(o.removeTheirs?.error) && /has no network abc/.test(o.removeByIdPrefix?.error) && /Docker's own/.test(o.removeBridge?.error) && /anonymous/.test(o.removeAnonymous?.error) && /not a valid volume name/.test(o.createOption?.error), 'one in use (even by a stopped container), one hive-am did not create, an id prefix of another network (not that name), bridge, an anonymous volume or a name like an option are refused');
  const want = [
    net('fresh'), 'network create --label hive-am.created=1 fresh',
    net('mine'),
    net('mine'), 'ps -a -q --filter network=mine', 'network rm mine',
    net('busy'), 'ps -a -q --filter network=busy',
    net('theirs'),
    net('abc'),
    `build -t my-app:dev -f ${df} --label hive-am.created=1 ${bin}`,
    `build -t bad:1 -f ${df} --label hive-am.created=1 ${bin}`,
  ];
  check(JSON.stringify(calls) === JSON.stringify(want), 'each action runs exactly its docker commands; refused removals never reach rm, and bridge, anonymous names and option-like names never reach Docker');
  if (JSON.stringify(calls) !== JSON.stringify(want)) console.log(calls);
  check(/network id/.test(o.createNetworkId?.error) && /network id/.test(o.removeNetworkId?.error), 'a network name of 64 hex digits (what an id looks like) is refused, like the volume one, before Docker');
  check(o.build?.tag === 'my-app:dev' && /naming to my-app:dev/.test(o.build.output) && /^The build failed:\n/.test(o.buildFails?.error) && /failed to solve/.test(o.buildFails.error) && !/step 10\b/.test(o.buildFails.error), 'a build answers with its tag and output; a failed one with only its last lines');
}
mkdirSync(join(dir, 'dirs', 'Dockerfile'), { recursive: true });
check(await rejects(() => buildImage({ dockerfile: join(dir, 'nope', 'Dockerfile'), tag: 'x:1' }), /does not exist/) && await rejects(() => buildImage({ dockerfile: 'Dockerfile', tag: 'x:1' }), /absolute path/) && await rejects(() => buildImage({ dockerfile: join(dir, 'dirs', 'Dockerfile'), tag: 'x:1' }), /not a file/), 'a Dockerfile that is not there, a relative path or a folder is refused before Docker');
// A failed build shows the last lines of the file, so only a file named like a Dockerfile is built (its real name too, through a link).
writeFileSync(join(dir, 'run.sh'), 'echo secret\n'); writeFileSync(join(dir, 'notes.txt'), 'secret\n'); mkdirSync(join(dir, 'link'), { recursive: true });
symlinkSync(join(dir, 'notes.txt'), join(dir, 'link', 'Dockerfile'));
check(await rejects(() => buildImage({ dockerfile: '/etc/passwd', tag: 'x:1' }), /not named like a Dockerfile/) && await rejects(() => buildImage({ dockerfile: join(dir, 'run.sh'), tag: 'x:1' }), /not named like a Dockerfile/), 'a file that is not named like a Dockerfile (/etc/passwd, run.sh) is refused before Docker');
check(await rejects(() => buildImage({ dockerfile: join(dir, 'link', 'Dockerfile'), tag: 'x:1' }), /leads to notes\.txt/), 'a link named Dockerfile that leads to a file of another name is refused');
check(['Dockerfile', 'containerfile', 'Dockerfile.prod', 'web.Dockerfile', 'api.containerfile'].every((n) => DOCKERFILE_NAME.test(n)) && !['.Dockerfile', 'Dockerfile.', 'x.yml', 'passwd', 'Dockerfile/x', '-x.Dockerfile'].some((n) => DOCKERFILE_NAME.test(n)), 'the Dockerfile name rule takes Dockerfile, Containerfile and their .suffix / name. variants, and nothing else');
writeFileSync(join(dir, 'Dockerfile'), 'FROM scratch\n');
{
  for (const f of ['web.Dockerfile', 'Containerfile', 'Dockerfile.prod', 'notes.txt']) writeFileSync(join(dir, f), '');
  const u = new URL(`http://127.0.0.1:4400/api/fs/dirs?path=${encodeURIComponent(dir)}&files=dockerfile,containerfile`), m = match('GET', u.pathname)!;
  const listed = await m.route.handler({ req: { headers: { host: '127.0.0.1:4400' } } as unknown as IncomingMessage, res: null as never, params: m.params, url: u }) as { files: { name: string }[] };
  check(listed.files.map((f) => f.name).join() === 'Containerfile,Dockerfile,web.Dockerfile', 'the file picker can list Dockerfiles (Dockerfile, Containerfile, name.Dockerfile)');
}
check(await rejects(() => buildImage({ dockerfile: join(dir, 'Dockerfile'), tag: '-t' }), /image name/) && await rejects(() => buildImage({ dockerfile: join(dir, 'Dockerfile'), tag: 'x', context: join(dir, 'nope') }), /not a folder/), 'an image name like an option, or a build folder that is not there, is refused');
check(await routeStatus('POST', '/api/docker/networks', 'https://evil.example') === 403 && await routeStatus('POST', '/api/docker/volumes', 'https://evil.example') === 403 && await routeStatus('DELETE', '/api/docker/volumes/x', 'https://evil.example') === 403 && await routeStatus('DELETE', '/api/docker/networks/x', 'https://evil.example') === 403 && await routeStatus('POST', '/api/docker/images/build', 'https://evil.example') === 403, 'creating, removing and building only from the local app, like every change to resources');

// ---------------------------------------------------------------- editing or copying the compose file and a Dockerfile (temporary folders only)
{
  const fdir = mkdtempSync(join(tmpdir(), 'files-')), yml = join(fdir, 'docker-compose.yml'), dfile = join(fdir, 'Dockerfile');
  writeFileSync(yml, 'services:\n  web:\n    image: nginx:1\n'); chmodSync(yml, 0o640);
  writeFileSync(dfile, 'FROM scratch\n');
  const comp = createObject({ name: 'files-compose', kind: 'docker', config: { mode: 'compose', file: yml, project: 'hivefiles' } });
  const ex = createObject({ name: 'files-existing', kind: 'docker', config: { mode: 'existing', container: 'hive-am-test-nope' } });
  const ctr = createObject({ name: 'files-container', kind: 'docker', config: { mode: 'container', image: 'nginx:1' } });
  const r1 = composeFileRead(comp.id);
  check(r1.path === yml && r1.content.includes('image: nginx:1') && r1.etag === etagOf(readFileSync(yml)) && r1.bytes === readFileSync(yml).length, 'the compose file of a resource is read from its saved path, with an etag of its bytes');
  check(await rejects(() => composeFileRead(ex.id), /Only a compose resource/) && await rejects(() => composeFileRead(ctr.id), /Only a compose resource/) && await rejects(() => composeFileWrite(ex.id, 'x', 'y'), /Only a compose resource/), 'an existing container (or one hive-am creates) has no file to edit');
  const w1 = await composeFileWrite(comp.id, 'services:\n  web:\n    image: nginx:2\n', r1.etag);
  check(readFileSync(yml, 'utf8').includes('nginx:2') && w1.etag === etagOf(readFileSync(yml)) && (statSync(yml).mode & 0o777) === 0o640 && w1.running === false, 'saving writes the file, keeps its mode, answers the new etag and, with nothing created, no running warning');
  check(w1.check === null || w1.check.ok === true, 'a valid file passes docker compose config (or the check is skipped without Docker)');
  check(!readdirSync(fdir).some((f) => f.includes('.hive-tmp-')), 'no temporary file is left after saving');
  // Someone else changed it: the etag read before is stale.
  writeFileSync(yml, 'services:\n  web:\n    image: edited-elsewhere\n');
  let stale: unknown = null; try { await composeFileWrite(comp.id, 'services: {}\n', w1.etag); } catch (e) { stale = e; }
  check(stale instanceof ObjectError && stale.kind === 'conflict' && /changed on disk/.test(stale.message) && readFileSync(yml, 'utf8').includes('edited-elsewhere'), 'a stale etag is a conflict (409) and the file is not changed');
  check(await rejects(() => composeFileWrite(comp.id, 'services: {}\n', undefined), /Open the file/) && readFileSync(yml, 'utf8').includes('edited-elsewhere'), 'saving without an etag is refused');
  const bad = await composeFileWrite(comp.id, 'services:\n  web:\n    image: [unclosed\n', composeFileRead(comp.id).etag);
  check(readFileSync(yml, 'utf8').includes('[unclosed') && (bad.check === null || (bad.check.ok === false && !!bad.check.error)), 'a YAML Docker cannot read is saved anyway and marked with the error of docker compose config');
  // A failure while saving (a folder that cannot be written) leaves the original as it was, and no temporary file.
  const before = readFileSync(yml, 'utf8');
  writeFileSync(join(fdir, '.docker-compose.yml.hive-tmp-99999'), 'left by a crash');
  chmodSync(fdir, 0o555);
  let ro: unknown = null; try { await composeFileWrite(comp.id, 'services: {}\n', composeFileRead(comp.id).etag); } catch (e) { ro = e; }
  chmodSync(fdir, 0o755);
  check(ro instanceof ObjectError && /cannot be written/.test(ro.message) && readFileSync(yml, 'utf8') === before, 'a save that fails (read-only folder) keeps the original intact');
  check(readdirSync(fdir).filter((f) => f.includes('.hive-tmp-')).join() === '.docker-compose.yml.hive-tmp-99999', 'and leaves no temporary file of its own');
  await composeFileWrite(comp.id, before, composeFileRead(comp.id).etag);
  check(!readdirSync(fdir).some((f) => f.includes('.hive-tmp-')), 'the next save removes a temporary file a crash left (that exact prefix only)');
  // Copies: next to the original, never over another file without overwrite, the original intact; with repoint the resource uses it.
  const orig = readFileSync(yml, 'utf8');
  const cp = await composeFileCopy(comp.id, { name: 'docker-compose.copy.yml', content: 'services:\n  web:\n    image: nginx:3\n', repoint: false });
  check(cp.path === join(fdir, 'docker-compose.copy.yml') && readFileSync(cp.path, 'utf8').includes('nginx:3') && readFileSync(yml, 'utf8') === orig && (objectsStore.get(comp.id)!.config as any).file === yml && !cp.object, 'a copy is written next to the original, which is left intact; without repoint the resource keeps its file');
  let exists: unknown = null; try { await composeFileCopy(comp.id, { name: 'docker-compose.copy.yml', content: 'x: 1\n' }); } catch (e) { exists = e; }
  check(exists instanceof ObjectError && exists.kind === 'conflict' && readFileSync(cp.path, 'utf8').includes('nginx:3'), 'a copy with the name of a file that exists is a conflict (409) and does not replace it');
  const cp2 = await composeFileCopy(comp.id, { name: 'docker-compose.copy.yml', content: 'services:\n  web:\n    image: nginx:4\n', overwrite: true, repoint: true });
  check(readFileSync(cp.path, 'utf8').includes('nginx:4') && (objectsStore.get(comp.id)!.config as any).file === cp.path && cp2.object?.id === comp.id && cp2.running === false, 'with overwrite it is replaced; with repoint the resource points to the copy (and, with nothing created, no running warning)');
  check(composeFileRead(comp.id).path === cp.path, 'and its file is read from the copy from then on');
  const cpNew = await composeFileCopy(comp.id, { name: 'other.yaml' });
  check(readFileSync(cpNew.path, 'utf8') === readFileSync(cp.path, 'utf8'), 'a copy without content takes the text of the file');
  const names = ['../x.yml', 'sub/x.yml', '-x.yml', '.x.yml', 'x.sh', 'docker-compose.copy.yml', '', 'a'.repeat(101) + '.yml'];
  const refused = await Promise.all(names.map((n) => rejects(() => composeFileCopy(comp.id, { name: n, overwrite: true }), /.+/)));
  check(refused.every(Boolean), 'a copy name with / or .., starting with - or ., of another kind, equal to the original, empty or too long is refused');
  check(assertCopyName('dockerfile', '/a/Dockerfile', 'Dockerfile.copy') === 'Dockerfile.copy' && await rejects(() => assertCopyName('dockerfile', '/a/Dockerfile', 'copy.txt'), /not a Dockerfile/) && await rejects(() => assertCopyName('compose', '/a/c.yml', 'c.yml'), /different from the original/), 'a Dockerfile copy keeps a Dockerfile name; the original name is refused');
  // What is sent is what is written, byte for byte (Windows line endings included), and the file keeps its mode (an umask of 022 would turn 664 into 644).
  const cur = (objectsStore.get(comp.id)!.config as any).file as string;
  chmodSync(cur, 0o664);
  const crlf = 'services:\r\n  web:\r\n    image: nginx:5\r\n';
  const wc = await composeFileWrite(comp.id, crlf, composeFileRead(comp.id).etag);
  check(readFileSync(cur).equals(Buffer.from(crlf)) && wc.etag === etagOf(Buffer.from(crlf)) && composeFileRead(comp.id).content === crlf, 'a text with \\r\\n is saved byte for byte and read back the same');
  check((statSync(cur).mode & 0o777) === 0o664, 'saving keeps the mode of the file (664 stays 664 despite the umask)');
  const cm = copySource('compose', cur, 'mode.copy.yml', undefined, false);
  check((statSync(cm.path).mode & 0o777) === 0o664 && readFileSync(cm.path).equals(Buffer.from(crlf)), 'and a copy gets the same mode and the same bytes');
  // Dockerfiles: the path comes from the page, so only a regular file named like a Dockerfile (its real name too), up to 512 KB.
  const d1 = readSource('dockerfile', dfile);
  const dw = writeSource('dockerfile', dfile, 'FROM scratch\nLABEL x=1\n', d1.etag);
  check(readFileSync(dfile, 'utf8').includes('LABEL x=1') && dw.etag === etagOf(readFileSync(dfile)), 'a Dockerfile is read and saved with its etag');
  const dc = copySource('dockerfile', dfile, 'Dockerfile.copy', undefined, false);
  check(dc.path === join(fdir, 'Dockerfile.copy') && readFileSync(dc.path, 'utf8') === readFileSync(dfile, 'utf8'), 'a Dockerfile copy is written next to it');
  mkdirSync(join(fdir, 'Dockerfile.dir')); writeFileSync(join(fdir, 'notes.txt'), 'secret\n'); mkdirSync(join(fdir, 'ln')); symlinkSync(join(fdir, 'notes.txt'), join(fdir, 'ln', 'Dockerfile'));
  writeFileSync(join(fdir, 'big.Dockerfile'), 'x'.repeat(512 * 1024 + 1)); writeFileSync(join(fdir, 'bin.Dockerfile'), Buffer.from([0x46, 0x00, 0x41]));
  const paths: [unknown, RegExp][] = [['Dockerfile', /absolute/], ['/etc/passwd', /not a Dockerfile/], [join(fdir, 'x.sh'), /not a Dockerfile/], [join(fdir, 'nope', 'Dockerfile'), /does not exist/], [join(fdir, 'Dockerfile.dir'), /not a file/], [join(fdir, 'ln', 'Dockerfile'), /leads to notes\.txt/], [join(fdir, 'big.Dockerfile'), /512 KB/], [join(fdir, 'bin.Dockerfile'), /not a text file/]];
  const why = await Promise.all(paths.map(([p, re]) => rejects(() => readSource('dockerfile', p), re)));
  check(why.every(Boolean), 'a Dockerfile path that is relative, not named like one, missing, a folder, a link to another name, over 512 KB or binary is refused');
  if (!why.every(Boolean)) console.log(why);
  check(await rejects(() => writeSource('dockerfile', dfile, 'a\0b', readSource('dockerfile', dfile).etag), /NUL/) && await rejects(() => writeSource('dockerfile', dfile, 'x'.repeat(512 * 1024 + 1), readSource('dockerfile', dfile).etag), /512 KB/), 'content with NUL or over 512 KB is not saved');
  const sixRoutes: [string, string][] = [['GET', `/api/objects/${comp.id}/docker/file`], ['PUT', `/api/objects/${comp.id}/docker/file`], ['POST', `/api/objects/${comp.id}/docker/file/copy`], ['GET', `/api/docker/dockerfile?path=${encodeURIComponent(dfile)}`], ['PUT', '/api/docker/dockerfile'], ['POST', '/api/docker/dockerfile/copy']];
  const evil = await Promise.all(sixRoutes.map(([m, u]) => routeStatus(m, u, 'https://evil.example')));
  check(evil.every((x) => x === 403), 'the six file routes only answer the local app (403 to another origin), reading included');
  check(await routeStatus('GET', `/api/objects/${comp.id}/docker/file`) === 200 && await routeStatus('GET', `/api/docker/dockerfile?path=${encodeURIComponent('/etc/passwd')}`) === 400, 'and the local app reads through them (a bad path is a 400)');
  for (const o of [comp, ex, ctr]) await removeObject(o.id);
}

// ---------------------------------------------------------------- a compose resource made by the old app templates (stacks folder of the data folder)
// The templates are gone, but what they made stays a normal compose resource: its file in <data>/stacks/<slug>/docker-compose.yml, project hive-<slug>.
const legacyStack = (slug: string, body: string) => {
  const sdir = join(DATA_DIR, 'stacks', slug), file = join(sdir, 'docker-compose.yml');
  mkdirSync(sdir, { recursive: true }); writeFileSync(file, body, { flag: 'wx' });
  return { sdir, file, obj: createObject({ name: slug, kind: 'docker', config: { mode: 'compose', file, project: `hive-${slug}` } }) };
};
{
  check(!match('GET', '/api/object-templates') && !match('POST', '/api/objects/from-template'), 'the routes of the app templates are gone (404)');
  const { sdir, file, obj } = legacyStack('my-db', 'services:\n  db:\n    image: "postgres:16"\n    ports:\n      - "15432:5432"\n    environment:\n      POSTGRES_PASSWORD: "pw-1"\n');
  check(obj.kind === 'docker' && (obj.config as any).mode === 'compose' && (obj.config as any).file === file && (obj.config as any).project === 'hive-my-db', 'a compose file in the stacks folder is still a compose resource');
  const r = composeFileRead(obj.id);
  check(r.path === file && r.content.includes('POSTGRES_PASSWORD: "pw-1"') && await routeStatus('GET', `/api/objects/${obj.id}/docker/file`) === 200, 'its File tab reads the compose file from the stacks folder');
  const w = await composeFileWrite(obj.id, r.content.replace('postgres:16', 'postgres:17'), r.etag);
  check(readFileSync(file, 'utf8').includes('postgres:17') && w.etag === etagOf(readFileSync(file)) && w.running === false, 'and saves it in place');
  const cp = await composeFileCopy(obj.id, { name: 'docker-compose.copy.yml', repoint: true });
  check(cp.path === join(sdir, 'docker-compose.copy.yml') && existsSync(file) && composeFileRead(obj.id).path === cp.path, 'a copy goes next to it in the stacks folder and the original stays');
  await removeObject(obj.id);
  check(existsSync(file) && existsSync(cp.path), 'deleting the resource leaves its files in the stacks folder alone');
}
// Saving the compose file asks Docker only to read: `compose config -q` and `compose ps`, nothing that creates or recreates.
{
  const bin = mkdtempSync(join(tmpdir(), 'fake-docker-files-')), log = join(bin, 'calls.log'), yml = join(bin, 'c.yml');
  writeFileSync(join(bin, 'docker'), `#!/bin/sh\necho "$*" >> ${JSON.stringify(log)}\ncase "$*" in *" config -q") echo "yaml: line 3: did not find expected node content" >&2; exit 15 ;; *" ps "*) echo '{"State":"running"}' ;; esac\n`);
  chmodSync(join(bin, 'docker'), 0o755); writeFileSync(yml, 'x: [\n');
  const probeF = join(dir, 'files.mts');
  writeFileSync(probeF, `import * as d from ${JSON.stringify(join(dirname(fileURLToPath(import.meta.url)), '../src/objects/docker.ts'))};
const c = { mode: 'compose' as const, file: ${JSON.stringify(yml)}, project: 'p1' };
console.log(JSON.stringify({ check: await d.composeCheck(c), running: await d.composeRunning('abc', c) }));`);
  const r = spawnSync(process.execPath, ['--import', 'tsx', probeF], { cwd: join(dirname(fileURLToPath(import.meta.url)), '..'), env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8', timeout: 60000 });
  let o: any = {}; try { o = JSON.parse(r.stdout.trim().split('\n').pop() ?? ''); } catch { console.log(r.stderr); }
  const calls = readFileSync(log, 'utf8').trim().split('\n');
  check(o.check?.ok === false && /did not find expected/.test(o.check.error) && o.running === true, 'the check carries the error of docker compose config, and running services are reported');
  check(JSON.stringify(calls) === JSON.stringify([`compose -f ${yml} -p p1 config -q`, `compose -f ${yml} -p p1 ps --all --format json`]), 'and only those two reads reach Docker');
  if (JSON.stringify(calls) !== JSON.stringify([`compose -f ${yml} -p p1 config -q`, `compose -f ${yml} -p p1 ps --all --format json`])) console.log(calls);
}

// ---------------------------------------------------------------- changing a container hive-am created: the options, the hash, the commands
{
  // The hash of a configuration saved before the new options existed must not change, or every container would be created again after an
  // update. The expected values were computed with the code of main before this change.
  const sample = parseDocker({ mode: 'container', image: 'nginx:1.25-alpine', ports: ['127.0.0.1:8080:80'], volumes: ['data:/data', '/srv/site:/usr/share/nginx/html:ro'], env: { HELLO: 'world' }, restart: 'unless-stopped', command: 'nginx -g daemon off;', memory: '256m', cpus: 0.5, network: 'appnet', logMaxMb: 5, stopTimeoutSec: 7 });
  check(cfgHash(sample) === 'bbbb1a2c8ad9' && cfgHash(parseDocker({ mode: 'container', image: 'nginx' })) === '35b5556307d7', 'the hash of a configuration without the new options is exactly the one of before (no container is created again after updating)');
  check(cfgHash({ ...sample, extraNetworks: ['other'] }) === cfgHash(sample) && cfgHash({ ...sample, stopTimeoutSec: 30 }) === cfgHash(sample), 'additional networks and the stop timeout are not in the hash (they never create the container again)');
  check(['labels', 'user', 'workdir', 'entrypoint', 'hostname'].every((k) => cfgHash({ ...sample, [k]: k === 'labels' ? { a: 'b' } : k === 'workdir' ? '/app' : 'x' } as any) !== cfgHash(sample)), 'each new option, once set, changes the hash (it creates the container again)');
  const full = parseDocker({ mode: 'container', image: 'nginx:1', env: { DB_PASSWORD: 'hunter2' }, extraNetworks: ['backend'], labels: { 'com.example.team': 'web' }, user: '1000:1000', workdir: '/app', entrypoint: '/docker-entrypoint.sh', hostname: 'web-1', command: 'nginx -g "daemon off;"' });
  const ra = runArgs('abcdef0123456789', full);
  const at = (flag: string) => ra[ra.indexOf(flag) + 1];
  check(at('--user') === '1000:1000' && at('--workdir') === '/app' && at('--entrypoint') === '/docker-entrypoint.sh' && at('--hostname') === 'web-1' && ra.includes('com.example.team=web') && ra.includes('hive-am.networks=1') && !ra.includes('backend'), 'docker run gets each supported option as its own argument (additional networks are connected after, not passed here)');
  check(JSON.stringify(ra.slice(ra.indexOf('nginx:1'))) === JSON.stringify(['nginx:1', 'nginx', '-g', 'daemon off;']), 'the image and the command come last, as before');
  const bad: [Record<string, unknown>, RegExp][] = [
    [{ privileged: true }, /"privileged" is not an option/], [{ capAdd: ['ALL'], runArgs: '--pid=host' }, /"capAdd", "runArgs" are not options/],
    [{ extraNetworks: ['-x'] }, /not a valid network name/], [{ extraNetworks: ['host'] }, /cannot be connected to the network host/], [{ network: 'none', extraNetworks: ['a'] }, /on the network none/],
    [{ network: 'appnet', extraNetworks: ['appnet'] }, /already the main network/], [{ extraNetworks: ['a', 'a'] }, /listed twice/],
    [{ labels: { 'hive-am.object': 'x' } }, /hive-am's own/], [{ labels: { 'bad key': 'x' } }, /not a valid label name/], [{ labels: { a: 'one\ntwo' } }, /one line/],
    [{ user: 'root; rm' }, /user must be/], [{ workdir: 'app' }, /absolute path/], [{ entrypoint: '--privileged' }, /one program/], [{ entrypoint: 'sh -c' }, /one program/], [{ hostname: 'bad_host!' }, /hostname is not valid/],
  ];
  const refusedOpts = await Promise.all(bad.map(([extra, re]) => rejects(() => parseDocker({ mode: 'container', image: 'nginx', ...extra }), re)));
  check(refusedOpts.every(Boolean), 'an option hive-am does not support is refused (not ignored), and each supported one is validated');
  if (!refusedOpts.every(Boolean)) console.log(bad.filter((_, i) => !refusedOpts[i]).map(([x]) => JSON.stringify(x)));
  const ex = parseDocker({ mode: 'existing', container: 'theirs' });
  check(await rejects(() => planChange('abcdef0123456789', ex, ex), /never changed by hive-am/) && await rejects(() => applyDocker('abcdef0123456789', ex, { confirm: true }), /never changed by hive-am/), 'an existing container is never planned for nor applied to (it is never recreated or disconnected)');
  check(await rejects(() => managedCopy(parseDocker({ mode: 'container', image: 'nginx' })), /Only an existing container/), 'only an existing container is copied into a managed one');
  check(await routeStatus('POST', '/api/objects/x/docker/plan', 'https://evil.example') === 403 && await routeStatus('POST', '/api/objects/x/docker/apply', 'https://evil.example') === 403 && await routeStatus('GET', '/api/objects/x/docker/managed-copy', 'https://evil.example') === 403, 'planning, applying and reading a managed copy only from the local app');
}

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
  {
    const ids = () => execFileSync('docker', ['compose', '-f', join(cdir, 'docker-compose.yml'), '-p', (objectsStore.get(comp.id)!.config as any).project, 'ps', '-q'], { encoding: 'utf8', timeout: 30000 }).trim();
    const was = ids(), f = await composeFileRead(comp.id);
    const sv = await composeFileWrite(comp.id, `${f.content}# edited from hive-am\n`, f.etag);
    check(sv.running === true && sv.check?.ok === true && !!was && ids() === was, 'saving the file of a running compose project warns that it is running and does not recreate anything (same container)');
    const file0 = (objectsStore.get(comp.id)!.config as any).file;
    const cr = await composeFileCopy(comp.id, { name: 'docker-compose.running.yml', repoint: true });
    check(cr.running === true && !!cr.object && ids() === was, 'a copy the resource now uses, made while it runs, warns that the services run the old definition (and recreates nothing)');
    updateObject(comp.id, { config: { ...(objectsStore.get(comp.id)!.config as any), file: file0 } });
  }
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
  {
    // a compose resource the old app templates made, with its file in the stacks folder, starts and stops like any other
    const slug = `hivetest-stack-${Date.now().toString(36)}`, sport = await freePort();
    const { file, obj } = legacyStack(slug, `services:\n  web:\n    image: "${image}"\n    ports:\n      - "127.0.0.1:${sport}:80"\n`);
    try {
      await objectAction(obj.id, 'start');
      check(await until(async () => (await st(obj.id)) === 'running') && (await fetch(`http://127.0.0.1:${sport}/`).then((r) => r.status).catch(() => 0)) === 200, 'a compose resource in the stacks folder (made by the old templates) starts and serves');
      await objectAction(obj.id, 'stop');
      check((await st(obj.id)) === 'stopped', 'and stops');
    } finally {
      await removeObject(obj.id);
      try { execFileSync('docker', ['compose', '-f', file, '-p', `hive-${slug}`, 'down', '-v'], { stdio: 'ignore', timeout: 60000 }); } catch { /* cleanup */ }
    }
  }

  // creating and removing with real Docker: hive-am's own volume and network, a foreign volume, and a container that uses them; then an image
  const mk = Date.now().toString(36), mvol = `hive-am-test-mkvol-${mk}`, mnet = `hive-am-test-mknet-${mk}`, fvol = `hive-am-test-foreign-${mk}`, mcon = `hive-am-test-mk-${mk}`, mimg = `hive-am-test-img-${mk}:1`;
  try {
    const v1 = await createMade('volume', mvol), n1 = await createMade('network', mnet);
    const v2 = await createMade('volume', mvol), n2 = await createMade('network', mnet);
    check(v1.created && n1.created && !v2.created && !n2.created, 'with real Docker a volume and a network are created, and asking again changes nothing');
    check(execFileSync('docker', ['volume', 'inspect', '-f', '{{index .Labels "hive-am.created"}}', mvol], { encoding: 'utf8' }).trim() === '1' && execFileSync('docker', ['network', 'inspect', '-f', '{{index .Labels "hive-am.created"}}', mnet], { encoding: 'utf8' }).trim() === '1', 'both carry the label hive-am.created=1');
    const [lv, ln] = await Promise.all([listVolumes(), listNetworks()]);
    check(!!lv.volumes.find((v) => v.name === mvol)?.managed && !!ln.networks.find((x) => x.name === mnet)?.managed, 'and the lists mark them as created by hive-am (managed)');
    execFileSync('docker', ['volume', 'create', fvol], { stdio: 'ignore', timeout: 30000 });
    execFileSync('docker', ['create', '--name', mcon, '-v', `${mvol}:/data`, '--network', mnet, image], { stdio: 'ignore', timeout: 30000 });
    check(await rejects(() => removeMade('volume', mvol), /used by 1 container/) && await rejects(() => removeMade('network', mnet), /used by 1 container/), 'a volume and a network a stopped container uses are not removed');
    check(await rejects(() => removeMade('volume', fvol), /did not create/) && await rejects(() => removeMade('network', 'bridge'), /Docker's own/), 'a volume hive-am did not create, and bridge, are not removed');
    check(spawnSync('docker', ['volume', 'inspect', mvol], { stdio: 'ignore' }).status === 0 && spawnSync('docker', ['volume', 'inspect', fvol], { stdio: 'ignore' }).status === 0 && spawnSync('docker', ['network', 'inspect', mnet], { stdio: 'ignore' }).status === 0, 'and they are all still there');
    execFileSync('docker', ['rm', '-f', mcon], { stdio: 'ignore', timeout: 30000 });
    const rv = await removeMade('volume', mvol), rn = await removeMade('network', mnet);
    check(rv.removed && rn.removed && spawnSync('docker', ['volume', 'inspect', mvol], { stdio: 'ignore' }).status !== 0 && spawnSync('docker', ['network', 'inspect', mnet], { stdio: 'ignore' }).status !== 0, 'once no container uses them, hive-am\'s own volume and network are removed');
    const bdir = mkdtempSync(join(tmpdir(), 'build-'));
    writeFileSync(join(bdir, 'Dockerfile'), `FROM ${image}\nLABEL hive-am-test=1\n`);
    const b = await buildImage({ dockerfile: join(bdir, 'Dockerfile'), tag: mimg });
    check(b.tag === mimg && (await listImages()).images.some((i) => i.ref === mimg), 'an image is built from a Dockerfile and shows in the image list');
    writeFileSync(join(bdir, 'Broken.Dockerfile'), `FROM ${image}\nRUN exit 7\n`);
    check(await rejects(() => buildImage({ dockerfile: join(bdir, 'Broken.Dockerfile'), tag: `${mimg}-broken` }), /The build failed/), 'a failing build says so, with its last lines');
  } finally {
    for (const args of [['rm', '-f', mcon], ['volume', 'rm', mvol], ['volume', 'rm', fvol], ['network', 'rm', mnet], ['rmi', mimg]]) try { execFileSync('docker', args, { stdio: 'ignore', timeout: 30000 }); } catch { /* cleanup */ }
  }
  check([['volume', mvol], ['volume', fvol], ['network', mnet], ['image', mimg]].every(([k, n]) => spawnSync('docker', [k, 'inspect', n], { stdio: 'ignore' }).status !== 0), 'the test removes what it created');

  // Changing a container hive-am created, with real Docker: additional networks in place (same container), the rest created again only
  // after a confirmation, named volumes kept, anonymous ones reported; and a managed copy of an existing container that leaves it alone.
  const rc = Date.now().toString(36), n1 = `hive-am-test-n1-${rc}`, n2 = `hive-am-test-n2-${rc}`, kvol = `hive-am-test-keep-${rc}`, vimg = `hive-am-test-volimg-${rc}:1`;
  let mc: ReturnType<typeof createObject> | null = null, ex2: ReturnType<typeof createObject> | null = null, copyOf: ReturnType<typeof createObject> | null = null;
  try {
    for (const n of [n1, n2]) execFileSync('docker', ['network', 'create', n], { stdio: 'ignore', timeout: 30000 });
    const vdir = mkdtempSync(join(tmpdir(), 'volimg-'));
    writeFileSync(join(vdir, 'Dockerfile'), `FROM ${image}\nVOLUME /cache\n`);
    execFileSync('docker', ['build', '-q', '-t', vimg, vdir], { stdio: 'ignore', timeout: 120000 });
    mc = createObject({ name: 'test-reconfig', kind: 'docker', config: { mode: 'container', image: vimg, volumes: [`${kvol}:/data`], extraNetworks: [n1], env: { A: '1' } } });
    const mname = `hive-am-${mc.id.slice(0, 8)}`;
    const cid = () => execFileSync('docker', ['inspect', '-f', '{{.Id}}', mname], { encoding: 'utf8' }).trim();
    const nets = () => Object.keys(JSON.parse(execFileSync('docker', ['inspect', '-f', '{{json .NetworkSettings.Networks}}', mname], { encoding: 'utf8' }))).sort().join();
    const p0 = await objectPlan(mc.id, objectsStore.get(mc.id)!.config);
    check(!p0.exists && !p0.recreate && /^docker create .* --label hive-am\.networks=1 /.test(p0.preview[0]) && p0.preview[1] === `docker network connect ${n1} ${mname}` && p0.preview[2] === `docker start ${mname}`, 'a container not created yet: nothing is recreated, and the preview shows how it will be created (create, connect, start)');
    await objectAction(mc.id, 'start');
    check(await until(async () => (await st(mc!.id)) === 'running') && nets() === ['bridge', n1].sort().join(), 'with an additional network it is created, connected to it and started');
    const id0 = cid();
    const cfg = () => objectsStore.get(mc!.id)!.config as any;
    const p1 = await objectPlan(mc.id, { ...cfg(), extraNetworks: [n1, n2] });
    check(p1.exists && p1.running && !p1.recreate && p1.connect.join() === n2 && !p1.disconnect.length && !p1.changes.length, 'adding a network is planned as a connection in place, nothing recreated');
    updateObject(mc.id, { config: { ...cfg(), extraNetworks: [n1, n2] } });
    const a1 = await objectApply(mc.id, {});
    check(a1.applied === 'networks' && a1.connected.join() === n2 && cid() === id0 && nets() === ['bridge', n1, n2].sort().join(), 'applying it connects the network without creating the container again (same id)');
    const p2 = await objectPlan(mc.id, { ...cfg(), extraNetworks: [n2] });
    check(!p2.recreate && p2.disconnect.join() === n1 && !p2.connect.length, 'taking one out is planned as a disconnection');
    updateObject(mc.id, { config: { ...cfg(), extraNetworks: [n2] } });
    await objectApply(mc.id, { drop: [n1] });
    check(cid() === id0 && nets() === ['bridge', n2].sort().join(), 'and applying disconnects it, same container');
    // Stopped: a network is still changed in place, and the container stays stopped.
    await objectAction(mc.id, 'stop');
    updateObject(mc.id, { config: { ...cfg(), extraNetworks: [n1, n2] } });
    const a2 = await objectApply(mc.id, {});
    check(a2.applied === 'networks' && cid() === id0 && nets() === ['bridge', n1, n2].sort().join() && (await st(mc.id)) === 'stopped', 'a stopped container is connected in place too, and stays stopped');
    // Saved without applying: the next start makes the networks match (hive-am keeps them as configured).
    updateObject(mc.id, { config: { ...cfg(), extraNetworks: [n1] } });
    await objectAction(mc.id, 'start');
    check(await until(async () => (await st(mc!.id)) === 'running') && cid() === id0 && nets() === ['bridge', n1].sort().join(), 'saved without applying, the next start connects and disconnects to match, without recreating');
    // A change that recreates: planned with what changes and what is left behind, refused without confirmation, then done.
    const p3 = await objectPlan(mc.id, { ...cfg(), env: { A: '2', DB_PASSWORD: 'hunter2' }, volumes: [], workdir: '/tmp' });
    const fields = p3.changes.map((x) => x.field).sort().join();
    check(p3.recreate && !p3.stale && fields === 'env,volumes,workdir' && p3.anonymous.length === 1 && p3.anonymous[0].destination === '/cache' && /^[0-9a-f]{64}$/.test(p3.anonymous[0].name), 'a variable, a volume and the working folder change: recreate, each field listed, and the anonymous volume at /cache reported');
    check(p3.changes.find((x) => x.field === 'env')?.to === 'A=2, DB_PASSWORD=••••••••' && p3.preview.length === 3 && p3.preview[0].startsWith('docker create ') && p3.preview[0].includes('DB_PASSWORD=••••••••') && !p3.preview.join().includes('hunter2') && p3.preview[0].includes('--workdir /tmp'), 'the change and the docker run preview hide the secret-looking variable');
    updateObject(mc.id, { config: { ...cfg(), env: { A: '2', DB_PASSWORD: 'hunter2' }, volumes: [], workdir: '/tmp' } });
    const p3b = await objectPlan(mc.id, cfg());
    check(p3b.recreate && p3b.stale && !p3b.changes.length, 'saved but not applied: the plan says it is created again because of what was saved before (stale)');
    check(await rejects(() => objectApply(mc!.id, {}), /confirm it first/) && cid() === id0, 'applying a change that recreates is refused without confirmation, and the container is not touched');
    const anon = p3.anonymous[0].name;
    const a3 = await objectApply(mc.id, { confirm: true });
    const id1 = cid();
    check(a3.applied === 'recreated' && id1 !== id0 && await until(async () => (await st(mc!.id)) === 'running') && execFileSync('docker', ['inspect', '-f', '{{.Config.WorkingDir}}', mname], { encoding: 'utf8' }).trim() === '/tmp', 'with confirmation it is created again (new id), running as it was, with the new settings');
    check(nets() === ['bridge', n1].sort().join(), 'and with its additional network connected again');
    check(spawnSync('docker', ['volume', 'inspect', kvol], { stdio: 'ignore' }).status === 0 && spawnSync('docker', ['volume', 'inspect', anon], { stdio: 'ignore' }).status === 0, 'the named volume taken out of the settings is not removed, and the anonymous one is left behind as reported');
    try { execFileSync('docker', ['volume', 'rm', anon], { stdio: 'ignore', timeout: 30000 }); } catch { /* cleanup */ }
    // An existing container is never changed; a managed copy is read from it and the original is left alone.
    execFileSync('docker', ['network', 'connect', n2, cname], { stdio: 'ignore', timeout: 30000 });
    ex2 = createObject({ name: 'test-existing-copy', kind: 'docker', config: { mode: 'existing', container: cname } });
    const before = execFileSync('docker', ['inspect', '-f', '{{.Id}} {{.State.Status}} {{json .NetworkSettings.Networks}}', cname], { encoding: 'utf8' });
    check(await rejects(() => objectPlan(ex2!.id, { mode: 'existing', container: cname }), /never changed by hive-am/) && await rejects(() => objectApply(ex2!.id, { confirm: true }), /never changed by hive-am/), 'an existing container refuses a plan and an apply, even confirmed');
    const copy = await objectManagedCopy(ex2.id);
    const cc = copy.config;
    check(cc.mode === 'container' && cc.image === image && cc.ports?.[0] === `127.0.0.1:${hp}:80` && cc.env?.HELLO === 'world' && !('PATH' in (cc.env ?? {})) && cc.extraNetworks?.join() === n2 && copy.name === `${cname}-copy`, 'a managed copy is read from the existing container: image, ports, its own variables (not the image\'s), its other network, and a name');
    check(execFileSync('docker', ['inspect', '-f', '{{.Id}} {{.State.Status}} {{json .NetworkSettings.Networks}}', cname], { encoding: 'utf8' }) === before, 'reading it does not touch the original');
    copyOf = createObject({ name: 'test-managed-copy', kind: 'docker', config: { ...cc, ports: [] } });
    check((objectsStore.get(copyOf.id)!.config as any).image === image, 'the copy is saved as a container hive-am creates');
  } finally {
    // The image declares a volume, so the container hive-am created last has an anonymous one: removing the resource leaves it (rm -f without -v).
    const leftover = mc ? spawnSync('docker', ['inspect', '-f', '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} {{end}}{{end}}', `hive-am-${mc.id.slice(0, 8)}`], { encoding: 'utf8' }).stdout.split(' ').filter((x) => /^[0-9a-f]{64}$/.test(x.trim())) : [];
    for (const o of [mc, ex2, copyOf]) if (o) await removeObject(o.id).catch(() => undefined);
    for (const v of leftover) try { execFileSync('docker', ['volume', 'rm', v.trim()], { stdio: 'ignore', timeout: 30000 }); } catch { /* cleanup */ }
    try { execFileSync('docker', ['network', 'disconnect', n2, cname], { stdio: 'ignore', timeout: 30000 }); } catch { /* cleanup */ }
    for (const args of [['volume', 'rm', kvol], ['network', 'rm', n1], ['network', 'rm', n2], ['rmi', vimg]]) try { execFileSync('docker', args, { stdio: 'ignore', timeout: 30000 }); } catch { /* cleanup */ }
  }
  check([['volume', kvol], ['network', n1], ['network', n2], ['image', vimg]].every(([k, n]) => spawnSync('docker', [k, 'inspect', n], { stdio: 'ignore' }).status !== 0) && (!mc || spawnSync('docker', ['inspect', `hive-am-${mc.id.slice(0, 8)}`], { stdio: 'ignore' }).status !== 0), 'the test removes what it created');

  updateObject(cont.id, { config: { ...(objectsStore.get(cont.id)!.config as any), env: { HELLO: 'changed' } } });
  const ist = await objectInspect(cont.id);
  check(ist.exists && ist.cfgStale && ist.configured.env[0]?.value === 'changed', 'after the settings change, inspect says the container will be created again (cfgStale)');
  await removeObject(cont.id);
  check(spawnSync('docker', ['inspect', cname], { stdio: 'ignore' }).status !== 0, 'deleting an object hive-am created removes its container');
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);

function existsProcess(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
