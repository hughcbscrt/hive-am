import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { agents, db, resolved } from './db.js';
import { liveOrigin, liveSource } from './runtime.js';
import { adapterFor } from './connections/manager.js';
import { connections, threadMessages, threads } from './connections/store.js';
import { deliverTo } from './wake.js';

/**
 * "Tell me the moment it finishes." The agent starts a long command in the background itself (`nohup … > log 2>&1 &`) and asks hive-am to
 * watch its process: when it ends (or a marker file appears, or the waiting time runs out) the agent is woken in the same place where it
 * was asked, to read the result and report. hive-am only checks that a process is alive; it never runs anything. A job on another machine
 * works too when it is started through a local `ssh`, which lives as long as the remote command does.
 */
export class WatchError extends Error {}

const POLL_MS = Number(process.env.HIVE_AM_WATCH_POLL_MS) || 1500;
const MS_PER_MINUTE = Number(process.env.HIVE_AM_WAKE_MS_PER_MINUTE) || 60_000;
export const WATCH_DEFAULT_MINUTES = 120, WATCH_MAX_MINUTES = 240, WATCH_MAX_PENDING = 5;

db.exec(`
CREATE TABLE IF NOT EXISTS agent_watches (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  connection_id TEXT, thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,
  pid INTEGER NOT NULL, pid_stamp TEXT, file TEXT, log TEXT, note TEXT NOT NULL,
  started_at INTEGER NOT NULL, deadline INTEGER NOT NULL, req_id TEXT, req_name TEXT
);`);

export interface Watch {
  id: string; agent_id: string; connection_id: string | null; thread_id: string | null; pid: number; pid_stamp: string | null; file: string | null; log: string | null;
  note: string; started_at: number; deadline: number; req_id: string | null; req_name: string | null;
}
const rows = {
  all: () => db.prepare('SELECT * FROM agent_watches ORDER BY started_at').all() as Watch[],
  forAgent: (agentId: string) => db.prepare('SELECT * FROM agent_watches WHERE agent_id=?').all(agentId) as Watch[],
  remove: (id: string) => db.prepare('DELETE FROM agent_watches WHERE id=?').run(id).changes > 0,
  add(w: Omit<Watch, 'id'>): Watch {
    const row: Watch = { ...w, id: randomUUID() };
    db.prepare('INSERT INTO agent_watches (id,agent_id,connection_id,thread_id,pid,pid_stamp,file,log,note,started_at,deadline,req_id,req_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(row.id, row.agent_id, row.connection_id, row.thread_id, row.pid, row.pid_stamp, row.file, row.log, row.note, row.started_at, row.deadline, row.req_id, row.req_name);
    return row;
  },
};

/** An identifier of "this very process" (its start time), so that a PID the system reuses for something else is not mistaken for the job. null = not running. */
export function processStamp(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return rest[0] === 'Z' || rest[0] === 'X' ? null : rest[19] ?? null;     // a finished job nobody has collected yet (zombie) is finished
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT' || existsSync('/proc/self')) return null;   // Linux: no such process
  }
  try {                                                                      // macOS and others
    const out = execFileSync('ps', ['-o', 'stat=,lstart=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!out || out.startsWith('Z')) return null;
    return out.replace(/^\S+\s+/, '');
  } catch { return null; }
}
export const isAlive = (pid: number, stamp: string | null) => { const s = processStamp(pid); return s !== null && (stamp === null || s === stamp); };

/** How long it took, in plain words. */
const took = (since: number) => { const s = Math.max(1, Math.round((Date.now() - since) / 1000)); return s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h` };
const hhmm = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const inside = (child: string, root: string) => child === root || child.startsWith(root.endsWith(sep) ? root : root + sep);

export interface WatchInput { pid?: unknown; file?: unknown; log?: unknown; note?: unknown; max_minutes?: unknown }
export function createWatch(agentId: string, input: WatchInput): { id: string; until: string; where: 'thread' | 'chat'; reused: boolean } {
  const agent = agents.get(agentId);
  if (!agent) throw new WatchError('Unknown agent');
  if (liveSource(agentId) === 'dispatch') throw new WatchError('Waiting for a process is not available while you work on a task delegated by an orchestrator.');
  const note = String(input.note ?? '').trim();
  if (!note) throw new WatchError('Say in the note what to check and report when it finishes.');
  if (note.length > 400) throw new WatchError('The note is too long (400 characters at most).');
  const pid = Number(input.pid);
  if (!Number.isInteger(pid) || pid < 2) throw new WatchError('pid must be the number of the process to wait for (for example the output of `echo $!` right after starting it in the background).');
  if (pid === process.pid || pid === process.ppid) throw new WatchError('That is not the process you started.');
  const stamp = processStamp(pid);
  if (stamp === null) throw new WatchError(`Process ${pid} is not running (it may have finished already): look at its result now instead of waiting.`);
  let file: string | null = null;
  if (input.file !== undefined && input.file !== null && String(input.file).trim() !== '') {
    const cwd = resolved(agent).cwd;
    const p = resolve(isAbsolute(String(input.file)) ? String(input.file) : join(cwd, String(input.file)));
    if (![cwd, tmpdir(), homedir()].filter(Boolean).some((r) => inside(p, resolve(r)))) throw new WatchError('The marker file must be inside your working folder, your home folder or the temp folder.');
    file = p;
  }
  const log = input.log === undefined || input.log === null || String(input.log).trim() === '' ? null : String(input.log).trim().slice(0, 300);
  const minutes = input.max_minutes === undefined || input.max_minutes === null ? WATCH_DEFAULT_MINUTES : Number(input.max_minutes);
  if (!(minutes >= 1 && minutes <= WATCH_MAX_MINUTES)) throw new WatchError(`max_minutes must be between 1 and ${WATCH_MAX_MINUTES}.`);
  const origin = liveOrigin(agentId), thread = origin ? threads.get(origin.threadId) : undefined;
  if (origin && !thread) throw new WatchError('The thread no longer exists.');
  const mine = rows.forAgent(agentId);
  const same = mine.find((w) => w.pid === pid && w.pid_stamp === stamp);
  if (same) return { id: same.id, until: hhmm(same.deadline), where: same.thread_id ? 'thread' : 'chat', reused: true };
  if (mine.length >= WATCH_MAX_PENDING) throw new WatchError(`You are already waiting for ${WATCH_MAX_PENDING} processes. Wait for one to finish.`);
  const now = Date.now();
  const w = rows.add({
    agent_id: agentId, connection_id: origin?.connectionId ?? null, thread_id: thread?.id ?? null, pid, pid_stamp: stamp, file, log, note, started_at: now, deadline: now + minutes * MS_PER_MINUTE,
    req_id: origin?.group && origin.userId ? origin.userId : null, req_name: origin?.group && origin.userId ? origin.userName : null,
  });
  poll.ensure();
  return { id: w.id, until: hhmm(w.deadline), where: thread ? 'thread' : 'chat', reused: false };
}

type Reason = 'ended' | 'file' | 'timeout';
function text(w: Watch, reason: Reason, replyTool?: string): string {
  const dur = took(w.started_at);
  const who = w.req_name ? `hive-am mentions ${w.req_name} at the start of your first reply, so do not mention them yourself. ` : '';
  const how = `tell the person${replyTool ? ` with ${replyTool}` : ''}`;
  const logLine = w.log ? ` Its output is in ${w.log}.` : '';
  if (reason === 'timeout') {
    return `You were waiting for the process ${w.pid}${w.req_name ? ` (asked by ${w.req_name})` : ''}, and after ${dur} it is still running.${logLine} Your note: ${w.note}\n\n${who}Look at how it is going (its log) and ${how}. If it is worth waiting longer, call wake_when_done again; otherwise say what you saw.`;
  }
  const what = reason === 'file' ? `The marker file ${w.file} you were waiting for appeared (${dur} after you asked).` : `The process ${w.pid} you were waiting for has ended (${dur} after you asked, at ${hhmm(Date.now())}).`;
  return `${what}${logLine}${w.req_name ? ` Asked by ${w.req_name}.` : ''} Your note: ${w.note}\n\n${who}Look at the result now (read the output or check the outcome) and ${how}: whether it succeeded or failed, with the evidence (the lines that show it). Never paste secrets or a whole log.`;
}

/**
 * The instant the process ends hive-am tells the thread itself, in one line (the agent still has to read the result, which takes it several
 * seconds): "it finished" arrives right away and the agent's report follows. Nothing is sent when the thread is muted or the platform is down.
 */
async function noticeNow(w: Watch, reason: Reason): Promise<void> {
  if (!w.thread_id || reason === 'timeout') return;
  try {
    const conn = connections.get(w.connection_id ?? ''), thread = threads.get(w.thread_id), adapter = conn && adapterFor(conn.id);
    if (!conn || !conn.enabled || !thread || thread.muted || conn.agent_id !== w.agent_id || !adapter) return;
    const dur = took(w.started_at);
    const who = w.req_id && adapter.mention ? `${adapter.mention({ id: w.req_id, name: w.req_name || 'you' })} ` : '';
    const es = conn.config.lang !== 'en';
    const body = reason === 'file'
      ? (es ? `Apareció el archivo que esperabas (${dur}). Reviso el resultado…` : `The file you were waiting for appeared (${dur}). Checking the result…`)
      : (es ? `Terminó el proceso que esperabas (PID ${w.pid}, ${dur}). Reviso el resultado…` : `The process you were waiting for (PID ${w.pid}) has finished (${dur}). Checking the result…`);
    const msg = `🔔 ${who}${body}`;
    const { externalId } = await adapter.send(thread.target, msg);
    threadMessages.record(thread.id, 'out', externalId, { name: agents.get(w.agent_id)?.name }, msg);
  } catch (e) { console.warn(`[watch] the immediate notice failed: ${e instanceof Error ? e.message : e}`); }
}

const firing = new Set<string>();
async function fire(w: Watch, reason: Reason): Promise<void> {
  if (firing.has(w.id)) return;
  firing.add(w.id);
  try {
    await noticeNow(w, reason);
    const out = await deliverTo(w, text(w, reason, 'channel_reply'), `🔔 ${text(w, reason)}`, () => { rows.remove(w.id); });
    if (out === 'dropped') rows.remove(w.id);
  } catch (e) { console.warn(`[watch] telling agent ${agents.get(w.agent_id)?.name ?? w.agent_id} failed: ${e instanceof Error ? e.message : e}`); rows.remove(w.id); }
  finally { firing.delete(w.id); }
}

const poll = {
  timer: null as ReturnType<typeof setInterval> | null,
  ensure() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), POLL_MS);
    this.timer.unref?.();
  },
  tick() {
    const all = rows.all();
    if (all.length === 0 && this.timer) { clearInterval(this.timer); this.timer = null; return; }
    const now = Date.now();
    for (const w of all) {
      if (firing.has(w.id)) continue;
      if (w.file && existsSync(w.file)) void fire(w, 'file');
      else if (!isAlive(w.pid, w.pid_stamp)) void fire(w, 'ended');
      else if (now >= w.deadline) void fire(w, 'timeout');
    }
  },
};

/** Starts watching what was saved before a restart (the jobs themselves keep running without hive-am). */
export function armWatches(): void { if (rows.all().length) poll.ensure(); }
export const pendingWatches = () => rows.all();
export function removeWatch(id: string): boolean { return rows.remove(id); }
export function cancelWatchFor(agentId: string, id: string): boolean {
  const w = rows.forAgent(agentId).find((x) => x.id === id);
  if (!w) throw new WatchError('You are not waiting for anything with that id.');
  return rows.remove(id);
}
