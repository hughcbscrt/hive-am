'use client';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { readStored, writeStored } from './hooks/usePersistentState';
import { useHiveActions, useHiveSelector } from './store';
import { useI18n } from './i18n';
import {
  NOTIFY_KEY, UNREAD_KEY, addNotice, markAll as clearAll, markRead as dropOne, orderedNotices, pruneUnread, shouldPrune, shouldRecord, tabTitle,
  type Notice, type Unread,
} from './attentionRules';

/*
 * Unread notices: what finished while you were looking elsewhere. Kept per agent in this browser (`hive-am.unread`), shared
 * between tabs through the `storage` event. It reads the store with narrow selectors only (never `live`), so a streamed token
 * re-renders nothing here. Rules in lib/attentionRules.ts.
 */

export type NotifyState = 'unsupported' | 'default' | 'granted' | 'denied';
interface AttnCtx {
  unread: Unread;
  /** Id of the agent with the most recent notice, or null. */
  latest: string | null;
  markRead: (id: string) => void;
  markAll: () => void;
  /** Browser notifications: the saved choice and what the browser allows. */
  notify: boolean; notifyState: NotifyState; setNotify: (on: boolean) => Promise<void>;
  /** Says something through the polite live region (at most one message every 2 s). */
  announce: (text: string) => void;
}
interface PanelCtx { open: boolean; openActivity: () => void; closeActivity: () => void; toggleActivity: () => void }
const A = createContext<AttnCtx | null>(null);
const P = createContext<PanelCtx | null>(null);

export const useAttention = (): AttnCtx => { const c = useContext(A); if (!c) throw new Error('AttentionProvider missing'); return c; };
export const useActivityPanel = (): PanelCtx => { const c = useContext(P); if (!c) throw new Error('AttentionProvider missing'); return c; };

const ANNOUNCE_GAP = 2000;
const viewedAgent = (path: string | null) => /^\/agents\/([^/]+)/.exec(path ?? '')?.[1] ?? null;

/** Whatever is stored, keep only well-formed notices (an old or hand-edited value must not break the rail). */
function readUnread(): Unread {
  const raw = readStored<unknown>(UNREAD_KEY, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Unread = {};
  for (const [id, n] of Object.entries(raw as Record<string, Partial<Notice>>)) {
    if (n && (n.kind === 'done' || n.kind === 'error') && typeof n.at === 'number') out[id] = { kind: n.kind, at: n.at, snippet: typeof n.snippet === 'string' ? n.snippet : '' };
  }
  return out;
}

function notifyState(): NotifyState {
  if (typeof Notification === 'undefined' || !window.isSecureContext) return 'unsupported';
  return Notification.permission === 'default' ? 'default' : Notification.permission;
}

export function AttentionProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const path = usePathname();
  const router = useRouter();
  const { agent, onTurnEnd } = useHiveActions();
  const agents = useHiveSelector((s) => s.agents);
  const ready = useHiveSelector((s) => s.ready);

  const [unread, setUnread] = useState<Unread>({});
  const cur = useRef<Unread>({});
  const [loaded, setLoaded] = useState(false);
  const [notifyOn, setNotifyOn] = useState(false);
  const [perm, setPerm] = useState<NotifyState>('unsupported');
  const update = useCallback((fn: (u: Unread) => Unread) => {
    const next = fn(cur.current);
    if (next === cur.current) return;
    cur.current = next; setUnread(next); writeStored(UNREAD_KEY, next);
  }, []);

  // Stored values only after mounting, so the first render matches the server's.
  useLayoutEffect(() => {
    cur.current = readUnread(); setUnread(cur.current);
    setNotifyOn(readStored<boolean>(NOTIFY_KEY, false) === true); setPerm(notifyState());
    setLoaded(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === UNREAD_KEY || e.key === null) { cur.current = readUnread(); setUnread(cur.current); }
      if (e.key === NOTIFY_KEY || e.key === null) setNotifyOn(readStored<boolean>(NOTIFY_KEY, false) === true);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // What "seen" means: the route is that agent's chat and the tab is visible. Kept in refs for the turn listener.
  const [visible, setVisible] = useState(true);
  const visibleRef = useRef(true), pathRef = useRef(path);
  pathRef.current = path;
  useEffect(() => {
    const read = () => { visibleRef.current = document.visibilityState === 'visible'; setVisible(visibleRef.current); };
    read();
    document.addEventListener('visibilitychange', read);
    return () => document.removeEventListener('visibilitychange', read);
  }, []);
  const viewed = viewedAgent(path);
  useEffect(() => { if (loaded && visible && viewed && unread[viewed]) update((u) => dropOne(u, viewed)); }, [loaded, visible, viewed, unread, update]);

  // Prune once the agents are known (an empty list while loading would drop everything).
  useEffect(() => { if (loaded && shouldPrune(ready)) update((u) => pruneUnread(u, new Set(agents.map((a) => a.id)))); }, [loaded, ready, agents, update]);

  // The live region: a message replaces the pending one, and none is said sooner than 2 s after the previous.
  const [said, setSaid] = useState('');
  const sayTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSaid = useRef(0);
  const announce = useCallback((text: string) => {
    clearTimeout(sayTimer.current); setSaid('');
    const wait = Math.max(0, lastSaid.current + ANNOUNCE_GAP - Date.now());
    sayTimer.current = setTimeout(() => { lastSaid.current = Date.now(); setSaid(text); }, wait);
  }, []);
  useEffect(() => () => clearTimeout(sayTimer.current), []);

  const notifyRef = useRef(false);
  notifyRef.current = notifyOn && perm === 'granted';
  // Permission is asked only here, when the person switches it on.
  const setNotify = useCallback(async (on: boolean) => {
    if (!on) { setNotifyOn(false); writeStored(NOTIFY_KEY, false); return; }
    let p = notifyState();
    if (p === 'default') { try { await Notification.requestPermission(); } catch { /* old browsers: the callback form, or nothing */ } p = notifyState(); }
    setPerm(p);
    const granted = p === 'granted';
    setNotifyOn(granted); writeStored(NOTIFY_KEY, granted);
  }, []);

  const tRef = useRef(t); tRef.current = t;
  useEffect(() => onTurnEnd((end) => {
    const seen = viewedAgent(pathRef.current) === end.agentId && visibleRef.current;
    if (!shouldRecord(end, seen)) return;
    update((u) => addNotice(u, end));
    const name = agent(end.agentId)?.name ?? '';
    const tr = tRef.current;
    if (visibleRef.current) announce(tr(end.kind === 'error' ? 'attn.announce.error' : 'attn.announce.done', { name }));
    if (notifyRef.current && (document.hidden || !document.hasFocus())) {
      try {
        const n = new Notification(name, { body: [tr(end.kind === 'error' ? 'status.error' : 'attn.state.done'), end.snippet].filter(Boolean).join('\n'), tag: end.agentId, silent: true });
        n.onclick = () => { window.focus(); router.push(`/agents/${end.agentId}`); n.close(); };
      } catch { /* a browser that only allows notifications from a service worker */ }
    }
  }), [onTurnEnd, update, agent, announce, router]);

  // The tab title counts the agents with a notice. Next may set the title again on navigation: put ours back.
  const count = Object.keys(unread).length;
  const want = useRef('hive-am');
  useEffect(() => { want.current = tabTitle(count); if (document.title !== want.current) document.title = want.current; }, [count, path]);
  useEffect(() => {
    const mo = new MutationObserver(() => { if (document.title !== want.current) document.title = want.current; });
    mo.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, []);

  const [open, setOpen] = useState(false);
  const panel = useMemo<PanelCtx>(() => ({ open, openActivity: () => setOpen(true), closeActivity: () => setOpen(false), toggleActivity: () => setOpen((o) => !o) }), [open]);

  const value = useMemo<AttnCtx>(() => ({
    unread, latest: orderedNotices(unread)[0]?.id ?? null,
    markRead: (id) => update((u) => dropOne(u, id)), markAll: () => update(clearAll),
    notify: notifyOn && perm === 'granted', notifyState: perm, setNotify, announce,
  }), [unread, update, notifyOn, perm, setNotify, announce]);

  return (
    <A.Provider value={value}>
      <P.Provider value={panel}>
        {children}
        <div className="sr-only" role="status" aria-live="polite" data-live>{said}</div>
      </P.Provider>
    </A.Provider>
  );
}
