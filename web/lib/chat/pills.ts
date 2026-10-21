import type { Block } from '@/lib/types';

type Tool = Extract<Block, { type: 'tool' }>;

/** A reply cut into its text blocks and the runs of steps (reasoning and tools) between them, by block index. */
export type Run = { text: number } | { steps: number[] };
export function splitRuns(blocks: Block[]): Run[] {
  const out: Run[] = [];
  blocks.forEach((b, i) => {
    if (b.type === 'text') { out.push({ text: i }); return; }
    const last = out[out.length - 1];
    if (last && 'steps' in last) last.steps.push(i); else out.push({ steps: [i] });
  });
  return out;
}

/** What the summary pill of a folded reply counts. The reply's own duration wins; without it, the time its tools took. */
export interface Summary { steps: number; tools: number; failed: number; durationMs: number }
export function summarize(blocks: Block[], durationMs: number | undefined, failed: (tool: Tool) => boolean): Summary {
  let steps = 0, tools = 0, bad = 0, toolMs = 0;
  for (const b of blocks) {
    if (b.type === 'text') continue;
    steps++;
    if (b.type !== 'tool') continue;
    tools++; toolMs += b.durationMs ?? 0;
    if (failed(b)) bad++;
  }
  return { steps, tools, failed: bad, durationMs: durationMs || toolMs };
}
