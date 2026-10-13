import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Block, ChatMessage } from '../types.js';
import { estimateCost } from '../pricing.js';
import { stripInstructions as stripPreamble } from '../providers/preamble.js';

const DB = join(homedir(), '.local', 'share', 'opencode', 'opencode.db');

/** Changes when the conversation changes (used to cache what is computed from it). */
/** A query that may name tables this OpenCode version does not have. */
function tryGet<T>(db: Database.Database, sql: string, ...args: unknown[]): T | undefined { try { return db.prepare(sql).get(...args) as T | undefined; } catch { return undefined; } }
function tryAll<T>(db: Database.Database, sql: string, ...args: unknown[]): T[] { try { return db.prepare(sql).all(...args) as T[]; } catch { return []; } }

export function opencodeSig(sessionId: string): string | null {
  if (!existsSync(DB)) return null;
  const db = new Database(DB, { readonly: true, fileMustExist: true });
  try {
    const r = tryGet<{ n: number; t: number }>(db, 'SELECT COUNT(*) n, COALESCE(MAX(time_created), 0) t FROM session_message WHERE session_id=?', sessionId);
    if (r && r.n > 0) return `${r.n}:${r.t}`;
    // 1.x keeps messages and their parts apart; a part changes while a message is being written
    const v = tryGet<{ n: number; t: number }>(db, 'SELECT COUNT(*) n, COALESCE(MAX(time_updated), 0) t FROM part WHERE session_id=?', sessionId);
    return v ? `v1:${v.n}:${v.t}` : null;
  } catch { return null; } finally { db.close(); }
}

export function readOpencode(sessionId: string): ChatMessage[] {
  if (!existsSync(DB)) return [];
  const db = new Database(DB, { readonly: true, fileMustExist: true });
  try {
    const rows = tryAll<any>(db, `SELECT id, type, time_created, data FROM session_message WHERE session_id=? AND type IN ('user','assistant') ORDER BY seq`, sessionId);
    if (!rows.length) return readOpencodeV1(db, sessionId);
    const out: ChatMessage[] = [];
    for (const r of rows) {
      let d: any; try { d = JSON.parse(r.data); } catch { continue; }
      if (r.type === 'user') {
        if (d.text) out.push({ id: r.id, role: 'user', ts: r.time_created, blocks: [{ type: 'text', text: stripInstructions(d.text) }] });
        continue;
      }
      const blocks: Block[] = [];
      for (const c of d.content ?? []) {
        if (c.type === 'text' && c.text) blocks.push({ type: 'text', text: c.text });
        else if (c.type === 'reasoning' && c.text) blocks.push({ type: 'thinking', text: c.text });
        else if (c.type === 'tool') {
          const st = c.state ?? {};
          const output = typeof st.output === 'string' ? st.output : (st.content ?? []).map((x: any) => x.text ?? '').join('\n');
          blocks.push({ type: 'tool', id: c.id, name: c.name ?? 'tool', input: st.input, output, error: st.status === 'error', durationMs: st.time?.end && st.time?.start ? st.time.end - st.time.start : undefined });
        }
      }
      const tk = d.tokens;
      const usage = tk ? { input: tk.input ?? 0, output: tk.output ?? 0, cacheRead: tk.cache?.read ?? 0, cacheWrite: tk.cache?.write ?? 0, reasoning: tk.reasoning ?? 0 } : undefined;
      const model = d.model ? `${d.model.providerID}/${d.model.id}` : undefined;
      const reported = typeof d.cost === 'number' && d.cost > 0 ? d.cost : undefined;
      const meta = { model, usage, cost: reported ?? estimateCost(model, usage), costEstimated: reported === undefined, endTs: d.time?.completed };
      if (blocks.length) out.push({ id: r.id, role: 'assistant', ts: r.time_created, blocks, meta });
    }
    return out;
  } finally {
    db.close();
  }
}

/** OpenCode 1.x: a `message` row per turn side and its `part` rows (text, reasoning, tool...). */
function readOpencodeV1(db: Database.Database, sessionId: string): ChatMessage[] {
  const msgs = tryAll<any>(db, 'SELECT id, time_created, data FROM message WHERE session_id=? ORDER BY time_created, id', sessionId);
  const parts = new Map<string, any[]>();
  for (const r of tryAll<any>(db, 'SELECT message_id, data FROM part WHERE session_id=? ORDER BY id', sessionId)) {
    let d: any; try { d = JSON.parse(r.data); } catch { continue; }
    (parts.get(r.message_id) ?? parts.set(r.message_id, []).get(r.message_id)!).push(d);
  }
  const out: ChatMessage[] = [];
  for (const r of msgs) {
    let m: any; try { m = JSON.parse(r.data); } catch { continue; }
    const ps = parts.get(r.id) ?? [];
    if (m.role === 'user') {
      const text = ps.filter((p) => p.type === 'text' && !p.synthetic).map((p) => p.text ?? '').join('\n');
      if (text.trim()) out.push({ id: r.id, role: 'user', ts: r.time_created, blocks: [{ type: 'text', text: stripInstructions(text) }] });
      continue;
    }
    const blocks: Block[] = [];
    for (const p of ps) {
      if (p.type === 'text' && p.text) blocks.push({ type: 'text', text: p.text });
      else if (p.type === 'reasoning' && p.text) blocks.push({ type: 'thinking', text: p.text });
      else if (p.type === 'tool') {
        const st = p.state ?? {};
        blocks.push({ type: 'tool', id: p.callID ?? p.id, name: p.tool ?? 'tool', input: st.input, output: typeof st.output === 'string' ? st.output : st.error ? String(st.error) : '', error: st.status === 'error', durationMs: st.time?.end && st.time?.start ? st.time.end - st.time.start : undefined });
      }
    }
    const tk = m.tokens;
    const usage = tk ? { input: tk.input ?? 0, output: tk.output ?? 0, cacheRead: tk.cache?.read ?? 0, cacheWrite: tk.cache?.write ?? 0, reasoning: tk.reasoning ?? 0 } : undefined;
    const model = m.providerID && m.modelID ? `${m.providerID}/${m.modelID}` : undefined;
    const reported = typeof m.cost === 'number' && m.cost > 0 ? m.cost : undefined;
    const meta = { model, usage, cost: reported ?? estimateCost(model, usage), costEstimated: reported === undefined, endTs: m.time?.completed };
    if (blocks.length) out.push({ id: r.id, role: 'assistant', ts: r.time_created, blocks, meta });
  }
  return out;
}

/**
 * What the user actually typed. OpenCode stores the message wrapped in literal quotes, and the first turn
 * of a session carries the hive-am instruction preamble; neither belongs in the transcript.
 */
function stripInstructions(t: string) {
  let x = t.trim();
  if (x.length > 1 && x.startsWith('"') && x.endsWith('"')) x = x.slice(1, -1);
  return stripPreamble(x).trim();
}

/** Folder OpenCode recorded for a session, or null if unknown. Used to avoid resuming a session that belongs to another folder. */
export function opencodeSessionDir(sessionId: string): string | null {
  if (!existsSync(DB)) return null;
  const db = new Database(DB, { readonly: true, fileMustExist: true });
  try {
    const r = tryGet<{ directory?: string }>(db, 'SELECT directory FROM session_v2 WHERE id=?', sessionId) ?? tryGet<{ directory?: string }>(db, 'SELECT directory FROM session WHERE id=?', sessionId);
    return r?.directory ?? null;
  } catch { return null; } finally { db.close(); }
}
