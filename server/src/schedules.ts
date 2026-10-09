import { randomUUID } from 'node:crypto';
import { agents, db } from './db.js';
import { CronError, minGapMinutes, nextCron, nextRuns, parseCron, serverTimezone, validTimezone } from './cron.js';
import { adapterFor } from './connections/manager.js';
import { deliverScheduled } from './connections/router.js';
import { connections, threads } from './connections/store.js';
import { liveOrigin, liveSource, queueDepth, sendTurn } from './runtime.js';

/**
 * Recurring schedules an agent sets for itself ("every weekday at 9, check the QA logs and tell me"). Like a wake-up, a run reaches the agent
 * in the place where the schedule was made: the same chat thread, or its own web conversation. Cost is bounded: a minimum interval between runs,
 * a limit per agent, no catching up after an outage (a missed run is skipped, never replayed) and no run while the agent is already behind.
 */
export class ScheduleError extends Error {}

const MS_PER_MINUTE = Number(process.env.HIVE_AM_WAKE_MS_PER_MINUTE) || 60_000;      // tests shrink a "minute" (only for "every N minutes")
export const MIN_INTERVAL_MINUTES = Number(process.env.HIVE_AM_SCHEDULE_MIN_MINUTES) || 15;
export const MAX_PER_AGENT = 10;
const MISSED_GRACE_MS = 5 * 60_000;      // a run later than this (the server was down) is skipped
const BUSY_QUEUE = 2;                    // skip a run when this many messages already wait for the agent
const KEEP_RUNS = 50;
const MAX_TIMER_MS = 2_147_483_647;

db.exec(`
CREATE TABLE IF NOT EXISTS agent_schedules (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  connection_id TEXT, thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, expr TEXT NOT NULL, tz TEXT NOT NULL, note TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1, next_due INTEGER, created_at INTEGER NOT NULL,
  last_fired_at INTEGER, fire_count INTEGER NOT NULL DEFAULT 0, last_status TEXT, last_detail TEXT
);
CREATE TABLE IF NOT EXISTS schedule_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, schedule_id TEXT NOT NULL REFERENCES agent_schedules(id) ON DELETE CASCADE,
  fired_at INTEGER NOT NULL, status TEXT NOT NULL, detail TEXT, duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_schedule_runs ON schedule_runs (schedule_id, id);`);
// Who asked (only kept when it was in a group): each run mentions them. Older databases get the columns here.
for (const col of ['req_id TEXT', 'req_name TEXT']) { try { db.exec(`ALTER TABLE agent_schedules ADD COLUMN ${col}`); } catch { /* already there */ } }

export type RunStatus = 'delivered' | 'failed' | 'skipped_muted' | 'skipped_busy' | 'skipped_missed' | 'skipped_disabled' | 'skipped_reassigned';
export interface Schedule {
  id: string; agent_id: string; connection_id: string | null; thread_id: string | null; kind: 'cron' | 'every'; expr: string; tz: string; note: string;
  enabled: boolean; next_due: number | null; created_at: number; last_fired_at: number | null; fire_count: number; last_status: RunStatus | null; last_detail: string | null; req_id: string | null; req_name: string | null;
}
const fromRow = (r: any): Schedule => ({ ...r, enabled: !!r.enabled });
const store = {
  get: (id: string) => { const r = db.prepare('SELECT * FROM agent_schedules WHERE id=?').get(id); return r ? fromRow(r) : undefined; },
  all: () => (db.prepare('SELECT * FROM agent_schedules ORDER BY created_at').all() as any[]).map(fromRow),
  forAgent: (agentId: string) => (db.prepare('SELECT * FROM agent_schedules WHERE agent_id=? ORDER BY created_at').all(agentId) as any[]).map(fromRow),
  remove: (id: string) => db.prepare('DELETE FROM agent_schedules WHERE id=?').run(id).changes > 0,
  setNext: (id: string, next: number | null) => db.prepare('UPDATE agent_schedules SET next_due=? WHERE id=?').run(next, id),
  setEnabled: (id: string, on: boolean, next: number | null) => db.prepare('UPDATE agent_schedules SET enabled=?, next_due=? WHERE id=?').run(on ? 1 : 0, next, id),
  record(id: string, status: RunStatus, detail: string | null, durationMs: number | null, firedAt: number) {
    db.prepare('INSERT INTO schedule_runs (schedule_id,fired_at,status,detail,duration_ms) VALUES (?,?,?,?,?)').run(id, firedAt, status, detail, durationMs);
    db.prepare(`DELETE FROM schedule_runs WHERE schedule_id=? AND id NOT IN (SELECT id FROM schedule_runs WHERE schedule_id=? ORDER BY id DESC LIMIT ${KEEP_RUNS})`).run(id, id);
    db.prepare('UPDATE agent_schedules SET last_status=?, last_detail=?, last_fired_at=?, fire_count=fire_count+? WHERE id=?').run(status, detail, firedAt, status === 'delivered' ? 1 : 0, id);
  },
  runs: (id: string, limit = KEEP_RUNS) => db.prepare('SELECT id,fired_at,status,detail,duration_ms FROM schedule_runs WHERE schedule_id=? ORDER BY id DESC LIMIT ?').all(id, limit) as { id: number; fired_at: number; status: RunStatus; detail: string | null; duration_ms: number | null }[],
};

const hhmm = (t: number, tz?: string) => new Date(t).toLocaleString('en-GB', { timeZone: tz, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
export const describe = (s: Pick<Schedule, 'kind' | 'expr' | 'tz'>) => s.kind === 'every' ? `every ${s.expr} min` : `${s.expr} (${s.tz})`;

/** Next run after `after`. "every N" keeps its rhythm from the previous due time instead of drifting by the run time. */
function computeNext(s: Pick<Schedule, 'kind' | 'expr' | 'tz'>, after: number, from?: number | null): number | null {
  if (s.kind === 'cron') return nextCron(s.expr, s.tz, after);
  const step = Number(s.expr) * MS_PER_MINUTE;
  let t = (from ?? after) + step;
  if (t <= after) t += Math.ceil((after - t + 1) / step) * step;
  return t;
}

// ---- timers ----
const timers = new Map<string, ReturnType<typeof setTimeout>>();
function arm(s: Schedule): void {
  const old = timers.get(s.id); if (old) clearTimeout(old);
  timers.delete(s.id);
  if (!s.enabled || s.next_due === null) return;
  const delay = Math.max(0, Math.min(s.next_due - Date.now(), MAX_TIMER_MS));
  const t = setTimeout(() => { if (s.next_due !== null && s.next_due - Date.now() > 1000) arm(store.get(s.id) ?? s); else void fire(s.id); }, delay);
  t.unref?.();
  timers.set(s.id, t);
}
const disarm = (id: string) => { const t = timers.get(id); if (t) clearTimeout(t); timers.delete(id); };

function text(s: Schedule, web: boolean): string {
  const tool = web ? '' : ' with channel_reply';
  return `${web ? '🔔 ' : ''}Scheduled task (${describe(s)}${s.req_name ? `, asked by ${s.req_name}` : ''}). Your note: ${s.note}\n\n${s.req_name ? `hive-am mentions ${s.req_name} at the start of your first reply, so do not mention them yourself. ` : ''}Do what the note says now and tell the person the result${tool}. If there is nothing worth reporting, say so in one line. You can see or stop your schedules with schedule_list / schedule_cancel.`;
}

async function fire(id: string): Promise<void> {
  timers.delete(id);
  const s = store.get(id); if (!s || !s.enabled) return;
  const now = Date.now(), due = s.next_due ?? now;
  const next = computeNext(s, now, s.kind === 'every' ? due : null);
  store.setNext(id, next);                                    // the next run is fixed before anything else can fail
  arm({ ...s, next_due: next });
  const skip = (status: RunStatus, detail: string) => store.record(id, status, detail, null, now);
  const agent = agents.get(s.agent_id);
  if (!agent) { store.remove(id); return; }
  if (now - due > MISSED_GRACE_MS) return skip('skipped_missed', `due ${hhmm(due, s.tz)}, ${Math.round((now - due) / 60000)} min late (the server was down)`);
  if (queueDepth(agent.id) >= BUSY_QUEUE) return skip('skipped_busy', 'the agent already had messages waiting');
  const started = Date.now();
  try {
    if (s.thread_id) {
      const conn = connections.get(s.connection_id ?? ''), thread = threads.get(s.thread_id);
      if (!conn || !thread) { store.remove(id); disarm(id); return; }
      if (!conn.enabled) return skip('skipped_disabled', 'the connection is disabled');
      if (conn.agent_id !== s.agent_id) { store.setEnabled(id, false, null); disarm(id); return skip('skipped_reassigned', 'the connection now belongs to another agent; the schedule was paused'); }
      if (thread.muted) return skip('skipped_muted', 'the thread is muted');
      const adapter = adapterFor(conn.id);
      if (!adapter) return skip('skipped_disabled', 'the connection was not running');
      store.record(id, 'delivered', null, null, started);
      await deliverScheduled(conn, adapter, thread, text(s, false), s.req_id ? { id: s.req_id, name: s.req_name || 'you' } : undefined);
    } else {
      store.record(id, 'delivered', null, null, started);
      await sendTurn(agent.id, text(s, true), 'user');
    }
    db.prepare('UPDATE schedule_runs SET duration_ms=? WHERE schedule_id=? AND fired_at=? AND status=?').run(Date.now() - started, id, started, 'delivered');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    db.prepare('UPDATE schedule_runs SET status=?, detail=? WHERE schedule_id=? AND fired_at=? AND status=?').run('failed', msg, id, started, 'delivered');
    db.prepare('UPDATE agent_schedules SET last_status=?, last_detail=?, fire_count=MAX(0,fire_count-1) WHERE id=?').run('failed', msg, id);
    console.warn(`[schedules] run of "${s.note.slice(0, 40)}" failed: ${msg}`);
  }
}

/** Arms every saved schedule (called once at startup). A run missed while the server was down is skipped, not replayed. */
export function armSchedules(): void {
  for (const s of store.all()) {
    if (!s.enabled) continue;
    if (s.next_due !== null && s.next_due < Date.now()) void fire(s.id); else arm(s);
  }
}

// ---- what an agent can do ----
export interface CreateInput { cron?: unknown; every_minutes?: unknown; timezone?: unknown; note?: unknown }
export function createSchedule(agentId: string, input: CreateInput): { schedule: Schedule; next: string[]; where: 'thread' | 'chat' } {
  if (!agents.get(agentId)) throw new ScheduleError('Unknown agent');
  if (liveSource(agentId) === 'dispatch') throw new ScheduleError('Schedules are not available while you work on a task delegated by an orchestrator.');
  const note = String(input.note ?? '').trim();
  if (!note) throw new ScheduleError('Say in the note what to do at each run.');
  if (note.length > 400) throw new ScheduleError('The note is too long (400 characters at most).');
  const tz = input.timezone === undefined || input.timezone === '' ? serverTimezone() : String(input.timezone);
  if (!validTimezone(tz)) throw new ScheduleError(`Unknown time zone "${tz}". Use an IANA name such as America/Mexico_City.`);
  const hasCron = input.cron !== undefined && String(input.cron).trim() !== '', hasEvery = input.every_minutes !== undefined && input.every_minutes !== null;
  if (hasCron === hasEvery) throw new ScheduleError('Give either "cron" (for example "0 9 * * MON-FRI") or "every_minutes", not both and not neither.');
  let kind: 'cron' | 'every', expr: string, first: number | null;
  const now = Date.now();
  if (hasCron) {
    kind = 'cron'; expr = String(input.cron).trim();
    try { parseCron(expr); } catch (e) { throw new ScheduleError(e instanceof CronError ? e.message : String(e)); }
    const gap = minGapMinutes(expr, tz, now);
    if (gap < MIN_INTERVAL_MINUTES) throw new ScheduleError(`Runs would be only ${gap} min apart; the minimum is ${MIN_INTERVAL_MINUTES} min. Choose a less frequent schedule.`);
    first = nextCron(expr, tz, now);
  } else {
    kind = 'every'; const m = Number(input.every_minutes);
    if (!Number.isFinite(m) || m < MIN_INTERVAL_MINUTES || m > 60 * 24 * 31) throw new ScheduleError(`every_minutes must be between ${MIN_INTERVAL_MINUTES} and ${60 * 24 * 31}.`);
    expr = String(Math.round(m)); first = now + Math.round(m) * MS_PER_MINUTE;
  }
  if (first === null) throw new ScheduleError('That schedule never runs.');
  const origin = liveOrigin(agentId), thread = origin ? threads.get(origin.threadId) : undefined;
  if (origin && !thread) throw new ScheduleError('The thread no longer exists.');
  const mine = store.forAgent(agentId);
  if (mine.length >= MAX_PER_AGENT) throw new ScheduleError(`You already have ${MAX_PER_AGENT} schedules. Cancel one with schedule_cancel first.`);
  const dup = mine.find((x) => x.kind === kind && x.expr === expr && x.tz === tz && x.note.toLowerCase() === note.toLowerCase() && x.thread_id === (thread?.id ?? null));
  if (dup) return { schedule: dup, next: kind === 'cron' ? nextRuns(expr, tz, now, 3).map((t) => hhmm(t, tz)) : [hhmm(dup.next_due ?? first, tz)], where: thread ? 'thread' : 'chat' };
  const id = randomUUID();
  db.prepare('INSERT INTO agent_schedules (id,agent_id,connection_id,thread_id,kind,expr,tz,note,enabled,next_due,created_at,req_id,req_name) VALUES (?,?,?,?,?,?,?,?,1,?,?,?,?)')
    .run(id, agentId, origin?.connectionId ?? null, thread?.id ?? null, kind, expr, tz, note, first, now, origin?.group && origin.userId ? origin.userId : null, origin?.group && origin.userId ? origin.userName : null);
  const schedule = store.get(id)!;
  arm(schedule);
  return { schedule, next: kind === 'cron' ? nextRuns(expr, tz, now, 3).map((t) => hhmm(t, tz)) : [hhmm(first, tz)], where: thread ? 'thread' : 'chat' };
}

export function listFor(agentId: string): { id: string; schedule: string; note: string; enabled: boolean; next: string | null; last: string | null }[] {
  return store.forAgent(agentId).map((s) => ({ id: s.id, schedule: describe(s), note: s.note, enabled: s.enabled, next: s.next_due ? hhmm(s.next_due, s.tz) : null, last: s.last_status }));
}
export function cancelFor(agentId: string, id: string): boolean {
  const s = store.get(id);
  if (!s || s.agent_id !== agentId) throw new ScheduleError('You have no schedule with that id. Use schedule_list to see yours.');
  disarm(id);
  return store.remove(id);
}

// ---- what the interface can do ----
export interface ScheduleView extends Schedule { agent_name: string; place: string; description: string; runs?: number }
export function listAll(): ScheduleView[] {
  return store.all().map((s) => ({ ...s, agent_name: agents.get(s.agent_id)?.name ?? '?', place: s.thread_id ? (threads.get(s.thread_id)?.title || 'chat') : '', description: describe(s) }));
}
export const runsOf = (id: string) => store.runs(id);
export function setEnabled(id: string, on: boolean): Schedule | undefined {
  const s = store.get(id); if (!s) return undefined;
  const next = on ? computeNext(s, Date.now(), null) : null;
  store.setEnabled(id, on, next);
  const u = store.get(id)!; arm(u); return u;
}
export function removeSchedule(id: string): boolean { disarm(id); return store.remove(id); }
