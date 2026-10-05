import type { Usage } from './types.js';

/** USD per million tokens. Family-level estimates: CLIs that report real cost override these. */
const FAMILIES: [RegExp, { in: number; out: number; cr: number; cw: number }][] = [
  [/opus/i, { in: 5, out: 25, cr: 0.5, cw: 6.25 }],
  [/sonnet/i, { in: 3, out: 15, cr: 0.3, cw: 3.75 }],
  [/haiku/i, { in: 1, out: 5, cr: 0.1, cw: 1.25 }],
];

export function estimateCost(model: string | undefined, u: Usage | undefined): number | undefined {
  if (!model || !u) return undefined;
  const f = FAMILIES.find(([re]) => re.test(model))?.[1];
  if (!f) return undefined;
  return (u.input * f.in + (u.output + 0) * f.out + u.cacheRead * f.cr + u.cacheWrite * f.cw) / 1e6;
}

export const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 });
export function addUsage(a: Usage, b: Partial<Usage>): Usage {
  return {
    input: a.input + (b.input ?? 0), output: a.output + (b.output ?? 0), cacheRead: a.cacheRead + (b.cacheRead ?? 0),
    cacheWrite: a.cacheWrite + (b.cacheWrite ?? 0), reasoning: a.reasoning + (b.reasoning ?? 0),
    credits: (a.credits ?? 0) + (b.credits ?? 0) || undefined, contextPct: b.contextPct ?? a.contextPct,
  };
}
