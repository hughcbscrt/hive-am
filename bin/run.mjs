// What the launcher remembers about the app it started: a state file, a log, and the checks that keep it from touching the wrong process.
// Plain JavaScript on purpose, with no import from the server: the launcher has to work when the app is down, when the database is broken
// and when the data folder does not exist yet (importing the server's code would open the database and create the folder).
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const LOG_MAX = 10 * 1024 * 1024;     // a bigger log is set aside when the launcher starts, and while it runs in the background
export const STOP_GRACE_MS = 15_000;         // how long `stop` waits for the app to go before it forces it (the server's own shutdown is bounded to 5 s)

export const dataDir = () => process.env.HIVE_AM_HOME || join(homedir(), '.hive-am');
export const runDir = () => join(dataDir(), 'run');
export const stateFile = () => join(runDir(), 'hive-am.json');
export const logFile = () => join(runDir(), 'hive-am.log');

/** An identifier of "this very process" (its start time), so that a pid the system reuses for something else is not mistaken for the app. null = not running. */
export function processStamp(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return rest[0] === 'Z' || rest[0] === 'X' ? null : rest[19] ?? null;     // a finished process nobody has collected yet (zombie) is finished
  } catch (e) {
    if (e.code !== 'ENOENT' || existsSync('/proc/self')) return null;        // Linux: no such process
  }
  try {                                                                      // macOS and others
    const out = execFileSync('ps', ['-o', 'stat=,lstart=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!out || out.startsWith('Z')) return null;
    return out.replace(/^\S+\s+/, '');
  } catch { return null; }
}
export const isAlive = (pid, stamp) => { const s = processStamp(pid); return s !== null && (stamp == null || s === stamp); };

/** The record of a run, or null. `{ pid, stamp, mode: 'foreground' | 'background', startedAt, webPort, apiPort, log }`. */
export function readState() {
  try {
    const s = JSON.parse(readFileSync(stateFile(), 'utf8'));
    return s && Number.isInteger(s.pid) ? s : null;
  } catch { return null; }
}
export function writeState(s) {
  mkdirSync(runDir(), { recursive: true });
  const tmp = `${stateFile()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, stateFile());
}
/** Removes the record, but only when it is the one of `pid` (a run that ends must not erase the record of the one that replaced it). */
export function removeState(pid) {
  const s = readState();
  if (s && (pid === undefined || s.pid === pid)) rmSync(stateFile(), { force: true });
}

/**
 * What the record says about the app: `none` (no record), `running` (the process in it is alive and is the same one) or `stale`
 * (the pid is gone, or it now belongs to another process: the record is never followed).
 */
export function inspect() {
  const state = readState();
  if (!state) return { kind: 'none' };
  const now = processStamp(state.pid);
  if (now === null) return { kind: 'stale', state, why: `pid ${state.pid} is not running` };
  if (state.stamp && now !== state.stamp) return { kind: 'stale', state, why: `pid ${state.pid} now belongs to a different process` };
  return { kind: 'running', state };
}

/** Whether something accepts connections on a local port. */
export function portOpen(port, host = '127.0.0.1', timeoutMs = 500) {
  return new Promise((resolve) => {
    const s = createConnection({ port: Number(port), host });
    const done = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

/**
 * Keeps the log from growing for ever. The run writes with O_APPEND to its own file, so the old part is copied aside and the file is
 * emptied in place (a few lines printed in between can be lost; it is a log, not a ledger).
 */
export function rotateLog(file = logFile(), max = LOG_MAX) {
  try {
    if (statSync(file).size <= max) return false;
    copyFileSync(file, `${file}.1`); truncateSync(file, 0);
    return true;
  } catch { return false; }
}

/** The lines of the log. `after` is a byte offset from an earlier call; without it the last `tail` lines come back. */
export function readLog({ tail = 200, after, file = logFile() } = {}) {
  let size = 0;
  try { size = statSync(file).size; } catch { return { text: '', cursor: 0 }; }
  const MAX = 256 * 1024;
  const lines = Math.max(1, Math.min(tail, 5000));
  let from, reset = false;
  if (after !== undefined && Number.isFinite(after)) {
    if (after > size) { from = Math.max(0, size - MAX); reset = true; }      // the file was cut or replaced
    else from = Math.max(after, size - MAX);
  } else from = Math.max(0, size - lines * 200);
  const len = size - from;
  if (len <= 0) return { text: '', cursor: size };
  const buf = Buffer.alloc(len);
  const fd = openSync(file, 'r');
  try { readSync(fd, buf, 0, len, from); } finally { closeSync(fd); }
  let text = buf.toString('utf8');
  if (after === undefined) {
    const all = text.split('\n');
    if (from > 0) all.shift();                                               // the first line may be cut in half
    text = all.slice(-lines).join('\n');
  }
  return { text, cursor: size, reset: reset || undefined };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Waits until the process is gone. Returns false when it is still there after `ms`. */
export async function waitGone(pid, stamp, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (!isAlive(pid, stamp)) return true; await sleep(100); }
  return !isAlive(pid, stamp);
}

/** SIGTERM to the launcher (it forwards it to the two processes it owns), then SIGKILL to its whole group when it does not go. */
export async function stopRun(state, graceMs = STOP_GRACE_MS) {
  const { pid, stamp } = state;
  try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  if (await waitGone(pid, stamp, graceMs)) return { forced: false };
  // A background run is its own process group (the launcher is its leader): the group takes the children with it.
  try { process.kill(state.mode === 'background' ? -pid : pid, 'SIGKILL'); } catch { /* gone in between */ }
  await waitGone(pid, stamp, 3000);
  return { forced: true };
}

export const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
