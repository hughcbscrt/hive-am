import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Block, ChatMessage } from '../types.js';
import { estimateCost } from '../pricing.js';

const ROOT = join(homedir(), '.claude', 'projects');
/** Claude encodes the project path by replacing both "/" and "." with "-". */
const encode = (cwd: string) => cwd.replace(/[/.]/g, '-');

/** An instructions update sent in front of a message (see providers/preamble.ts) is not part of what the user wrote. */
const stripPreamble = (x: string) => x.replace(/^<instructions[^>]*>[\s\S]*?<\/instructions>\s*/, '');

export function claudeFile(cwd: string, sessionId: string): string | null {
  if (!/^[\w-]+$/.test(sessionId)) return null;
  const direct = join(ROOT, encode(cwd), `${sessionId}.jsonl`);
  if (existsSync(direct)) return direct;
  try {
    for (const d of readdirSync(ROOT)) {
      const f = join(ROOT, d, `${sessionId}.jsonl`);
      if (existsSync(f)) return f;
    }
  } catch { /* no Claude data yet */ }
  return null;
}

export function readClaude(cwd: string, sessionId: string): ChatMessage[] {
  const file = claudeFile(cwd, sessionId);
  if (!file) return [];
  const out: ChatMessage[] = [];
  const byMsgId = new Map<string, ChatMessage>();
  const toolBlocks = new Map<string, Extract<Block, { type: 'tool' }>>();
  const toolStart = new Map<string, number>();

  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let e: any; try { e = JSON.parse(line); } catch { continue; }
    if (e.isSidechain || e.isMeta || (e.type !== 'user' && e.type !== 'assistant')) continue;
    const m = e.message; if (!m) continue;
    const ts = e.timestamp ? Date.parse(e.timestamp) : null;

    if (e.type === 'user') {
      if (typeof m.content === 'string') {
        const content = stripPreamble(m.content);
        if (content.startsWith('<')) continue; // command/system wrappers
        out.push({ id: e.uuid, role: 'user', ts, blocks: [{ type: 'text', text: content }] });
      } else if (Array.isArray(m.content)) {
        const text: Block[] = [];
        for (const b of m.content) {
          if (b.type === 'tool_result') {
            const t = toolBlocks.get(b.tool_use_id);
            if (t) {
              t.output = flat(b.content); t.error = !!b.is_error;
              const st = toolStart.get(b.tool_use_id); if (st && ts) t.durationMs = Math.max(0, ts - st);
            }
          } else if (b.type === 'text' && b.text) { const t = stripPreamble(b.text); if (t) text.push({ type: 'text', text: t }); }
        }
        if (text.length) out.push({ id: e.uuid, role: 'user', ts, blocks: text });
      }
    } else {
      // Claude writes one JSONL line per content block, all sharing message.id.
      let msg = byMsgId.get(m.id);
      if (!msg) { msg = { id: m.id ?? e.uuid, role: 'assistant', ts, blocks: [] }; byMsgId.set(m.id, msg); out.push(msg); }
      if (ts) msg.meta = { ...msg.meta, endTs: ts };
      const u = m.usage;
      if (u) {
        // Every line of one message repeats its usage; output_tokens grows while streaming, so keep the max.
        const prev = msg.meta?.usage;
        const usage = {
          input: u.input_tokens ?? 0, output: Math.max(u.output_tokens ?? 0, prev?.output ?? 0),
          cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0,
          reasoning: u.output_tokens_details?.thinking_tokens ?? 0,
        };
        msg.meta = { ...msg.meta, model: m.model, usage, cost: estimateCost(m.model, usage), costEstimated: true };
      }
      for (const b of m.content ?? []) {
        if (b.type === 'text' && b.text) msg.blocks.push({ type: 'text', text: b.text });
        else if (b.type === 'thinking' && b.thinking) msg.blocks.push({ type: 'thinking', text: b.thinking });
        else if (b.type === 'tool_use') {
          const blk = { type: 'tool' as const, id: b.id, name: b.name, input: b.input };
          toolBlocks.set(b.id, blk); if (ts) toolStart.set(b.id, ts); msg.blocks.push(blk);
        }
      }
    }
  }
  return out.filter((m) => m.blocks.length);
}

export function claudeMeta(file: string) {
  const st = statSync(file);
  return { mtime: st.mtimeMs, size: st.size };
}

function flat(c: unknown): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x: any) => (typeof x === 'string' ? x : x?.text ?? '')).join('\n');
  return c == null ? '' : JSON.stringify(c);
}
