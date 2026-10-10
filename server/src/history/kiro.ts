import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Block, ChatMessage, MsgMeta } from '../types.js';

const DIR = join(homedir(), '.kiro', 'sessions', 'cli');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Changes when the conversation changes (used to cache what is computed from it). */
export function kiroSig(sessionId: string): string | null {
  if (!UUID.test(sessionId)) return null;
  try { const st = statSync(join(DIR, `${sessionId}.jsonl`)); return `${st.mtimeMs}:${st.size}`; } catch { return null; }
}

export function readKiro(sessionId: string): ChatMessage[] {
  if (!UUID.test(sessionId)) return [];
  const file = join(DIR, `${sessionId}.jsonl`);
  if (!existsSync(file)) return [];
  const out: ChatMessage[] = [];
  const turns = turnMeta(sessionId);
  let turnIdx = -1; let lastAssistant: ChatMessage | null = null;
  const flush = () => { if (lastAssistant && turnIdx >= 0 && turns[turnIdx]) lastAssistant.meta = turns[turnIdx]; lastAssistant = null; };
  const tools = new Map<string, Extract<Block, { type: 'tool' }>>();

  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let e: any; try { e = JSON.parse(line); } catch { continue; }
    const d = e.data; if (!d) continue;
    const ts = d.meta?.timestamp ? d.meta.timestamp * 1000 : null;

    if (e.kind === 'Prompt') {
      flush(); turnIdx++;
      const text = (d.content ?? []).filter((b: any) => b.kind === 'text').map((b: any) => b.data).join('');
      if (text.trim()) out.push({ id: d.message_id, role: 'user', ts, blocks: [{ type: 'text', text: text.replace(/^<instructions[^>]*>[\s\S]*?<\/instructions>\s*/, '') }] });
    } else if (e.kind === 'AssistantMessage') {
      const blocks: Block[] = [];
      for (const b of d.content ?? []) {
        if (b.kind === 'text' && b.data) blocks.push({ type: 'text', text: b.data });
        else if (b.kind === 'thinking' && b.data?.text) blocks.push({ type: 'thinking', text: b.data.text });
        else if (b.kind === 'toolUse' && b.data) {
          const blk = { type: 'tool' as const, id: b.data.toolUseId ?? b.data.id ?? String(blocks.length), name: b.data.name ?? 'tool', input: b.data.input };
          tools.set(blk.id, blk); blocks.push(blk);
        }
      }
      if (blocks.length) { const msg: ChatMessage = { id: d.message_id, role: 'assistant', ts, blocks }; out.push(msg); lastAssistant = msg; }
    } else if (e.kind === 'ToolResults') {
      for (const r of d.content ?? []) {
        const x = r.data ?? r; const t = tools.get(x.toolUseId ?? x.id);
        if (t) t.output = JSON.stringify(x.content ?? x).slice(0, 8000);
      }
    }
  }
  flush();
  return out;
}

/** Kiro keeps per-turn metering (credits, duration, context %) in the session's .json, in turn order. */
function turnMeta(sessionId: string): MsgMeta[] {
  const out: MsgMeta[] = [];
  try {
    const j = JSON.parse(readFileSync(join(DIR, `${sessionId}.json`), 'utf8'));
    for (const t of j.session_state?.conversation_metadata?.user_turn_metadatas ?? []) {
            const credits = (t.metering_usage ?? []).reduce((n: number, m: any) => n + (m.value ?? 0), 0);
      const dur = t.turn_duration ? t.turn_duration.secs * 1000 + Math.round((t.turn_duration.nanos ?? 0) / 1e6) : undefined;
      const end = t.end_timestamp ? Date.parse(t.end_timestamp) : undefined;
      out.push({
        model: t.model,
        usage: { input: t.input_token_count ?? 0, output: t.output_token_count ?? 0, cacheRead: t.cache_read_input_token_count ?? 0, cacheWrite: t.cache_write_input_token_count ?? 0, reasoning: 0, credits: credits || undefined, contextPct: t.final_context_usage_percentage ?? t.context_usage_percentage },
        endTs: end,
      });
    }
  } catch { /* no metering file yet */ }
  return out;
}
