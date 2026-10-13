'use client';
import { useCallback, useEffect, useState } from 'react';

/**
 * Usage: `const [tab, setTab] = useQueryState('tab', 'chat')` keeps `?tab=...` in the URL without reloading
 * or adding history entries (history.replaceState), so tabs and selections survive refresh and can be shared.
 * Setting the default value removes the param. Values are strings; `useQueryState` renders `initial` first
 * (SSR/hydration safe) and then reads the URL. Works with the Next 15 App Router (no useSearchParams, so no Suspense needed).
 * Back/forward and other replaceState calls from this hook stay in sync.
 */
const EVT = 'hive-am:query';
export function useQueryState(key: string, initial: string): [string, (v: string) => void] {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    const read = () => setValue(new URLSearchParams(location.search).get(key) ?? initial);
    read();
    window.addEventListener('popstate', read); window.addEventListener(EVT, read);
    return () => { window.removeEventListener('popstate', read); window.removeEventListener(EVT, read); };
  }, [key, initial]);
  const set = useCallback((v: string) => {
    const u = new URL(location.href);
    if (v === initial) u.searchParams.delete(key); else u.searchParams.set(key, v);
    // Keep Next's own history state so its router does not lose track of the entry.
    history.replaceState(history.state, '', u);
    setValue(v);
    window.dispatchEvent(new Event(EVT));
  }, [key, initial]);
  return [value, set];
}
