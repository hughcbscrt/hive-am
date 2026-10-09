/**
 * Sliding-window limit: at most `limit` events per key in the last `windowMs`. Same idea as tide-commander's per-trigger limit
 * (10 per minute by default; 0 or less switches it off): a flood does not wake the agent a hundred times.
 */
const hits = new Map<string, number[]>();

export function allow(key: string, limit: number, windowMs = 60_000, now = Date.now()): boolean {
  if (!(limit > 0)) return true;
  const list = hits.get(key) ?? [];
  while (list.length && list[0] <= now - windowMs) list.shift();
  if (list.length >= limit) { hits.set(key, list); return false; }
  list.push(now);
  hits.set(key, list);
  return true;
}
export const forgetRate = (key: string) => { hits.delete(key); };
