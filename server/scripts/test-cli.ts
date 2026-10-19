// The launcher (`bin/hive-am.mjs`): start in the background, status, logs, stop and restart, with stand-ins for the two processes of the app
// (`HIVE_AM_LAUNCHER_CHILDREN`) and free ports of its own, so it never touches a real hive-am. Needs no model.
//   HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-cli.ts
import './_guard.js';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, '..', '..', 'bin', 'hive-am.mjs');
const runPath = join(here, '..', '..', 'bin', 'run.mjs');
const run: any = await import(runPath);

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise<number>((res) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => res(p)); }); });

const webPort = await freePort(), apiPort = await freePort();
// The stand-ins: the "server" listens on the API port and the "web UI" on the web port; both print a line a second and leave on SIGTERM.
const stand = (port: number, name: string) => ['node', '-e', `require('net').createServer().listen(${port},'127.0.0.1');console.log('${name} up');setInterval(()=>console.log('${name} tick'),1000);process.on('SIGTERM',()=>process.exit(0))`];
const env = { ...process.env, HIVE_AM_WEB_PORT: String(webPort), HIVE_AM_LAUNCHER_API_PORT: String(apiPort), HIVE_AM_LAUNCHER_CHILDREN: JSON.stringify([stand(apiPort, 'api'), stand(webPort, 'web')]) };
delete (env as any).HIVE_AM_PORT;
const hive = (...a: string[]) => { const r = spawnSync(process.execPath, [bin, ...a], { env, encoding: 'utf8', timeout: 60_000 }); return { code: r.status, out: `${r.stdout}${r.stderr}` }; };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const state = () => run.readState();

// ---- the help and the argument handling ----
const help = hive('--help');
check(help.code === 0 && ['start --background', 'status', 'logs', 'stop', 'restart'].every((w) => help.out.includes(w)), '--help lists the five commands');
check(hive('frobnicate').code === 1 && /Unknown command/.test(hive('frobnicate').out), 'an unknown command is an error');

// ---- nothing recorded ----
let r = hive('status');
check(r.code === 1 && /not running/.test(r.out), 'status with no record says not running and exits 1');
r = hive('stop');
check(r.code === 1 && /not running/.test(r.out), 'stop with nothing to stop exits 1');

// ---- a stale record is reported, never followed ----
const dead = (() => { const c = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']); return Number(c.stdout.toString()); })();
mkdirSync(run.runDir(), { recursive: true });
writeFileSync(run.stateFile(), JSON.stringify({ pid: dead, stamp: '1', mode: 'background', startedAt: Date.now(), webPort, apiPort, log: null }));
r = hive('status');
check(r.code === 1 && /stale/.test(r.out), 'a record whose process is gone is reported as stale');
r = hive('stop');
check(r.code === 1 && /stale/.test(r.out) && !existsSync(run.stateFile()), 'stop refuses a stale record and removes it');

// a pid that the system gave to something else is never signalled
const bystander = spawn('sleep', ['60'], { stdio: 'ignore' });
writeFileSync(run.stateFile(), JSON.stringify({ pid: bystander.pid, stamp: 'not-its-start-time', mode: 'background', startedAt: Date.now(), webPort, apiPort, log: null }));
r = hive('stop');
await sleep(300);
check(r.code === 1 && /different process/.test(r.out) && alive(bystander.pid!), 'a live pid with another start time is reported and left alone');
bystander.kill('SIGKILL');

// ---- the stamp rule ----
check(run.isAlive(process.pid, run.processStamp(process.pid)) && !run.isAlive(dead, null), 'our own pid is alive and a collected pid is not');
check(!run.isAlive(process.pid, 'someone-else'), 'a live pid with a different stamp is not the same process');

// ---- rotation ----
const big = join(run.runDir(), 'rot.log');
writeFileSync(big, Buffer.alloc(2048, 97));
check(run.rotateLog(big, 1024) === true && statSync(big).size === 0 && statSync(`${big}.1`).size === 2048, 'a log over the limit is moved to .1 and emptied');
check(run.rotateLog(big, 1024) === false, 'a log under the limit is left alone');

// ---- start in the background ----
writeFileSync(run.logFile(), Buffer.alloc(run.LOG_MAX + 1024, 98));            // a log from an earlier run, over the limit
const t0 = Date.now();
r = hive('start', '--background');
const took = Date.now() - t0;
const s = state();
check(r.code === 0 && took < 15_000 && s && s.mode === 'background', `start --background returns (${took} ms) and records a background run`);
check(!!s && alive(s.pid) && s.stamp === run.processStamp(s.pid), 'the record holds a live pid with its start time');
check(/log/.test(r.out) && r.out.includes(run.logFile()) && /hive-am stop/.test(r.out), 'it says where the log is and how to stop it');
check(existsSync(`${run.logFile()}.1`) && statSync(run.logFile()).size < 4096, 'the log of the earlier run was set aside when the launcher started');
await sleep(1500);

r = hive('status');
check(r.code === 0 && r.out.includes(`pid ${s.pid}`) && /web .* up/.test(r.out) && /api .* up/.test(r.out), 'status finds the same pid and sees both ports answer');

const log = readFileSync(run.logFile(), 'utf8');
check(/api up/.test(log) && /web up/.test(log), 'the log holds the output of both processes');
const version = JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')).version;
check(readFileSync(run.logFile(), 'utf8').trimStart().startsWith(`hive-am ${version}`) && log.includes(`web   http://127.0.0.1:${webPort}`) && log.includes('hive-am stop'), 'the log opens with a welcome: the version, the addresses and how to stop it');
check(hive('status').out.includes(`v${version}`), 'status says which version the run is');
check(hive('version').out.trim() === version && hive('--version').out.trim() === version, 'version and --version print the version');
r = hive('logs', '-n', '2');
check(r.code === 0 && r.out.trim().split('\n').length <= 2 && /tick|up/.test(r.out), 'logs -n 2 returns the last two lines');
const cur = run.readLog({ tail: 1 }).cursor;
await sleep(1300);
const more = run.readLog({ after: cur });
check(/tick/.test(more.text) && more.cursor > cur, 'reading by cursor returns what was written after');
const follower = spawn(process.execPath, [bin, 'logs', '-f', '-n', '1'], { env });
let followed = ''; follower.stdout.on('data', (d) => { followed += d; });
await sleep(2600);
follower.kill('SIGINT');
check(/tick/.test(followed), 'logs -f keeps printing what the run writes');

// ---- a second start refuses ----
r = hive('start', '--background');
check(r.code === 1 && r.out.includes(`pid ${s.pid}`) && state()?.pid === s.pid, 'a second start refuses and names the running pid');
r = hive('start');
check(r.code === 1 && /already running/.test(r.out), 'so does a foreground start');

// ---- restart keeps the mode ----
r = hive('restart');
const s2 = state();
check(r.code === 0 && !!s2 && s2.pid !== s.pid && s2.mode === 'background' && alive(s2.pid) && !alive(s.pid), 'restart replaces the process and stays in the background');
await sleep(500);

// ---- stop waits for the app to be gone ----
const kids = await Promise.all([run.portOpen(webPort), run.portOpen(apiPort)]);
check(kids[0] && kids[1], 'both ports answer before the stop');
r = hive('stop');
const stillThere = await Promise.all([run.portOpen(webPort), run.portOpen(apiPort)]);
check(r.code === 0 && /stopped/.test(r.out) && !alive(s2.pid) && !existsSync(run.stateFile()), 'stop ends the run and removes the record');
check(!stillThere[0] && !stillThere[1], 'and by the time it reports, nothing listens on either port');
r = hive('status');
check(r.code === 1 && /not running/.test(r.out), 'status then says not running');

// ---- a foreground run is recorded too ----
const fg = spawn(process.execPath, [bin], { env, stdio: 'ignore' });
let fgState = null as any;
for (let i = 0; i < 60 && !fgState; i++) { await sleep(100); const st = state(); if (st && st.pid === fg.pid) fgState = st; }
check(!!fgState && fgState.mode === 'foreground', 'a run in the terminal writes its record too');
r = hive('logs');
check(r.code === 0 && /terminal/.test(r.out), 'logs says a foreground run has no log file and where its output is');
r = hive('status');
check(r.code === 0 && /foreground/.test(r.out), 'status works on it');
const exited = new Promise<number | null>((res) => fg.on('exit', (c) => res(c)));
r = hive('stop');
const code = await Promise.race([exited, sleep(10_000).then(() => 'timeout')]);
check(r.code === 0 && code === 0 && !existsSync(run.stateFile()), 'stop ends a foreground run and its record goes with it');


// ---- update: the npm of the stand-in decides what is "latest", and records what it was asked to install ----
const npmLog = join(run.runDir(), 'npm.log');
const fakeNpm = join(run.runDir(), 'fake-npm.sh');
writeFileSync(fakeNpm, `#!/bin/sh\ncase "$1" in view) [ -n "$STUB_LATEST" ] && echo "$STUB_LATEST" || exit 1;; root) echo /nowhere;; install) echo "$@" >> "${npmLog}";; esac\n`);
chmodSync(fakeNpm, 0o755);
const updateEnv = (latest: string, install = 'global') => ({ ...env, HIVE_AM_NPM: fakeNpm, STUB_LATEST: latest, HIVE_AM_LAUNCHER_INSTALL: install });
const upd = (e: NodeJS.ProcessEnv, ...a: string[]) => { const x = spawnSync(process.execPath, [bin, 'update', ...a], { env: e, encoding: 'utf8', timeout: 60_000 }); return { code: x.status, out: `${x.stdout}${x.stderr}` }; };
const installs = () => (existsSync(npmLog) ? readFileSync(npmLog, 'utf8').trim().split('\n').filter(Boolean) : []);

let u = upd(updateEnv(version));
check(u.code === 0 && /up to date/.test(u.out) && installs().length === 0, 'update with nothing newer says up to date and installs nothing');
u = upd(updateEnv('99.0.0'), '--check');
check(u.code === 0 && /update is available/.test(u.out) && u.out.includes('99.0.0') && installs().length === 0, 'update --check reports a newer version and installs nothing');
u = upd(updateEnv('99.0.0', 'npx'));
check(u.code === 1 && /npx/.test(u.out) && installs().length === 0, 'a copy run through npx is told to use npx hive-am@latest');
u = upd(updateEnv('99.0.0', 'source'));
check(u.code === 1 && /source checkout/.test(u.out) && installs().length === 0, 'a source checkout is told to use git');
u = upd(updateEnv(''));
check(u.code === 1 && /Could not ask npm/.test(u.out), 'an unreachable registry is an error, not a crash');
u = upd(updateEnv('99.0.0'));
check(u.code === 0 && /updated/.test(u.out) && installs().join('|') === 'install -g hive-am@99.0.0', 'update installs exactly the version it found, globally');

// with a run going: it says the run is on the old version, and --restart replaces it
r = hive('start', '--background');
const before = state();
u = upd(updateEnv('99.0.0'));
check(u.code === 0 && u.out.includes(`pid ${before.pid}`) && /hive-am restart/.test(u.out) && state()?.pid === before.pid, 'with a run going, update says it still runs the old version and leaves it alone');
u = upd(updateEnv('99.0.0'), '--restart');
const after = state();
check(u.code === 0 && !!after && after.pid !== before.pid && alive(after.pid) && !alive(before.pid), 'update --restart restarts the run on the new files');
hive('stop');

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
