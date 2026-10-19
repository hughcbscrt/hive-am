#!/usr/bin/env node
// hive-am launcher: starts the API server and the web UI from the published package, in this terminal or in the background,
// and stops it, reports on it and shows its log afterwards.
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as run from './run.mjs';

const self = fileURLToPath(import.meta.url);
const root = join(dirname(self), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const args = process.argv.slice(2);

const HELP = `hive-am ${pkg.version}
${pkg.description}

Usage:
  hive-am [start]              start the server (API + WebSocket, port 4400) and the web UI (port 4401) in this terminal
  hive-am start --background   start it detached, with its output in a log file, and return
  hive-am status               say whether it is running, since when and whether its ports answer (exit 1 when it is not)
  hive-am logs [-f] [-n 200]   show the last lines of the log, or follow it
  hive-am stop                 stop it and wait until it is gone
  hive-am restart              stop it and start it again in the same mode (in the background when nothing was recorded)
  hive-am --version            print the version
  hive-am --help               show this help

Environment:
  HIVE_AM_HOME           data folder (default ~/.hive-am); the record and the log of a run are in its run/ folder
  HIVE_AM_WEB_PORT       port of the web UI (default 4401)

The API server always uses port 4400: the packaged UI is built to talk to it.
Requires Node >= ${pkg.engines?.node?.replace('>=', '') ?? '20'} and at least one of the CLIs installed and logged in: claude, opencode, kiro-cli.`;

const COMMANDS = ['start', 'stop', 'status', 'logs', 'restart'];
const fail = (msg, code = 1) => { console.error(msg); process.exit(code); };

if (args.includes('--help') || args.includes('-h')) { console.log(HELP); process.exit(0); }
if (args.includes('--version') || args.includes('-v')) { console.log(pkg.version); process.exit(0); }

const cmd = !args.length || args[0].startsWith('-') ? 'start' : args[0];
const flags = COMMANDS.includes(args[0]) ? args.slice(1) : args;
if (!COMMANDS.includes(cmd) || (args.length && args[0].startsWith('-') && !['--background', '-b', '--foreground'].includes(args[0]))) fail(`Unknown command: ${args[0]}\n\n${HELP}`);

/** `hive-am logs`: `-f` follows, `-n N` (or `-nN`, `--lines N`) is how many lines. */
function logOptions(list) {
  let follow = false, lines = 200;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a === '-f' || a === '--follow') follow = true;
    else if (a === '-n' || a === '--lines') lines = Number(list[++i]);
    else if (/^-n\d+$/.test(a)) lines = Number(a.slice(2));
    else fail(`Unknown option for logs: ${a}\n\n${HELP}`);
  }
  if (!Number.isInteger(lines) || lines < 1) fail('logs: -n needs a number of lines.');
  return { follow, lines };
}
const startOptions = (list) => {
  for (const a of list) if (!['--background', '-b', '--foreground', '--run-background'].includes(a)) fail(`Unknown option for start: ${a}\n\n${HELP}`);
  return { background: list.includes('--background') || list.includes('-b'), detached: list.includes('--run-background') };
};
if (cmd !== 'start' && cmd !== 'logs' && flags.length) fail(`Unknown option for ${cmd}: ${flags[0]}\n\n${HELP}`);

if (process.env.HIVE_AM_PORT && process.env.HIVE_AM_PORT !== '4400') {
  fail('HIVE_AM_PORT is not supported by the packaged build: the UI is built to talk to the API on port 4400.');
}

const webPort = process.env.HIVE_AM_WEB_PORT ?? '4401';
const apiPort = Number(process.env.HIVE_AM_LAUNCHER_API_PORT) || 4400;     // only tests change it: the packaged UI always talks to 4400

/** The two processes of the app. `HIVE_AM_LAUNCHER_CHILDREN` (tests only) replaces them with `[[command, ...args], [command, ...args]]`. */
function specs() {
  if (process.env.HIVE_AM_LAUNCHER_CHILDREN) return JSON.parse(process.env.HIVE_AM_LAUNCHER_CHILDREN).map(([c, ...a]) => ({ cmd: c, args: a, cwd: root }));
  const next = join(dirname(createRequire(import.meta.url).resolve('next/package.json')), 'dist', 'bin', 'next');
  return [
    { cmd: process.execPath, args: [join(root, 'server', 'dist', 'index.js')], cwd: join(root, 'server') },
    { cmd: process.execPath, args: [next, 'start', '-p', webPort, '-H', '127.0.0.1'], cwd: join(root, 'web') },
  ];
}

/** Refuses to start over a run that is already there: names it, or the port something else holds. Returns the message, or null when the way is free. */
async function blocked() {
  const cur = run.inspect();
  if (cur.kind === 'running') return `hive-am is already running (pid ${cur.state.pid}, since ${run.clock(cur.state.startedAt)}). See: hive-am status`;
  for (const [what, port] of [['web UI', webPort], ['API', apiPort]]) {
    if (await run.portOpen(port)) return `Port ${port} (${what}) is already in use by something that is not a recorded hive-am run. Is hive-am running from another data folder or without the launcher?`;
  }
  return null;
}

/** Runs the app in this process until it stops. In the background the output of both children goes to the same log. */
function serve(mode) {
  const children = specs().map((s) => spawn(s.cmd, s.args, { cwd: s.cwd, stdio: 'inherit' }));
  run.writeState({ pid: process.pid, stamp: run.processStamp(process.pid), mode, startedAt: Date.now(), webPort, apiPort, log: mode === 'background' ? run.logFile() : null });
  process.on('exit', () => run.removeState(process.pid));

  let closing = false, code = 0, left = children.length;
  const finish = () => process.exit(code);
  // Stopping waits for the children to be gone (the server closes its database on the way out); a child that does not go is cut off.
  const stop = (c = 0) => {
    if (closing) return;
    closing = true; code = c;
    for (const ch of children) ch.kill('SIGTERM');
    setTimeout(() => { for (const ch of children) ch.kill('SIGKILL'); finish(); }, 8000).unref();
    if (!left) finish();
  };
  for (const c of children) c.on('exit', (exitCode) => {
    left--;
    if (!closing) { console.error('hive-am: a process exited, stopping.'); stop(exitCode ?? 1); }
    if (closing && !left) finish();
  });
  process.on('SIGINT', () => stop(0));
  process.on('SIGTERM', () => stop(0));
  process.on('SIGHUP', () => { if (mode !== 'background') stop(0); });     // a closed terminal ends a foreground run; a background one has none
  if (mode === 'background') setInterval(() => run.rotateLog(), 60_000).unref();
  setTimeout(() => console.log(`\nhive-am is running → http://127.0.0.1:${webPort}  (API on 127.0.0.1:${apiPort})`), 2500).unref();
}

async function start(list) {
  const { background, detached } = startOptions(list);
  const why = await blocked();
  if (why) fail(why);

  if (!background) { serve(detached ? 'background' : 'foreground'); return; }

  run.rotateLog();
  mkdirSync(run.runDir(), { recursive: true });
  const fd = openSync(run.logFile(), 'a');
  // The launcher itself, again, detached and in its own process group: what `stop` signals is the process that owns the two children.
  const child = spawn(process.execPath, [self, 'start', '--run-background'], { detached: true, stdio: ['ignore', fd, fd], env: process.env, cwd: process.cwd() });
  closeSync(fd);
  let gone = false;
  child.on('exit', () => { gone = true; });
  child.unref();
  for (let i = 0; i < 100 && !gone; i++) {
    if (run.readState()?.pid === child.pid) {
      console.log(`hive-am started in the background (pid ${child.pid})\n  web   http://127.0.0.1:${webPort}\n  api   127.0.0.1:${apiPort}\n  log   ${run.logFile()}\n  stop  hive-am stop    (see also: hive-am status, hive-am logs -f)`);
      process.exit(0);
    }
    await run.sleep(100);
  }
  const { text } = run.readLog({ tail: 15 });
  fail(`hive-am did not start in the background.${text ? `\n\nLast lines of ${run.logFile()}:\n${text}` : ''}`);
}

async function stop() {
  const cur = run.inspect();
  if (cur.kind === 'none') fail('hive-am is not running.');
  if (cur.kind === 'stale') { run.removeState(cur.state.pid); fail(`hive-am is not running: its record was stale (${cur.why}). The record was removed and nothing was signalled.`); }
  const { state } = cur;
  const { forced } = await run.stopRun(state);
  if (run.isAlive(state.pid, state.stamp)) fail(`hive-am (pid ${state.pid}) did not stop, even when forced.`);
  run.removeState(state.pid);
  console.log(`hive-am stopped (pid ${state.pid})${forced ? ', after forcing it' : ''}.`);
  process.exit(0);
}

async function status() {
  const cur = run.inspect();
  if (cur.kind === 'none') { console.log('not running'); process.exit(1); }
  if (cur.kind === 'stale') { console.log(`not running (stale record: ${cur.why})`); process.exit(1); }
  const s = cur.state;
  const [web, api] = await Promise.all([run.portOpen(s.webPort), run.portOpen(s.apiPort)]);
  const ports = `web http://127.0.0.1:${s.webPort} ${web ? 'up' : 'not answering'}, api 127.0.0.1:${s.apiPort} ${api ? 'up' : 'not answering'}`;
  console.log(`running (pid ${s.pid}, since ${run.clock(s.startedAt)}, ${s.mode}) ${ports}${web || api ? '' : '\nNothing answers on its ports: it may still be starting, or it is stuck.'}${s.log ? `\nlog ${s.log}` : ''}`);
  process.exit(0);
}

async function logs(list) {
  const { follow, lines } = logOptions(list);
  const cur = run.inspect();
  if (cur.kind === 'running' && cur.state.mode === 'foreground') {
    console.log(`hive-am (pid ${cur.state.pid}) was started in a terminal: its output is shown there, there is no log file for this run.\nTo keep a log, start it with: hive-am start --background`);
    process.exit(0);
  }
  const file = run.logFile();
  if (!existsSync(file)) { console.log('There is no log yet. Start hive-am with: hive-am start --background'); process.exit(0); }
  let { text, cursor } = run.readLog({ tail: lines });
  if (text) console.log(text.replace(/\n$/, ''));
  if (!follow) process.exit(0);
  process.on('SIGINT', () => process.exit(0));
  for (;;) {
    await run.sleep(500);
    const next = run.readLog({ after: cursor });
    if (next.text) process.stdout.write(next.text);
    cursor = next.cursor;
  }
}

async function restart() {
  const cur = run.inspect();
  const mode = cur.state?.mode ?? 'background';
  if (cur.kind === 'running') {
    const { forced } = await run.stopRun(cur.state);
    if (run.isAlive(cur.state.pid, cur.state.stamp)) fail(`hive-am (pid ${cur.state.pid}) did not stop, even when forced.`);
    run.removeState(cur.state.pid);
    console.log(`hive-am stopped (pid ${cur.state.pid})${forced ? ', after forcing it' : ''}.`);
  } else console.log('hive-am was not running.');
  await start(mode === 'background' ? ['--background'] : []);
}

if (cmd === 'start') await start(flags);
else if (cmd === 'stop') await stop();
else if (cmd === 'status') await status();
else if (cmd === 'logs') await logs(flags);
else await restart();
