import { db } from './db.js';
import { historySig } from './history/index.js';
import { RETENTION_DAYS } from './connections/files.js';

/**
 * What hive-am keeps of its own record, and for how long. Three tables only ever grew: the messages of channel conversations, the log of
 * delegations and the list of known conversations. The conversations themselves live in each CLI's own store and are never touched here:
 * only hive-am's copy (the row that lists them) goes. A row is removed only when it is past its cap AND old enough, so nothing recent is lost.
 */
export const KEEP_THREAD_MESSAGES = 500;   // the newest of each thread...
export const MESSAGE_DAYS = 30;             // ...and anything younger than this, whatever the count
export const KEEP_DISPATCHES = 200;         // the screen shows 50
export const KEEP_DELEGATIONS = 50;         // delegated conversations per agent (a read-only log), kept while younger than SESSION_FORGET_DAYS
export const SESSION_FORGET_DAYS = 90;      // a conversation not used for this long, and that the CLI no longer has, is forgotten
// Received files live RETENTION_DAYS (connections/files.ts, 14): the record of a file on a message goes with the file.

const DAY = 86_400_000;
export interface RetentionResult { messages: number; dispatches: number; sessions: number; files: number }

export function retentionPass({ now = Date.now() }: { now?: number } = {}): RetentionResult {
  const forgetBefore = now - SESSION_FORGET_DAYS * DAY;

  // A direct conversation goes only when it is old AND its transcript is gone. `historySig` is null for a failed read too: the age is what makes that harmless.
  const gone: { agent_id: string; session_id: string }[] = [];
  const old = db.prepare("SELECT s.agent_id, s.session_id, s.provider, s.cwd FROM agent_sessions s WHERE s.kind='direct' AND s.last_seen < ? AND s.session_id IS NOT (SELECT session_id FROM agents WHERE id=s.agent_id)")
    .all(forgetBefore) as { agent_id: string; session_id: string; provider: 'claude' | 'opencode' | 'kiro'; cwd: string }[];
  for (const s of old) if (historySig({ provider: s.provider, cwd: s.cwd }, s.session_id) === null) gone.push(s);

  return db.transaction((): RetentionResult => {
    const out: RetentionResult = { messages: 0, dispatches: 0, sessions: 0, files: 0 };

    // Messages: beyond the newest KEEP_THREAD_MESSAGES of their thread and older than the window.
    const cut = db.prepare('SELECT id FROM thread_messages WHERE thread_id=? ORDER BY id DESC LIMIT 1 OFFSET ?');
    const drop = db.prepare('DELETE FROM thread_messages WHERE thread_id=? AND id<? AND ts<?');
    for (const { thread_id } of db.prepare('SELECT DISTINCT thread_id FROM thread_messages').all() as { thread_id: string }[]) {
      const edge = cut.get(thread_id, KEEP_THREAD_MESSAGES - 1) as { id: number } | undefined;
      if (edge) out.messages += drop.run(thread_id, edge.id, now - MESSAGE_DAYS * DAY).changes;
    }

    // The record of a received file goes with the file.
    out.files = db.prepare('UPDATE thread_messages SET files=NULL WHERE files IS NOT NULL AND ts<?').run(now - RETENTION_DAYS * DAY).changes;

    // Delegations: all but the newest KEEP_DISPATCHES. Never one that has not finished, nor a background one whose result nobody has had
    // yet (not handed to the orchestrator, nor read with dispatch_status): that one stays until it is.
    out.dispatches = db.prepare(`DELETE FROM dispatches WHERE status NOT IN ('queued','running') AND NOT (mode='background' AND notified_at IS NULL AND read_at IS NULL)
      AND id IN (SELECT id FROM dispatches ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?)`).run(KEEP_DISPATCHES).changes;

    // Delegated conversations: past the newest KEEP_DELEGATIONS of their agent and not used for SESSION_FORGET_DAYS.
    out.sessions += db.prepare(`DELETE FROM agent_sessions WHERE kind='delegation' AND last_seen<? AND (agent_id, session_id) IN (
      SELECT agent_id, session_id FROM (SELECT agent_id, session_id, ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY last_seen DESC, session_id) AS n FROM agent_sessions WHERE kind='delegation') WHERE n>?)`)
      .run(forgetBefore, KEEP_DELEGATIONS).changes;

    // Direct conversations the CLI no longer has (the current one of an agent was left out above, and is checked again here).
    const del = db.prepare("DELETE FROM agent_sessions WHERE agent_id=? AND session_id=? AND kind='direct' AND session_id IS NOT (SELECT session_id FROM agents WHERE id=?)");
    for (const g of gone) out.sessions += del.run(g.agent_id, g.session_id, g.agent_id).changes;
    return out;
  })();
}

export const retentionTouched = (r: RetentionResult) => r.messages + r.dispatches + r.sessions + r.files > 0;
