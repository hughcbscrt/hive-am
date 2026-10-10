// What keeps servers and containers in shape by themselves, without a model: restart policies (after a failure, always, never, the limit and the
// growing wait), that stopping by hand is never undone, health checks (http, tcp, command; unhealthy; restart when unhealthy), log rotation,
// the stop timeout, and the new Docker settings (memory, CPUs, network, log size, stop timeout; recreated when they change). Usage:
//   HIVE_AM_OBJECT_POLL_MS=60000 HIVE_AM_OBJECT_BACKOFF_MS=150 HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-object-supervision.ts
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as tcp } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DATA_DIR } from '../src/db.js';
import { ObjectError, createObject, objectAction, objectLogs, refreshStates, removeObject, stateOf, updateObject } from '../src/objects/index.js';
import { objectsStore } from '../src/objects/store.js';

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const rejects = async (fn: () => unknown, re: RegExp) => { try { await fn(); return false; } catch (e) { return e instanceof ObjectError && re.test(e.message); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => Promise<boolean> | boolean, ms = 15000) => { for (let t = 0; t < ms; t += 120) { if (await cond()) return true; await sleep(120); } return false; };
const st = async (id: string) => stateOf(objectsStore.get(id)!);
const dir = mkdtempSync(join(tmpdir(), 'sup-'));
const counter = join(dir, 'runs.txt');
const runs = () => (existsSync(counter) ? readFileSync(counter, 'utf8').trim().split('\n').filter(Boolean).length : 0);
const mk = (name: string, config: Record<string, unknown>) => createObject({ name, kind: 'server', config: { cwd: dir, ...config } as any });

// ---------------------------------------------------------------- restart policies
const fails = mk('fails', { start: `echo run >> ${counter}; exit 1`, restart: 'on-failure', maxRestarts: 3 });
await objectAction(fails.id, 'start');
check(await until(async () => { await st(fails.id); return runs() >= 4; }), 'after a failure it is started again (1 run + 3 restarts)');
await sleep(1200); await st(fails.id);
const gave = await st(fails.id);
check(runs() === 4 && /gave up after 3/.test(gave.detail ?? ''), 'and then it gives up and says so, instead of looping for ever');
check((await objectLogs(fails.id, { tail: 80 })).text.includes('gave up'), 'the log says it gave up');
await objectAction(fails.id, 'start');
check(await until(async () => { await st(fails.id); return runs() >= 5; }), 'starting it by hand begins the count again');
await objectAction(fails.id, 'stop'); await sleep(900); await st(fails.id);
const after = runs(); await sleep(900); await st(fails.id);
check(runs() === after && (await st(fails.id)).status === 'stopped', 'stopping it by hand is never undone');

const clean = mk('clean-exit', { start: `echo run >> ${join(dir, 'clean.txt')}; exit 0`, restart: 'on-failure' });
await objectAction(clean.id, 'start'); await sleep(1000); await st(clean.id); await sleep(600); await st(clean.id);
check(readFileSync(join(dir, 'clean.txt'), 'utf8').trim().split('\n').length === 1 && (await st(clean.id)).status === 'stopped', 'on-failure does not restart one that ended well');
const always = mk('always', { start: `echo run >> ${join(dir, 'always.txt')}; exit 0`, restart: 'always', maxRestarts: 2 });
await objectAction(always.id, 'start');
check(await until(async () => { await st(always.id); return existsSync(join(dir, 'always.txt')) && readFileSync(join(dir, 'always.txt'), 'utf8').trim().split('\n').length >= 3; }), 'always restarts it even after it ended well');
const never = mk('never', { start: `echo run >> ${join(dir, 'never.txt')}; exit 1`, restart: 'no' });
await objectAction(never.id, 'start'); await sleep(900); await st(never.id); await sleep(500); await st(never.id);
check(readFileSync(join(dir, 'never.txt'), 'utf8').trim().split('\n').length === 1 && (await st(never.id)).status === 'error', 'with no policy a failure stays a failure');

// the wait grows
const stamps: number[] = [];
const grow = mk('grows', { start: `echo $(date +%s%N) >> ${join(dir, 'grow.txt')}; exit 1`, restart: 'on-failure', maxRestarts: 4 });
await objectAction(grow.id, 'start');
await until(async () => { await st(grow.id); return existsSync(join(dir, 'grow.txt')) && readFileSync(join(dir, 'grow.txt'), 'utf8').trim().split('\n').length >= 5; }, 20000);
const ts = readFileSync(join(dir, 'grow.txt'), 'utf8').trim().split('\n').map((x) => Number(x) / 1e6);
const gaps = ts.slice(1).map((t, i) => Math.round(t - ts[i]));
check(gaps.length >= 3 && gaps[2] > gaps[0] * 1.5, `the wait between restarts gets longer (${gaps.join(' → ')} ms)`);
for (const o of [fails, clean, always, never, grow]) await removeObject(o.id);

// ---------------------------------------------------------------- health
let status = 200;
const web = createServer((_q, r) => { r.statusCode = status; r.end('x'); }); await new Promise<void>((r) => web.listen(0, '127.0.0.1', r)); const wport = (web.address() as any).port;
const health = mk('healthy', { start: 'sleep 300', health: { kind: 'http', target: `http://127.0.0.1:${wport}/`, intervalSec: 2, retries: 2, timeoutSec: 1 } });
await objectAction(health.id, 'start'); await sleep(500);
check((await st(health.id)).status === 'running', 'a server whose health check passes is running');
status = 500;
check(await until(async () => (await st(health.id)).status === 'error' && /unhealthy.*500/.test((await st(health.id)).detail ?? ''), 12000), 'when the check keeps failing it becomes an error that says why');
status = 200;
check(await until(async () => (await st(health.id)).status === 'running', 12000), 'and it is running again when the check passes');
await removeObject(health.id);

const cmdFlag = join(dir, 'ok.flag');
const byCmd = mk('by-command', { start: 'sleep 300', health: { kind: 'command', target: `test -f ${cmdFlag}`, intervalSec: 2, retries: 1 } });
await objectAction(byCmd.id, 'start'); await sleep(300);
check(await until(async () => /exited with 1/.test((await st(byCmd.id)).detail ?? ''), 8000), 'a command check that fails makes it unhealthy');
writeFileSync(cmdFlag, '1');
check(await until(async () => (await st(byCmd.id)).status === 'running', 8000), 'and it recovers when the command succeeds');
await removeObject(byCmd.id);

const tcpSrv = tcp(); await new Promise<void>((r) => tcpSrv.listen(0, '127.0.0.1', r)); const tport = (tcpSrv.address() as any).port;
const byTcp = mk('by-tcp', { start: 'sleep 300', health: { kind: 'tcp', target: String(tport), intervalSec: 2, retries: 1 } });
await objectAction(byTcp.id, 'start'); await sleep(300);
check((await st(byTcp.id)).status === 'running', 'a tcp check that connects keeps it running');
tcpSrv.close();
check(await until(async () => /nothing answers/.test((await st(byTcp.id)).detail ?? ''), 8000), 'and one that no longer connects makes it unhealthy');
await removeObject(byTcp.id);

const restarting = mk('self-heals', { start: `echo run >> ${join(dir, 'heal.txt')}; sleep 300`, restart: 'on-failure', maxRestarts: 2, health: { kind: 'command', target: `test -f ${join(dir, 'heal.ok')}`, intervalSec: 2, retries: 1, restartWhenUnhealthy: true } });
await objectAction(restarting.id, 'start');
check(await until(async () => { await st(restarting.id); return existsSync(join(dir, 'heal.txt')) && readFileSync(join(dir, 'heal.txt'), 'utf8').trim().split('\n').length >= 3; }, 20000), 'restart-when-unhealthy restarts it, up to the limit');
check(await until(async () => /gave up after 2/.test((await st(restarting.id)).detail ?? ''), 10000), 'and then it stays unhealthy and says it gave up');
await removeObject(restarting.id);
web.close();

// ---------------------------------------------------------------- log size and the stop timeout
const chatty = mk('chatty', { start: 'yes "0123456789012345678901234567890123456789012345678901234567890123456789" | head -c 400000; sleep 300', logMaxMb: 0.1 });
await objectAction(chatty.id, 'start'); await sleep(800); await st(chatty.id);
const logFile = join(DATA_DIR, 'objects', `${chatty.id}.log`);
check(existsSync(`${logFile}.1`) && statSync(logFile).size < 120_000, 'a log over its size is set aside (.log.1) and the file starts again');
check((await objectLogs(chatty.id, { tail: 20 })).text.length > 0, 'and the logs can still be read');
await removeObject(chatty.id);
const stubborn = mk('stubborn-fast', { start: `sh -c 'trap "" TERM; while true; do sleep 1; done'`, stopTimeoutSec: 1 });
await objectAction(stubborn.id, 'start'); await sleep(400);
const t0 = Date.now(); await objectAction(stubborn.id, 'stop');
check(Date.now() - t0 < 3500 && (await st(stubborn.id)).status === 'stopped', `a short stop timeout kills a stubborn process sooner (${Date.now() - t0} ms)`);
await removeObject(stubborn.id);
check(await rejects(() => mk('bad-restart', { start: 'x', restart: 'sometimes' }), /restart policy/), 'an unknown restart policy is refused');
check(await rejects(() => mk('bad-health', { start: 'x', health: { kind: 'http', target: 'nope' } }), /http/), 'a health URL that is not http(s) is refused');
check(await rejects(() => mk('bad-tcp', { start: 'x', health: { kind: 'tcp', target: 'x;y' } }), /port/), 'a bad tcp target is refused');

// ---------------------------------------------------------------- docker settings
const image = process.env.HIVE_TEST_IMAGE ?? 'nginx:1.25-alpine';
const haveImage = spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status === 0;
if (!haveImage) console.log(`SKIP  docker settings (docker or ${image} not available)`);
else {
  const inspect = (name: string, f: string) => execFileSync('docker', ['inspect', '-f', f, name], { encoding: 'utf8' }).trim();
  const c = createObject({ name: 'limited', kind: 'docker', config: { mode: 'container', image, memory: '64m', cpus: 0.5, logMaxMb: 1, stopTimeoutSec: 3, network: 'bridge' } });
  const cname = `hive-am-${c.id.slice(0, 8)}`;
  try {
    await objectAction(c.id, 'start');
    check(inspect(cname, '{{.HostConfig.Memory}}') === String(64 * 1024 * 1024) && inspect(cname, '{{.HostConfig.NanoCpus}}') === '500000000', 'memory and CPU limits are applied to the container');
    check(inspect(cname, '{{index .HostConfig.LogConfig.Config "max-size"}}') === '1024k' && inspect(cname, '{{.HostConfig.LogConfig.Config}}').includes('max-file:3'), 'its log size is limited');
    check(inspect(cname, '{{.Config.StopTimeout}}') === '3', 'and so is the time it gets to stop');
    const id0 = inspect(cname, '{{.Id}}');
    await objectAction(c.id, 'restart');
    check(inspect(cname, '{{.Id}}') === id0, 'restarting with the same settings keeps the same container');
    updateObject(c.id, { config: { mode: 'container', image, memory: '96m', cpus: 0.5, logMaxMb: 1, stopTimeoutSec: 3, network: 'bridge' } });
    await objectAction(c.id, 'restart');
    check(inspect(cname, '{{.HostConfig.Memory}}') === String(96 * 1024 * 1024) && inspect(cname, '{{.Id}}') !== id0, 'changing a setting creates the container again, with the new value');
    const t1 = Date.now(); await objectAction(c.id, 'stop');
    check((await st(c.id)).status === 'stopped', 'stop works with a timeout set');
  } finally { await removeObject(c.id); }
  check(spawnSync('docker', ['inspect', cname], { stdio: 'ignore' }).status !== 0, 'deleting it removes the container');
  check(await rejects(() => createObject({ name: 'bad-mem', kind: 'docker', config: { mode: 'container', image, memory: 'lots' } }), /memory/), 'a bad memory limit is refused');
  check(await rejects(() => createObject({ name: 'bad-net', kind: 'docker', config: { mode: 'container', image, network: '--privileged' } }), /network/), 'a network name that looks like an option is refused');
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
