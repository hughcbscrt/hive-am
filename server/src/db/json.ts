/** JSON.parse for a column or a file that may be damaged: the fallback is used (and the problem is logged once per label) instead of throwing into a request. */
const warned = new Set<string>();
export function parseJson<T>(raw: unknown, fallback: T, label = 'json'): T {
  if (raw === null || raw === undefined || raw === '') return fallback;
  try { return JSON.parse(String(raw)) as T; }
  catch (e) {
    if (!warned.has(label)) { warned.add(label); console.warn(`[db] ${label}: unreadable JSON, using a default (${e instanceof Error ? e.message : e})`); }
    return fallback;
  }
}
