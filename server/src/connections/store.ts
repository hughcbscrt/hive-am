import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import type { AllowedUser, Connection, ChannelKind, SavedFile, Target, Thread } from './types.js';

db.exec(`
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL UNIQUE,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  config TEXT NOT NULL DEFAULT '{}', allowed TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
-- Known threads: where to send a reply and when it was last active. The conversation itself is the agent's one session.
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  external_key TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', target TEXT NOT NULL, last_user TEXT,
  created_at INTEGER NOT NULL, last_activity INTEGER NOT NULL,
  UNIQUE (connection_id, external_key)
);
CREATE TABLE IF NOT EXISTS thread_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  direction TEXT NOT NULL, external_id TEXT NOT NULL, user_id TEXT, user_name TEXT,
  text TEXT NOT NULL, ts INTEGER NOT NULL,
  UNIQUE (thread_id, direction, external_id)
);
CREATE TABLE IF NOT EXISTS connection_cursor (
  connection_id TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE, value TEXT NOT NULL
);
`);

// Columns added after the first release.
for (const col of ['muted INTEGER NOT NULL DEFAULT 0', 'seen_id INTEGER NOT NULL DEFAULT 0']) {
  try { db.exec(`ALTER TABLE threads ADD COLUMN ${col}`); } catch { /* already there */ }
}
try { db.exec('ALTER TABLE thread_messages ADD COLUMN files TEXT'); } catch { /* already there */ }

const now = () => Date.now();
const json = <T>(s: string, fallback: T): T => { try { return JSON.parse(s) as T; } catch { return fallback; } };

const connRow = (r: any): Connection => ({
  id: r.id, kind: r.kind as ChannelKind, name: r.name, agent_id: r.agent_id,
  config: json(r.config, {}), allowed: json<AllowedUser[]>(r.allowed, []), enabled: !!r.enabled, created_at: r.created_at,
});
const threadRow = (r: any): Thread => ({ ...r, target: json<Target>(r.target, { chat: '' }), muted: !!r.muted, seen_id: r.seen_id ?? 0 });

export const connections = {
  list: () => (db.prepare('SELECT * FROM connections ORDER BY name').all() as any[]).map(connRow),
  get(id: string) { const r = db.prepare('SELECT * FROM connections WHERE id=?').get(id); return r ? connRow(r) : undefined; },
  forAgent: (agentId: string) => (db.prepare('SELECT * FROM connections WHERE agent_id=? AND enabled=1').all(agentId) as any[]).map(connRow),
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
  get(id: string) { const r = db.prepare('SELECT * FROM threads WHERE id=?').get(id); return r ? threadRow(r) : undefined; },
  forConnection: (connectionId: string) => (db.prepare('SELECT * FROM threads WHERE connection_id=? ORDER BY last_activity DESC').all(connectionId) as any[]).map(threadRow),
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
    (db.prepare(`SELECT * FROM (SELECT * FROM thread_messages WHERE thread_id=? AND direction='in' AND id>? AND id<? ORDER BY id DESC LIMIT ?) ORDER BY id`).all(threadId, afterId, beforeId, limit) as any[]),
  recent: (threadId: string, limit = 30) =>
    (db.prepare('SELECT * FROM (SELECT * FROM thread_messages WHERE thread_id=? ORDER BY id DESC LIMIT ?) ORDER BY id').all(threadId, limit) as any[]),
};

export const cursors = {
  get: (connectionId: string) => (db.prepare('SELECT value FROM connection_cursor WHERE connection_id=?').get(connectionId) as { value: string } | undefined)?.value,
  set: (connectionId: string, value: string) => db.prepare('INSERT INTO connection_cursor (connection_id,value) VALUES (?,?) ON CONFLICT(connection_id) DO UPDATE SET value=excluded.value').run(connectionId, value),
};
