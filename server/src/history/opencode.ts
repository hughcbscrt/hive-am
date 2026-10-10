import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Block, ChatMessage } from '../types.js';
import { estimateCost } from '../pricing.js';

const DB = join(homedir(), '.local', 'share', 'opencode', 'opencode.db');

/** Changes when the conversation changes (used to cache what is computed from it). */
export function opencodeSig(sessionId: string): string | null {
  if (!existsSync(DB)) return null;
  const db = new Database(DB, { readonly: true, fileMustExist: true });
  try {
    const r = db.prepare('SELECT COUNT(*) n, COALESCE(MAX(time_created), 0) t FROM session_message WHERE session_id=?').get(sessionId) as { n: number; t: number };
    return `${r.n}:${r.t}`;
  } catch { return null; } finally { db.close(); }
}

export function readOpencode(sessionId: string): ChatMessage[] {
  if (!existsSync(DB)) return [];
  const db = new Database(DB, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(`SELECT id, type, time_created, data FROM session_message WHERE session_id=? AND type IN ('user','assistant') ORDER BY seq`).all(sessionId) as any[];
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

/**
 * What the user actually typed. OpenCode stores the message wrapped in literal quotes, and the first turn
 * of a session carries the hive-am instruction preamble; neither belongs in the transcript.
 */
function stripInstructions(t: string) {
  let x = t.trim();
  if (x.length > 1 && x.startsWith('"') && x.endsWith('"')) x = x.slice(1, -1);
  return x.replace(/^<instructions[^>]*>[\s\S]*?<\/instructions>\s*/, '').trim();
}

/** Folder OpenCode recorded for a session, or null if unknown. Used to avoid resuming a session that belongs to another folder. */
export function opencodeSessionDir(sessionId: string): string | null {
  if (!existsSync(DB)) return null;
  const db = new Database(DB, { readonly: true, fileMustExist: true });
  try {
    const r = db.prepare('SELECT directory FROM session_v2 WHERE id=?').get(sessionId) as { directory?: string } | undefined;
    return r?.directory ?? null;
  } catch { return null; } finally { db.close(); }
}
