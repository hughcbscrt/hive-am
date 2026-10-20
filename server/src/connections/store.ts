import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { parseJson } from '../db/json.js';
import type { AllowedUser, Connection, ChannelKind, SavedFile, Target, Thread } from './types.js';

// The tables (connections, threads, thread_messages, connection_cursor) are created by db/migrations.ts.

const now = () => Date.now();

// Rows as SQLite returns them (JSON columns are text, flags are 0/1).
interface ConnectionDbRow { id: string; kind: string; name: string; agent_id: string | null; config: string; allowed: string; enabled: number; created_at: number }
type ThreadDbRow = Omit<Thread, 'target' | 'muted' | 'seen_id'> & { target: string; muted: number | null; seen_id: number | null };
export interface ThreadMessageRow { id: number; thread_id: string; direction: 'in' | 'out'; external_id: string; user_id: string | null; user_name: string | null; text: string; ts: number; files: string | null }

const connRow = (r: ConnectionDbRow): Connection => ({
  id: r.id, kind: r.kind as ChannelKind, name: r.name, agent_id: r.agent_id,
  config: parseJson(r.config, {}, `connection ${r.id} config`), allowed: parseJson<AllowedUser[]>(r.allowed, [], `connection ${r.id} allowed`), enabled: !!r.enabled, created_at: r.created_at,
});
const threadRow = (r: ThreadDbRow): Thread => ({ ...r, target: parseJson<Target>(r.target, { chat: '' }, `thread ${r.id} target`), muted: !!r.muted, seen_id: r.seen_id ?? 0 });

export const connections = {
  list: () => (db.prepare('SELECT * FROM connections ORDER BY name').all() as ConnectionDbRow[]).map(connRow),
  get(id: string) { const r = db.prepare('SELECT * FROM connections WHERE id=?').get(id) as ConnectionDbRow | undefined; return r ? connRow(r) : undefined; },
  forAgent: (agentId: string) => (db.prepare('SELECT * FROM connections WHERE agent_id=? AND enabled=1').all(agentId) as ConnectionDbRow[]).map(connRow),
  create(p: { kind: ChannelKind; name: string; agent_id?: string | null; config?: Record<string, any>; allowed?: AllowedUser[]; enabled?: boolean }): Connection {
    const id = randomUUID();
    db.prepare('INSERT INTO connections (id,kind,name,agent_id,config,allowed,enabled,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, p.kind, p.name, p.agent_id ?? null, JSON.stringify(p.config ?? {}), JSON.stringify(p.allowed ?? []), p.enabled === false ? 0 : 1, now());
    return connections.get(id)!;
  },
  update(id: string, p: Partial<Pick<Connection, 'name' | 'agent_id' | 'config' | 'allowed' | 'enabled'>>): Connection | undefined {
    const cur = connections.get(id); if (!cur) return;
    const n = { ...cur, ...p };
    db.prepare('UPDATE connections SET name=?, agent_id=?, config=?, allowed=?, enabled=? WHERE id=?')
      .run(n.name, n.agent_id, JSON.stringify(n.config), JSON.stringify(n.allowed), n.enabled ? 1 : 0, id);
    return connections.get(id);
  },
  remove: (id: string) => db.prepare('DELETE FROM connections WHERE id=?').run(id).changes > 0,
};

export const threads = {
  get(id: string) { const r = db.prepare('SELECT * FROM threads WHERE id=?').get(id) as ThreadDbRow | undefined; return r ? threadRow(r) : undefined; },
  forConnection: (connectionId: string) => (db.prepare('SELECT * FROM threads WHERE connection_id=? ORDER BY last_activity DESC').all(connectionId) as ThreadDbRow[]).map(threadRow),
  /** Finds the thread for an external key or creates it; always refreshes the reply target and activity. */
  touch(connectionId: string, externalKey: string, info: { title: string; target: Target; user: string }): Thread {
    const t = now();
    const cur = db.prepare('SELECT id FROM threads WHERE connection_id=? AND external_key=?').get(connectionId, externalKey) as { id: string } | undefined;
    if (cur) {
      db.prepare(`UPDATE threads SET target=?, last_user=?, last_activity=?, title=CASE WHEN title='' THEN ? ELSE title END WHERE id=?`)
        .run(JSON.stringify(info.target), info.user, t, info.title, cur.id);
      return threads.get(cur.id)!;
    }
    const id = randomUUID();
    db.prepare('INSERT INTO threads (id,connection_id,external_key,title,target,last_user,created_at,last_activity) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, connectionId, externalKey, info.title, JSON.stringify(info.target), info.user, t, t);
    return threads.get(id)!;
  },
  /** The agent already wrote in this thread (Slack: people who keep talking in a thread it answered are talking to it). */
  answered: (connectionId: string, externalKey: string) => !!db.prepare("SELECT 1 FROM threads t JOIN thread_messages m ON m.thread_id=t.id WHERE t.connection_id=? AND t.external_key=? AND m.direction='out' LIMIT 1").get(connectionId, externalKey),
  setMuted: (id: string, muted: boolean) => { db.prepare('UPDATE threads SET muted=? WHERE id=?').run(muted ? 1 : 0, id); },
  markSeen: (id: string, upTo: number) => { db.prepare('UPDATE threads SET seen_id=MAX(seen_id, ?) WHERE id=?').run(upTo, id); },
};

export const threadMessages = {
  /** Returns false when this message was already recorded (a redelivered event). */
  record(threadId: string, direction: 'in' | 'out', externalId: string, who: { id?: string; name?: string }, text: string): boolean {
    return db.prepare('INSERT OR IGNORE INTO thread_messages (thread_id,direction,external_id,user_id,user_name,text,ts) VALUES (?,?,?,?,?,?,?)')
      .run(threadId, direction, externalId, who.id ?? null, who.name ?? null, text, now()).changes > 0;
  },
  /** Remembers the files saved for an inbound message, so they can be listed later as context. */
  setFiles: (threadId: string, externalId: string, files: SavedFile[]) => { db.prepare("UPDATE thread_messages SET files=? WHERE thread_id=? AND direction='in' AND external_id=?").run(JSON.stringify(files), threadId, externalId); },
  /** Id of the newest message of the thread (0 when none). */
  /** The people who wrote in a thread recently (not the agent). */
  senders: (threadId: string) => db.prepare("SELECT DISTINCT user_id AS id, user_name AS name FROM (SELECT user_id, user_name FROM thread_messages WHERE thread_id=? AND direction='in' AND user_name IS NOT NULL ORDER BY id DESC LIMIT 300)").all(threadId) as { id: string; name: string }[],
  lastId: (threadId: string) => (db.prepare('SELECT MAX(id) AS m FROM thread_messages WHERE thread_id=?').get(threadId) as { m: number | null }).m ?? 0,
  /** Messages people wrote that the agent has not been shown yet (after `afterId`, before `beforeId`), oldest first. */
  unseen: (threadId: string, afterId: number, beforeId: number, limit = 30) =>
    (db.prepare(`SELECT * FROM (SELECT * FROM thread_messages WHERE thread_id=? AND direction='in' AND id>? AND id<? ORDER BY id DESC LIMIT ?) ORDER BY id`).all(threadId, afterId, beforeId, limit) as ThreadMessageRow[]),
  recent: (threadId: string, limit = 30) =>
    (db.prepare('SELECT * FROM (SELECT * FROM thread_messages WHERE thread_id=? ORDER BY id DESC LIMIT ?) ORDER BY id').all(threadId, limit) as ThreadMessageRow[]),
};

export const cursors = {
  get: (connectionId: string) => (db.prepare('SELECT value FROM connection_cursor WHERE connection_id=?').get(connectionId) as { value: string } | undefined)?.value,
  set: (connectionId: string, value: string) => db.prepare('INSERT INTO connection_cursor (connection_id,value) VALUES (?,?) ON CONFLICT(connection_id) DO UPDATE SET value=excluded.value').run(connectionId, value),
};
