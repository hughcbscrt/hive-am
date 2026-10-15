'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

/** Read/write one JSON value in localStorage; every access is guarded (private mode, blocked storage, bad JSON). */
export function readStored<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw === null ? fallback : (JSON.parse(raw) as T); } catch { return fallback; }
}
export function writeStored(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}
/**
 * Usage: `const [view, setView] = usePersistentState<'list' | 'grid'>('hive-am.agentsView', 'list')`.
 * Renders `initial` on the server and first client render (no hydration mismatch), then switches to the stored
 * value before the browser paints (a layout effect), so the saved layout never flashes the default one first. Setting it saves it. Values must be JSON-serialisable. Keep keys under the `hive-am.` prefix for new ones.
 * Note: existing keys that hold raw strings (not JSON) are not readable with this hook; use readStored there.
 */
export function usePersistentState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  const cur = useRef(value); cur.current = value;
  useLayoutEffect(() => { setValue(readStored(key, initial)); setLoaded(true); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = useCallback<Dispatch<SetStateAction<T>>>((v) => {
    const next = typeof v === 'function' ? (v as (p: T) => T)(cur.current) : v;
    cur.current = next; setValue(next); writeStored(key, next);
  }, [key]);
  return [value, set, loaded];
}
