import { agents, dispatches, type DispatchRow } from './db.js';
import { threads } from './connections/store.js';
import { liveOrigin, notifyAgentsChanged, startDispatch } from './runtime.js';
import { deliverTo, type Destination } from './wake.js';
import { DomainError } from './errors.js';

/**
 * Delegations that outlive a request. A long task held on one HTTP request broke when the client gave up waiting (Node's fetch stops at
 * five minutes without headers), and the orchestrator lost the answer. Now a task is stored and queued at once and its result is read
 * from the `dispatches` table: in the background the orchestrator is told when it ends, in the place where it asked (the chat thread or
 * its web conversation); the synchronous `dispatch` tool polls `dispatch_status` with short calls until it ends.
 */
export class DispatchError extends DomainError {}

export const MAX_BACKGROUND = 10;     // unfinished background tasks per orchestrator
export const MAX_WAIT_S = 60;         // the longest one `dispatch_status` call waits
const POLL_MS = 250;
const RETRY_MS = Number(process.env.HIVE_AM_WAKE_RETRY_MS) || 5000;   // wait before trying a delivery again (as wake-ups do)
const FINISHED = new Set(['done', 'failed', 'interrupted']);
const NO_TEXT = '(the subagent finished without a text answer)';

interface StoredOrigin { connection_id: string; thread_id: string; req_id: string | null; req_name: string | null }

const nameOf = (id: string) => agents.get(id)?.name ?? 'a removed agent';

/** Starts a delegation without waiting for it. In the background, its end is announced to the orchestrator; a synchronous one is polled. */
export async function startTask(fromId: string, workerName: string, task: string, background: boolean): Promise<{ id: string; agent: string; status: string; mode: 'sync' | 'background' }> {
  if (background && dispatches.unfinished(fromId) >= MAX_BACKGROUND) throw new DispatchError(`You already have ${MAX_BACKGROUND} background tasks that have not finished, the most allowed. Wait for one to finish (you are told, or ask with dispatch_status) before sending another.`);
  let origin: string | null = null;
  if (background) {
    // The answer goes back where the orchestrator was asked, as a wake-up does: the chat thread it is answering now, or its web conversation.
    const o = liveOrigin(fromId);
    const thread = o ? threads.get(o.threadId) : undefined;
    if (o && thread) origin = JSON.stringify({ connection_id: o.connectionId, thread_id: thread.id, req_id: o.group && o.userId ? o.userId : null, req_name: o.group && o.userId ? o.userName : null } satisfies StoredOrigin);
  }
  let started: ReturnType<typeof startDispatch>;
  try { started = startDispatch(fromId, workerName, task, background ? 'background' : 'sync', origin); } catch (e) { throw new DispatchError(e instanceof Error ? e.message : String(e)); }
  if (background) void started.done.then(() => announce(started.id), () => announce(started.id));
  notifyAgentsChanged();   // the interface reloads the dispatch log
  // The worker's turn starts on the next tick when it is free: answer the state it is really in (running, or queued behind other work).
  await new Promise((r) => setImmediate(r));
  return { id: started.id, agent: started.worker.name, status: dispatches.get(started.id)?.status ?? 'queued', mode: background ? 'background' : 'sync' };
}

export interface TaskStatus { id: string; agent: string; status: string; mode: string; result?: string; note?: string }

/**
 * The state of a task, for the orchestrator that started it. With `waitSeconds` it waits up to that long for the end (at most MAX_WAIT_S,
 * so no single request is long) and answers the state it has then. A finished result read here counts as read.
 */
export async function taskStatus(fromId: string, id: string, waitSeconds?: unknown): Promise<TaskStatus> {
  if (!id) throw new DispatchError('id is required');
  let row = dispatches.get(id);
  if (!row) throw new DispatchError(`There is no delegated task with id "${id}".`, 'not_found');
  if (row.from_id !== fromId) throw new DispatchError(`Task "${id}" was not started by you.`, 'forbidden');
  const asked = waitSeconds === undefined || waitSeconds === null || waitSeconds === '' ? 0 : Number(waitSeconds);
  if (!Number.isFinite(asked) || asked < 0) throw new DispatchError(`wait_seconds must be a number from 0 to ${MAX_WAIT_S}.`);
  const wait = Math.min(asked, MAX_WAIT_S);
  const until = Date.now() + wait * 1000;
  while (!FINISHED.has(row.status) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, Math.min(POLL_MS, until - Date.now())));
    row = dispatches.get(id) ?? row;
  }
  const out: TaskStatus = { id, agent: nameOf(row.to_id), status: row.status, mode: row.mode };
  if (FINISHED.has(row.status)) { out.result = resultText(row); dispatches.markRead(id); }
  if (asked > MAX_WAIT_S) out.note = `wait_seconds is capped at ${MAX_WAIT_S}: waited ${MAX_WAIT_S} s at most.`;
  return out;
}

/** What a finished task says: its answer, its error, or why it stopped. */
function resultText(row: DispatchRow): string {
  if (row.status === 'interrupted') return `hive-am restarted while ${nameOf(row.to_id)} was working on it; check the branch or the files and send the task again if needed.`;
  if (row.status === 'failed') return row.result || 'The turn failed without saying why.';
  return row.result || NO_TEXT;
}

const noticeText = (row: DispatchRow) => `Delegated task ${row.id} to ${nameOf(row.to_id)} finished (${row.status}). Result:\n${resultText(row)}`;
const NEXT = 'Carry on with the work this task was part of and tell the person what came of it';

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Hands the result of a finished background task to the orchestrator, once. Tried again while the platform is not connected yet. */
async function announce(id: string, tries = 0): Promise<void> {
  timers.delete(id);
  const row = dispatches.get(id);
  if (!row || row.mode !== 'background' || row.notified_at || !FINISHED.has(row.status)) return;
  const o: StoredOrigin | null = row.origin ? JSON.parse(row.origin) : null;
  const to: Destination = { agent_id: row.from_id, connection_id: o?.connection_id ?? null, thread_id: o?.thread_id ?? null, req_id: o?.req_id ?? null, req_name: o?.req_name ?? null };
  const again = () => {
    if (tries >= 12) { dispatches.markNotified(id); return; }
    const t = setTimeout(() => { void announce(id, tries + 1); }, RETRY_MS);
    t.unref?.();
    timers.set(id, t);
  };
  try {
    // The row is marked before the turn starts, so a restart in between cannot announce it twice.
    const mention = to.req_name ? `hive-am mentions ${to.req_name} at the start of your first reply, so do not mention them yourself. ` : '';
    const out = await deliverTo(to, `${noticeText(row)}\n\n${mention}${NEXT} with channel_reply.`, `🔔 ${noticeText(row)}\n\n${NEXT}.`, () => { dispatches.markNotified(id); });
    if (out === 'retry') again();
    // Nobody to tell (the thread is gone, muted or reassigned): the result stays readable with dispatch_status.
    else if (out === 'dropped') dispatches.markNotified(id);
  } catch (e) {
    console.warn(`[dispatch] the result of task ${id} could not be handed to ${nameOf(row.from_id)}: ${e instanceof Error ? e.message : e}`);
    if (!dispatches.get(id)?.notified_at) again();
  }
}

/** At startup: tasks left queued or running are interrupted, and every finished background task not announced yet is announced now. */
export function armDispatchNotices(): void {
  dispatches.interruptLeftovers();
  for (const row of dispatches.undelivered()) void announce(row.id);
}
