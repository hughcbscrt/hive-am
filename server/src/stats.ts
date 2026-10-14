import type { ChatMessage, Provider, Usage } from './types.js';
import { addUsage, emptyUsage } from './pricing.js';
import { contextWindow } from './context.js';

export interface SessionStats {
  usage: Usage;
  /** USD. `costEstimated` is true when any part came from our price table rather than the CLI. */
  cost: number | null;
  costEstimated: boolean;
  turns: number;
  toolCalls: number;
  toolErrors: number;
  toolTimeMs: number;
  durationMs: number;
  tools: { name: string; count: number; errors: number; totalMs: number }[];
  models: { model: string; messages: number; output: number }[];
  /** Tokens the next turn starts from: the last request's input and cache plus the reply it produced. */
  lastContext: number;
  /** Size of the model's context window, when known. */
  contextWindow: number | null;
  /** How full the context is. Null when neither the CLI nor the model gives a window: show `lastContext` instead. */
  contextPct: number | null;
  /** Per user turn: tokens, cost, wall time and tool count, for the timeline. */
  timeline: { ts: number | null; prompt: string; tokens: number; cost: number | null; durationMs: number; tools: number }[];
}

export function sessionStats(msgs: ChatMessage[], provider?: Provider): SessionStats {
  let usage = emptyUsage(); let cost = 0; let any = false; let est = false;
  const tools = new Map<string, { name: string; count: number; errors: number; totalMs: number }>();
  const models = new Map<string, { model: string; messages: number; output: number }>();
  const timeline: SessionStats['timeline'] = [];
  let cur: SessionStats['timeline'][number] | null = null;
  let lastCtx = 0; let ctxModel: string | undefined; let toolCalls = 0, toolErrors = 0, toolTime = 0;

  for (const m of msgs) {
    if (m.compact) { lastCtx = m.compact.post; continue; } // nothing is sent after a compact, so the context is what it left
    if (m.role === 'user') {
      const prompt = m.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('').slice(0, 120);
      cur = { ts: m.ts, prompt, tokens: 0, cost: null, durationMs: 0, tools: 0 };
      timeline.push(cur); continue;
    }
    const u = m.meta?.usage;
    if (u) {
      usage = addUsage(usage, u);
      // A synthetic entry (an error, "no response requested") has no real request behind it: it must not reset the gauge to 0.
      if (u.input + u.cacheRead + u.cacheWrite > 0 && !m.meta?.model?.startsWith('<')) { lastCtx = u.input + u.cacheRead + u.cacheWrite + u.output; ctxModel = m.meta?.model ?? ctxModel; }
      if (cur) cur.tokens += u.input + u.output + u.cacheRead + u.cacheWrite;
    }
    if (m.meta?.cost !== undefined) { cost += m.meta.cost; any = true; est ||= !!m.meta.costEstimated; if (cur) cur.cost = (cur.cost ?? 0) + m.meta.cost; }
    if (m.meta?.model && !m.meta.model.startsWith('<')) { const x = models.get(m.meta.model) ?? { model: m.meta.model, messages: 0, output: 0 }; x.messages++; x.output += u?.output ?? 0; models.set(m.meta.model, x); }
    if (cur && m.meta?.endTs && cur.ts) cur.durationMs = Math.max(cur.durationMs, m.meta.endTs - cur.ts);
    for (const b of m.blocks) {
      if (b.type !== 'tool') continue;
      toolCalls++; if (cur) cur.tools++;
      const t = tools.get(b.name) ?? { name: b.name, count: 0, errors: 0, totalMs: 0 };
      t.count++; if (b.error) { t.errors++; toolErrors++; } t.totalMs += b.durationMs ?? 0; toolTime += b.durationMs ?? 0; tools.set(b.name, t);
    }
  }
  const window = contextWindow(provider, ctxModel);
  return {
    usage, cost: any ? cost : null, costEstimated: est, turns: timeline.length, toolCalls, toolErrors, toolTimeMs: toolTime,
    durationMs: timeline.reduce((n, t) => n + t.durationMs, 0),
    tools: [...tools.values()].sort((a, b) => b.count - a.count),
    models: [...models.values()].sort((a, b) => b.messages - a.messages),
    lastContext: lastCtx, contextWindow: window,
    contextPct: usage.contextPct ?? (window && lastCtx ? Math.min(100, (lastCtx / window) * 100) : null), timeline,
  };
}
