'use client';
import { useEffect, useRef } from 'react';

export interface PollingOpts {
  enabled?: boolean;
  /** Skip ticks while the tab is hidden and fetch once on return (default true). */
  pauseHidden?: boolean;
  /** Run once right away instead of waiting `ms` (default true). */
  immediate?: boolean;
  /** Called once per failure streak (not on every failed tick): show a single toast here. Reset by the next success. */
  onError?: (e: unknown) => void;
}
/**
 * Usage: `usePolling(() => api.get('/x').then(setX), 10_000, { enabled: !!id, onError: (e) => toast.err(...) })`.
 * Runs `fn` every `ms`, never overlapping itself, pausing while the tab is hidden. A throwing/rejecting `fn`
 * backs off (x2 up to 6x `ms`) and reports one `onError` per streak. `fn` may change between renders freely.
 */
export function usePolling(fn: () => unknown | Promise<unknown>, ms: number, { enabled = true, pauseHidden = true, immediate = true, onError }: PollingOpts = {}) {
  const f = useRef(fn); f.current = fn;
  const onErr = useRef(onError); onErr.current = onError;
  useEffect(() => {
    if (!enabled) return;
    let stop = false; let timer: ReturnType<typeof setTimeout> | undefined; let fails = 0; let running = false;
    const hidden = () => pauseHidden && typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const schedule = () => { clearTimeout(timer); if (!stop) timer = setTimeout(() => void tick(), ms * Math.min(6, 2 ** fails)); };
    const tick = async (first = false) => {
      if (stop || running) return;
      if (!first && hidden()) { schedule(); return; }   // the first load always runs, so a tab opened in the background is not left empty
      running = true;
      try { await f.current(); fails = 0; }
      catch (e) { if (fails++ === 0) onErr.current?.(e); }
      finally { running = false; schedule(); }
    };
    const visible = () => { if (document.visibilityState === 'visible' && !running) { clearTimeout(timer); void tick(); } };
    if (immediate) void tick(true); else schedule();
    if (pauseHidden) document.addEventListener('visibilitychange', visible);
    return () => { stop = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [ms, enabled, pauseHidden, immediate]);
}
