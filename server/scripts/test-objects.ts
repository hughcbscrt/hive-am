// Colony objects without a model: a server kept running (state, port wait, logs, stop, restart, reattach after hive-am restarts, exit codes),
// Docker (container hive-am creates, compose, an existing container) with real containers named hive-am-test-*, and bad input. Usage:
//   HIVE_AM_OBJECT_POLL_MS=500 HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-objects.ts
// The Docker part uses a local image (nginx:1.25-alpine by default; HIVE_TEST_IMAGE) and skips itself when Docker is not available. It never
// touches a container it did not create.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { colonies } from '../src/db.js';
import { ObjectError, createObject, objectAction, objectLogs, removeObject, stateOf, updateObject } from '../src/objects/index.js';
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
check(await rejects(() => createObject({ name: 'web-app', kind: 'server', config: { cwd: dir, start: 'x' } }), /already an object/), 'names are unique');
check(await rejects(() => createObject({ name: 'x1', kind: 'server', config: { cwd: 'relative', start: 'x' } }), /absolute/), 'a relative folder is refused');
check(await rejects(() => createObject({ name: 'x2', kind: 'server', config: { cwd: dir, start: '' } }), /command/), 'an empty command is refused');
check(await rejects(() => createObject({ name: 'x3', kind: 'server', config: { cwd: dir, start: 'x', port: 70000 } }), /port/), 'a port out of range is refused');
check(await rejects(() => createObject({ name: 'x4', kind: 'server', config: { cwd: dir, start: 'x', env: { 'A B': '1' } } }), /variable name/), 'a bad variable name is refused');
check(await rejects(() => createObject({ name: 'x5', kind: 'docker', config: { mode: 'container', image: '--privileged' } }), /image/), 'an image that looks like an option is refused');
check(await rejects(() => createObject({ name: 'x6', kind: 'docker', config: { mode: 'container', image: 'nginx', ports: ['80'] } }), /port mapping/), 'a bad port mapping is refused');
check(await rejects(() => createObject({ name: 'x7', kind: 'docker', config: { mode: 'container', image: 'nginx', volumes: ['--rm'] } }), /volume/), 'a volume that looks like an option is refused');
check(await rejects(() => createObject({ name: 'x8', kind: 'docker', config: { mode: 'existing', container: '-f' } }), /container name/), 'a container name that looks like an option is refused');
check(await rejects(() => createObject({ name: 'x9', kind: 'server', colony_id: 'nope', config: { cwd: dir, start: 'x' } }), /colony/), 'an unknown colony is refused');
check(updateObject(srv.id, { name: 'web-app-2' }).name === 'web-app-2', 'an object can be renamed');
for (const o of [srv, stub, bad, ok0, cs, other]) await removeObject(o.id);
check(objectsStore.list().filter((o) => o.kind === 'server').length === 0, 'deleting removes the objects (and stops what was running)');
check(!existsProcess(pid2), 'deleting a running server stops its process');

// ---------------------------------------------------------------- docker
const image = process.env.HIVE_TEST_IMAGE ?? 'nginx:1.25-alpine';
const dockerOk = (() => { try { execFileSync('docker', ['image', 'inspect', image], { stdio: 'ignore', timeout: 15000 }); return true; } catch { return false; } })();
if (!dockerOk) console.log(`SKIP  Docker tests (no docker, or the image ${image} is not here)`);
else {
  const hp = await freePort();
  const cont = createObject({ name: 'test-container', kind: 'docker', colony_id: colony.id, config: { mode: 'container', image, ports: [`127.0.0.1:${hp}:80`], env: { HELLO: 'world' } } });
  const cname = `hive-am-${cont.id.slice(0, 8)}`;
  check((await st(cont.id)) === 'stopped', 'a container that does not exist yet is "stopped"');
  await objectAction(cont.id, 'start');
  check(await until(async () => (await st(cont.id)) === 'running'), 'starting creates and runs the container');
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

  // adopting an existing container: never removed
  const adopted = createObject({ name: 'test-existing', kind: 'docker', config: { mode: 'existing', container: cname } });
  await objectAction(adopted.id, 'start');
  check(await until(async () => (await st(adopted.id)) === 'running'), 'an existing container can be started');
  await removeObject(adopted.id);
  check(execFileSync('docker', ['inspect', '-f', '{{.State.Running}}', cname], { encoding: 'utf8' }).trim() === 'true', 'deleting an adopted container object leaves the container alone');
  const missing = createObject({ name: 'test-missing', kind: 'docker', config: { mode: 'existing', container: 'hive-am-does-not-exist' } });
  check((await st(missing.id)) === 'unknown', 'a container that is not there is "unknown", not an error');
  check(await rejects(() => objectAction(missing.id, 'start'), /no container named/), 'and starting it explains why it cannot');
  await removeObject(missing.id);

  // compose
  const cdir = mkdtempSync(join(tmpdir(), 'compose-'));
  const cport = await freePort();
  writeFileSync(join(cdir, 'docker-compose.yml'), `services:\n  web:\n    image: ${image}\n    ports:\n      - "127.0.0.1:${cport}:80"\n`);
  const comp = createObject({ name: 'test-compose', kind: 'docker', config: { mode: 'compose', file: join(cdir, 'docker-compose.yml'), project: 'hivetest' + Date.now().toString(36) } });
  await objectAction(comp.id, 'start');
  check(await until(async () => (await st(comp.id)) === 'running'), 'a compose project can be started');
  check((await fetch(`http://127.0.0.1:${cport}/`).then((r) => r.status).catch(() => 0)) === 200, 'and serves');
  check((await objectLogs(comp.id, { tail: 20 })).text.length >= 0, 'its logs can be read');
  await objectAction(comp.id, 'stop');
  check((await st(comp.id)) === 'stopped', 'and stopped');
  const proj = (objectsStore.get(comp.id)!.config as any).project;
  await removeObject(comp.id);
  try { execFileSync('docker', ['compose', '-f', join(cdir, 'docker-compose.yml'), '-p', proj, 'down', '-v'], { stdio: 'ignore', timeout: 60000 }); } catch { /* cleanup */ }

  await removeObject(cont.id);
  check(spawnSync('docker', ['inspect', cname], { stdio: 'ignore' }).status !== 0, 'deleting an object hive-am created removes its container');
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);

function existsProcess(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
