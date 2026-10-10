import { randomUUID } from 'node:crypto';
import { agents, db } from './db.js';
import { adapterFor } from './connections/manager.js';
import { deliverScheduled } from './connections/router.js';
import { connections, threads } from './connections/store.js';
import { liveOrigin, liveSource, sendTurn } from './runtime.js';

/**
 * Wake-ups. An agent only runs while it handles a message, so "I'll tell you when it finishes" cannot be kept by an agent that just
 * says it: it has to ask hive-am to wake it. `wake_me` stores the request; when it is due, the agent receives a message and answers.
 * Asked from a chat (Telegram, Slack…) the wake-up comes back to that same thread; asked from the hive-am web chat it comes back as a
 * message of the agent's own conversation.
 */
export class WakeError extends Error {}

export const WAKE_MIN_MINUTES = 1, WAKE_MAX_MINUTES = 240, WAKE_MAX_PENDING = 5;
const WAKE_MS = Number(process.env.HIVE_AM_WAKE_MS_PER_MINUTE) || 60_000;   // tests shrink a "minute"
const TOO_LATE_MS = 2 * 3_600_000;                                          // after a long outage, an old reminder is no longer useful

db.exec(`
DROP TABLE IF EXISTS wakeups;
CREATE TABLE IF NOT EXISTS agent_wakeups (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  connection_id TEXT, thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,
  due_at INTEGER NOT NULL, note TEXT NOT NULL, created_at INTEGER NOT NULL
);`);
// Who asked (only kept when it was in a group): the reminder mentions them. Older databases get the columns here.
for (const col of ['req_id TEXT', 'req_name TEXT']) { try { db.exec(`ALTER TABLE agent_wakeups ADD COLUMN ${col}`); } catch { /* already there */ } }

interface Wake { id: string; agent_id: string; connection_id: string | null; thread_id: string | null; due_at: number; note: string; created_at: number; req_id: string | null; req_name: string | null }
const rows = {
  get: (id: string) => db.prepare('SELECT * FROM agent_wakeups WHERE id=?').get(id) as Wake | undefined,
  all: () => db.prepare('SELECT * FROM agent_wakeups ORDER BY due_at').all() as Wake[],
  remove: (id: string) => db.prepare('DELETE FROM agent_wakeups WHERE id=?').run(id).changes > 0,
  pending: (agentId: string, threadId: string | null) => (threadId
    ? db.prepare('SELECT COUNT(*) AS n FROM agent_wakeups WHERE thread_id=?').get(threadId)
    : db.prepare('SELECT COUNT(*) AS n FROM agent_wakeups WHERE agent_id=? AND thread_id IS NULL').get(agentId)) as { n: number },
  same: (agentId: string, threadId: string | null, note: string) => (threadId
    ? db.prepare('SELECT * FROM agent_wakeups WHERE thread_id=? AND lower(note)=lower(?)').get(threadId, note)
    : db.prepare('SELECT * FROM agent_wakeups WHERE agent_id=? AND thread_id IS NULL AND lower(note)=lower(?)').get(agentId, note)) as Wake | undefined,
  add(w: Omit<Wake, 'id' | 'created_at'>): Wake {
    const row: Wake = { ...w, id: randomUUID(), created_at: Date.now() };
    db.prepare('INSERT INTO agent_wakeups (id,agent_id,connection_id,thread_id,due_at,note,created_at,req_id,req_name) VALUES (?,?,?,?,?,?,?,?,?)').run(row.id, row.agent_id, row.connection_id, row.thread_id, row.due_at, row.note, row.created_at, row.req_id, row.req_name);
    return row;
  },
};

const wakeText = (w: Wake, replyTool?: string) =>
  `Scheduled wake-up (you set it at ${hhmm(w.created_at)}${w.req_name ? `, asked by ${w.req_name}` : ''}). Your note: ${w.note}\n\n${w.req_name ? `hive-am mentions ${w.req_name} at the start of your first reply, so do not mention them yourself. ` : ''}Check now what you were waiting for and tell the person${replyTool ? ` with ${replyTool}` : ''}: done, still running (then schedule another wake-up with wake_me) or failed. Give the actual result, not just that you woke up.`;
const hhmm = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function arm(w: Wake, tries = 0): void {
  const t = setTimeout(() => { void fire(w.id, tries); }, Math.max(0, w.due_at - Date.now()));
  t.unref?.();
  timers.set(w.id, t);
}

/** Where a later message goes, and who it concerns. */
export interface Destination { agent_id: string; connection_id: string | null; thread_id: string | null; req_id: string | null; req_name: string | null }
export type Delivery = 'sent' | 'retry' | 'dropped';
type Deliverer = (to: Destination, threadText: string, webText: string, beforeSend?: () => void) => Promise<Delivery>;
let override: Deliverer | null = null;
/** Tests replace the delivery to watch what would be sent without running a model. */
export const setDeliveryForTests = (fn: Deliverer | null) => { override = fn; };

/**
 * Hands a message to the agent in the place where it was asked: the chat thread (where the person who asked is mentioned) or the web conversation.
 * `retry` means the platform is not connected yet (right after a start); `dropped` that there is nobody to tell (thread gone, connection off or
 * reassigned, muted on purpose). `beforeSend` runs once the message is certain to go, so the caller can forget the request before the turn starts.
 */
export const deliverTo: Deliverer = async (to, threadText, webText, beforeSend) => {
  if (override) return override(to, threadText, webText, beforeSend);
  const agent = agents.get(to.agent_id);
  if (!agent) return 'dropped';
  if (to.thread_id) {
    const conn = connections.get(to.connection_id ?? ''), thread = threads.get(to.thread_id);
    if (!conn || !conn.enabled || !thread) return 'dropped';
    const adapter = adapterFor(conn.id);
    if (!adapter) return 'retry';
    beforeSend?.();
    if (thread.muted || conn.agent_id !== to.agent_id) return 'dropped';
    await deliverScheduled(conn, adapter, thread, threadText, to.req_id ? { id: to.req_id, name: to.req_name || 'you' } : undefined);
    return 'sent';
  }
  beforeSend?.();
  await sendTurn(agent.id, webText, 'user');
  return 'sent';
};

async function fire(id: string, tries: number): Promise<void> {
  timers.delete(id);
  const w = rows.get(id); if (!w) return;
  try {
    const out = await deliverTo(w, wakeText(w, 'channel_reply'), `🔔 ${wakeText(w)}`, () => { rows.remove(id); });
    if (out === 'retry') { if (tries < 12) { w.due_at = Date.now() + 5000; arm(w, tries + 1); } else rows.remove(id); }
    else if (out === 'dropped') rows.remove(id);
  } catch (e) { console.warn(`[wake] wake-up of agent ${agents.get(w.agent_id)?.name ?? w.agent_id} failed: ${e instanceof Error ? e.message : e}`); }
}

/** Re-arms the wake-ups saved before a restart (called once at startup). */
export function armWakeups(): void {
  for (const w of rows.all()) { if (Date.now() - w.due_at > TOO_LATE_MS) rows.remove(w.id); else arm(w); }
}

/** `wake_me`: the agent asks to be woken after some minutes. */
export function scheduleWake(agentId: string, minutes: unknown, note: unknown): { at: string; minutes: number; where: 'thread' | 'chat' } {
  if (!agents.get(agentId)) throw new WakeError('Unknown agent');
  if (liveSource(agentId) === 'dispatch') throw new WakeError('Wake-ups are not available while you work on a task delegated by an orchestrator: finish it and report what is left.');
  const mins = Number(minutes);
  if (!(mins >= WAKE_MIN_MINUTES && mins <= WAKE_MAX_MINUTES)) throw new WakeError(`minutes must be between ${WAKE_MIN_MINUTES} and ${WAKE_MAX_MINUTES}.`);
  const text = String(note ?? '').trim();
  if (!text) throw new WakeError('Say in the note what to check when you wake up.');
  if (text.length > 400) throw new WakeError('The note is too long (400 characters at most).');
  const origin = liveOrigin(agentId);
  const thread = origin ? threads.get(origin.threadId) : undefined;
  if (origin && !thread) throw new WakeError('The thread no longer exists.');
  // The same request twice (a model that retried after a hiccup) is one wake-up, not two.
  const dup = rows.same(agentId, thread?.id ?? null, text);
  if (dup) return { at: hhmm(dup.due_at), minutes: Math.max(1, Math.round((dup.due_at - Date.now()) / WAKE_MS)), where: thread ? 'thread' : 'chat' };
  if (rows.pending(agentId, thread?.id ?? null).n >= WAKE_MAX_PENDING) throw new WakeError(`There are already ${WAKE_MAX_PENDING} wake-ups pending ${thread ? 'in this thread' : 'for you'}. Wait for one to fire.`);
  const w = rows.add({ agent_id: agentId, connection_id: origin?.connectionId ?? null, thread_id: thread?.id ?? null, due_at: Date.now() + mins * WAKE_MS, note: text, req_id: origin?.group && origin.userId ? origin.userId : null, req_name: origin?.group && origin.userId ? origin.userName : null });
  arm(w);
  return { at: hhmm(w.due_at), minutes: mins, where: thread ? 'thread' : 'chat' };
}

export const pendingWakeups = () => rows.all();

/** For the interface: pending one-shot wake-ups, and a way to cancel them. */
export const listWakeups = () => rows.all();
export const removeWakeup = (id: string) => { const t = timers.get(id); if (t) { clearTimeout(t); timers.delete(id); } return rows.remove(id); };
