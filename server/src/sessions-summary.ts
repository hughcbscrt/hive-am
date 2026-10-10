import { historySig, readHistory } from './history/index.js';
import { emptyUsage } from './pricing.js';
import { sessionStats } from './stats.js';
import type { Usage } from './types.js';

/**
 * What the Sessions list shows about each conversation (size, cost, first words). Computing it means reading the whole conversation, which
 * can be tens of MB, so it is never done while answering the list: the list returns what is cached and the rest is filled in the
 * background, newest first, one conversation at a time. A cached entry is reused until the conversation changes.
 */
export interface SessionSummary { message_count: number; preview: string; usage: Usage; cost: number | null; tool_calls: number; model: string | null }
interface Target { provider: 'claude' | 'opencode' | 'kiro'; cwd: string; session_id: string }

const cache = new Map<string, { sig: string; summary: SessionSummary }>();
const queued = new Set<string>();
const queue: Target[] = [];
let working = false;
const keyOf = (t: Target) => `${t.provider}:${t.session_id}`;

function compute(t: Target): SessionSummary {
  const msgs = readHistory(t, t.session_id);
  const first = msgs.find((m) => m.role === 'user')?.blocks.find((b) => b.type === 'text');
  const st = sessionStats(msgs);
  return { message_count: msgs.length, preview: first && first.type === 'text' ? first.text.slice(0, 160) : '', usage: st.usage, cost: st.cost, tool_calls: st.toolCalls, model: st.models[0]?.model ?? null };
}

async function work(): Promise<void> {
  if (working) return;
  working = true;
  try {
    for (let t = queue.shift(); t; t = queue.shift()) {
      queued.delete(keyOf(t));
      const sig = historySig(t, t.session_id);
      if (sig === null) { cache.set(keyOf(t), { sig: '', summary: { message_count: 0, preview: '', usage: emptyUsage(), cost: null, tool_calls: 0, model: null } }); continue; }
      try { cache.set(keyOf(t), { sig, summary: compute(t) }); } catch (e) { console.error('[sessions] summary failed', t.session_id, e); }
      await new Promise((r) => setImmediate(r)); // let requests through between conversations
    }
  } finally { working = false; }
}

/** The summary if it is known, with `fresh: false` when it is old or missing (it is then recomputed in the background: ask again later). */
export function summaryOf(t: Target): { summary: SessionSummary | null; fresh: boolean } {
  const k = keyOf(t), hit = cache.get(k), sig = historySig(t, t.session_id);
  if (hit && hit.sig === (sig ?? '')) return { summary: hit.summary, fresh: true };
  if (!queued.has(k)) { queued.add(k); queue.push(t); void work(); }
  return { summary: hit?.summary ?? null, fresh: false }; // an old one is better than nothing while the new one is computed
}
