'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DiffLine, ParsedDiff } from './diff';
import { readStored, writeStored } from '../hooks/usePersistentState';
import { useHiveSelector } from '../store';
import { STORE_PREFIX, clampText, makeComment, markGone, pruneComments, reanchor, storeKey, type DiffComment } from './diffComments';

/** A comment being written that is not saved yet: kept in memory so leaving the file (or the Changes tab) does not lose it. */
export interface DiffDraft { path: string; lines: DiffLine[]; text: string; editingId?: string }

export interface DiffCommentsStore {
  items: DiffComment[];
  add: (path: string, lines: DiffLine[], text: string) => DiffComment;
  update: (id: string, text: string) => void;
  remove: (id: string) => void;
  clear: () => void;
  /** The diff of `path` loaded: comments follow their lines or become outdated. */
  relocate: (path: string, parsed: ParsedDiff) => void;
  /** The changed files: comments of a file that left them become outdated (not when the list is truncated). */
  syncChanges: (paths: ReadonlySet<string>, truncated: boolean) => void;
  getDraft: () => DiffDraft | null;
  setDraft: (d: DiffDraft | null) => void;
}

const isComment = (c: unknown): c is DiffComment => !!c && typeof c === 'object' && typeof (c as DiffComment).id === 'string' && typeof (c as DiffComment).path === 'string'
  && typeof (c as DiffComment).text === 'string' && typeof (c as DiffComment).at === 'number' && Array.isArray((c as DiffComment).quote) && typeof (c as DiffComment).sig === 'string';
const read = (agentId: string): DiffComment[] => { const raw = readStored<unknown>(storeKey(agentId), []); return Array.isArray(raw) ? raw.filter(isComment) : []; };
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);

/**
 * The comments one agent has on its current diff, in this browser (`hive-am.diffc.<agentId>`), shared between tabs with the `storage`
 * event. It lives on the agent page, not in the explorer, which is unmounted when you go back to the chat.
 */
export function useDiffComments(agentId: string): DiffCommentsStore {
  const [items, setItems] = useState<DiffComment[]>([]);
  const cur = useRef<DiffComment[]>([]);
  const key = storeKey(agentId);
  const commit = useCallback((next: DiffComment[]) => {
    if (next === cur.current) return;
    cur.current = next; setItems(next);
    if (next.length) writeStored(key, next);
    else try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
  }, [key]);

  useLayoutEffect(() => {
    const load = () => { const got = read(agentId); cur.current = got; setItems(got); return got; };
    const got = load();
    const kept = pruneComments(got, Date.now());
    if (kept !== got) commit(kept);
    const onStorage = (e: StorageEvent) => { if (e.key === key || e.key === null) load(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [agentId, key, commit]);

  // Once the agents loaded, drop what is stored for agents that no longer exist.
  const agents = useHiveSelector((s) => s.agents);
  const ready = useHiveSelector((s) => s.ready);
  useEffect(() => {
    if (!ready) return;
    const ids = new Set(agents.map((a) => a.id));
    try {
      const stale: string[] = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(STORE_PREFIX) && !ids.has(k.slice(STORE_PREFIX.length))) stale.push(k); }
      stale.forEach((k) => localStorage.removeItem(k));
    } catch { /* storage unavailable */ }
  }, [ready, agents]);

  const draft = useRef<DiffDraft | null>(null);
  useEffect(() => { draft.current = null; }, [agentId]);

  return useMemo<DiffCommentsStore>(() => ({
    items,
    add: (path, lines, text) => { const c = makeComment(path, lines, text, Date.now(), newId()); commit([...cur.current, c]); return c; },
    update: (id, text) => commit(cur.current.map((c) => (c.id === id ? { ...c, text: clampText(text) } : c))),
    remove: (id) => commit(cur.current.filter((c) => c.id !== id)),
    clear: () => commit([]),
    relocate: (path, parsed) => commit(reanchor(parsed, path, cur.current)),
    syncChanges: (paths, truncated) => commit(markGone(cur.current, paths, truncated)),
    getDraft: () => draft.current,
    setDraft: (d) => { draft.current = d; },
  }), [items, commit]);
}
