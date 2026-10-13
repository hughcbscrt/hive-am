import { spawn } from 'node:child_process';
import { appendFileSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, truncateSync, unlinkSync, writeFileSync, readSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { DATA_DIR } from '../db.js';
import { isAlive, processStamp } from '../watch.js';
import { ObjectError, type ObjectState, type ServerConfig } from './model.js';

/**
 * A server object is a shell command that hive-am keeps running. It starts in its own process group with its output going straight to a
 * log file, so it survives hive-am restarts: afterwards the process is found again by the pid and start time saved next to the log.
 * Stopping signals the whole group (the shell, `npm`, `node`…): first politely, then for good.
 */
const DIR = join(DATA_DIR, 'objects');
const LOG_MAX = 5 * 1024 * 1024;       // a bigger log is set aside when the object starts (and while it runs: see rotateLog)
const logMaxBytes = (cfg: ServerConfig) => Math.round((cfg.logMaxMb ?? 5) * 1024 * 1024) || LOG_MAX;
const STOP_GRACE_MS = Number(process.env.HIVE_AM_OBJECT_STOP_MS) || 8000;
const STARTING_MS = 120_000;           // with a port: how long "starting" is believed before it counts as stopped working

export interface Saved { pid: number; stamp: string | null; startedAt: number; /** the user asked for it to stop */ stopped?: boolean; exit?: { code: number | null; signal: string | null; at: number } }

const files = (id: string) => ({ log: join(DIR, `${id}.log`), state: join(DIR, `${id}.json`) });
export const readSaved = (id: string): Saved | null => read(id);
const read = (id: string): Saved | null => { try { return JSON.parse(readFileSync(files(id).state, 'utf8')); } catch { return null; } };
const write = (id: string, s: Saved) => { mkdirSync(DIR, { recursive: true }); writeFileSync(files(id).state, JSON.stringify(s)); };
/** A line in the object's log, marked as coming from hive-am (who asked for what, how it ended). */
export const noteServer = (id: string, text: string) => note(id, text);
const note = (id: string, text: string) => { try { mkdirSync(DIR, { recursive: true }); appendFileSync(files(id).log, `\n[hive-am] ${text}\n`); } catch { /* the log is a convenience */ } };

const listening = (port: number) => new Promise<boolean>((resolve) => {
  const s = connect({ port, host: '127.0.0.1' }, () => { s.destroy(); resolve(true); });
  s.setTimeout(800, () => { s.destroy(); resolve(false); });
  s.on('error', () => resolve(false));
});

/** The saved pid, only while it is still the same process we started. */
function livePid(id: string): { saved: Saved; alive: boolean } | null {
  const saved = read(id); if (!saved) return null;
  return { saved, alive: isAlive(saved.pid, saved.stamp) };
}

export async function serverState(id: string, cfg: ServerConfig): Promise<ObjectState> {
  const cur = livePid(id);
  if (!cur) return { status: 'stopped' };
  if (cur.alive) {
    const since = cur.saved.startedAt;
    if (cfg.port && !(await listening(cfg.port))) return Date.now() - since < STARTING_MS ? { status: 'starting', pid: cur.saved.pid, since, detail: `waiting for port ${cfg.port}` } : { status: 'error', pid: cur.saved.pid, since, detail: `running, but nothing listens on port ${cfg.port}` };
    return { status: 'running', pid: cur.saved.pid, since };
  }
  const x = cur.saved.exit;
  if (cur.saved.stopped || !x || x.code === 0) return { status: 'stopped', since: x?.at };
  return { status: 'error', since: x.at, detail: x.signal ? `ended by ${x.signal}` : `exited with code ${x.code}` };
}

export async function startServer(id: string, cfg: ServerConfig): Promise<void> {
  const cur = livePid(id);
  if (cur?.alive) throw new ObjectError('It is already running');
  if (!existsSync(cfg.cwd)) throw new ObjectError(`The folder ${cfg.cwd} does not exist`);
  mkdirSync(DIR, { recursive: true });
  const { log } = files(id);
  try { if (statSync(log).size > logMaxBytes(cfg)) renameSync(log, `${log}.1`); } catch { /* no log yet */ }
  note(id, `▶ ${cfg.start}   (${new Date().toLocaleString()})`);
  const fd = openSync(log, 'a');
  try {
    const child = spawn('sh', ['-c', cfg.start], { cwd: cfg.cwd, env: { ...process.env, ...cfg.env }, detached: true, stdio: ['ignore', fd, fd] });
    if (!child.pid) throw new ObjectError('The command could not be started');
    const pid = child.pid, startedAt = Date.now();
    write(id, { pid, stamp: processStamp(pid), startedAt });
    child.on('error', (e) => { note(id, `could not start: ${e.message}`); write(id, { pid, stamp: null, startedAt, exit: { code: 127, signal: null, at: Date.now() } }); });
    child.on('exit', (code, signal) => {
      const saved = read(id); if (!saved || saved.pid !== pid) return;
      write(id, { ...saved, exit: { code, signal, at: Date.now() } });
      note(id, signal ? `■ ended by ${signal}` : `■ exited with code ${code}`);
    });
    child.unref();
  } finally { closeSync(fd); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const killGroup = (pid: number, sig: NodeJS.Signals) => { try { process.kill(-pid, sig); } catch { try { process.kill(pid, sig); } catch { /* already gone */ } } };

export async function stopServer(id: string, cfg: ServerConfig): Promise<void> {
  const cur = livePid(id);
  if (!cur) return;
  write(id, { ...cur.saved, stopped: true });
  if (cfg.stop) {
    note(id, `■ ${cfg.stop}`);
    const fd = openSync(files(id).log, 'a');
    try {
      await new Promise<void>((resolve) => {
        const c = spawn('sh', ['-c', cfg.stop!], { cwd: cfg.cwd, env: { ...process.env, ...cfg.env }, stdio: ['ignore', fd, fd] });
        const t = setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* done */ } resolve(); }, 30_000);
        c.on('exit', () => { clearTimeout(t); resolve(); }); c.on('error', () => { clearTimeout(t); resolve(); });
      });
    } finally { closeSync(fd); }
  }
  if (!isAlive(cur.saved.pid, cur.saved.stamp)) return;
  killGroup(cur.saved.pid, 'SIGTERM');
  const grace = cfg.stopTimeoutSec ? cfg.stopTimeoutSec * 1000 : STOP_GRACE_MS;
  for (let waited = 0; waited < grace && isAlive(cur.saved.pid, cur.saved.stamp); waited += 150) await sleep(150);
  if (isAlive(cur.saved.pid, cur.saved.stamp)) { note(id, 'did not stop in time: killing it'); killGroup(cur.saved.pid, 'SIGKILL'); for (let i = 0; i < 20 && isAlive(cur.saved.pid, cur.saved.stamp); i++) await sleep(100); }
}

/** Lines the object printed. `after` is a byte offset from an earlier call; without it the last `tail` lines come back. */
export function serverLogs(id: string, o: { tail?: number; after?: number }): { text: string; cursor: string; reset?: boolean } {
  const { log } = files(id);
  let size = 0; try { size = statSync(log).size; } catch { return { text: '', cursor: '0' }; }
  const MAX = 256 * 1024;
  let from: number, reset = false;
  if (o.after !== undefined && Number.isFinite(o.after)) {
    if (o.after > size) { from = Math.max(0, size - MAX); reset = true; }      // the file was cut or replaced
    else from = Math.max(o.after, size - MAX);
  } else from = Math.max(0, size - Math.max(1, Math.min(o.tail ?? 300, 5000)) * 200);
  const len = size - from;
  if (len <= 0) return { text: '', cursor: String(size) };
  const buf = Buffer.alloc(len);
  const fd = openSync(log, 'r');
  try { readSync(fd, buf, 0, len, from); } finally { closeSync(fd); }
  let text = buf.toString('utf8');
  if (o.after === undefined) {
    const lines = text.split('\n');
    if (from > 0) lines.shift();                                                 // the first line may be cut in half
    text = lines.slice(-Math.max(1, Math.min(o.tail ?? 300, 5000))).join('\n');
  }
  return { text, cursor: String(size), reset: reset || undefined };
}

/** Removes the log and the saved state of a deleted object. */
export function forgetServer(id: string): void {
  const { log, state } = files(id);
  for (const f of [log, `${log}.1`, state]) { try { unlinkSync(f); } catch { /* none */ } }
}

/**
 * Keeps the log from growing for ever while the server runs. The process writes with O_APPEND to its own file, so the old part is copied
 * aside and the file is emptied in place (a few lines printed in between can be lost; it is a log, not a ledger).
 */
export function rotateLog(id: string, cfg: ServerConfig): boolean {
  const { log } = files(id);
  try {
    if (statSync(log).size <= logMaxBytes(cfg)) return false;
    copyFileSync(log, `${log}.1`); truncateSync(log, 0);
    note(id, `log rotated: the earlier part is in ${id}.log.1`);
    return true;
  } catch { return false; }
}
