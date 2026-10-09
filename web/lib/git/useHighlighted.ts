'use client';
import { useEffect, useMemo, useState } from 'react';
import { esc, highlightLines } from './highlight';

/** Up to this many characters, highlighting is instant (a few ms) and runs inline. Beyond it, a Web Worker does it. */
const SYNC_LIMIT = 15_000;

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, (lines: string[]) => void>();

function highlightAsync(code: string, path: string): Promise<string[]> {
  return new Promise((resolve) => {
    if (typeof Worker === 'undefined') { setTimeout(() => resolve(highlightLines(code, path)), 0); return; }
    if (!worker) {
      worker = new Worker(new URL('./highlight.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<{ id: number; lines: string[] }>) => { waiting.get(e.data.id)?.(e.data.lines); waiting.delete(e.data.id); };
      worker.onerror = () => { worker = null; };   // next request retries with a fresh worker (or the inline fallback)
    }
    const id = ++seq; waiting.set(id, resolve);
    worker.postMessage({ id, code, path });
  });
}

interface Done { path: string; raws: string[]; html: string[] }

/**
 * Lines of `code` as highlighted HTML.
 * Small text: highlighted immediately. Large text: highlighted in a worker; meanwhile every line that did not change
 * since the last finished run keeps its colours (matched from the start and the end of the file), and only the lines
 * being edited show plain. So editing a big file never waits for the highlighter.
 */
export function useHighlighted(code: string, path: string, debounceMs = 0): string[] {
  const small = code.length <= SYNC_LIMIT;
  const inline = useMemo(() => (small ? highlightLines(code, path) : null), [small, code, path]);
  const raws = useMemo(() => (small ? [] : code.split('\n')), [small, code]);
  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    if (small) return;
    let live = true;
    const t = setTimeout(() => { void highlightAsync(code, path).then((html) => { if (live) setDone({ path, raws: code.split('\n'), html }); }); }, debounceMs);
    return () => { live = false; clearTimeout(t); };
  }, [small, code, path, debounceMs]);

  return useMemo(() => {
    if (inline) return inline;
    if (!done || done.path !== path) return raws.map(esc);
    const a = done.raws;
    let p = 0; while (p < raws.length && p < a.length && raws[p] === a[p]) p++;
    let s = 0; while (s < raws.length - p && s < a.length - p && raws[raws.length - 1 - s] === a[a.length - 1 - s]) s++;
    return raws.map((r, i) => (i < p ? done.html[i] : i >= raws.length - s ? done.html[a.length - (raws.length - i)] : esc(r)));
  }, [inline, done, path, raws]);
}
