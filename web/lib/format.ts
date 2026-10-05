export const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(2)}k` : String(Math.round(n)));
export const fmtCost = (c: number) => (c === 0 ? '$0' : c < 0.01 ? '<$0.01' : c < 1 ? `$${c.toFixed(3)}` : `$${c.toFixed(2)}`);
export function fmtDur(ms: number): string {
  if (!ms || ms < 0) return '0s';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000; if (s < 10) return `${s.toFixed(1)}s`; if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ${Math.round(s % 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
export const totalTokens = (u?: { input: number; output: number; cacheRead: number; cacheWrite: number }) => (u ? u.input + u.output + u.cacheRead + u.cacheWrite : 0);
