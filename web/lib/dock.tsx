'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import { useI18n } from './i18n';

/** What the bottom panel holds: terminals (they live in the server) and read-only log views of objects. */
export type DockTab =
  | { key: string; kind: 'term'; id: string; title: string; cwd: string; ended?: number | null }
  | { key: string; kind: 'logs'; objectId: string; title: string };
export interface TerminalSpec { cwd?: string; title?: string; objectId?: string; agentId?: string }

interface Ctx {
  open: boolean; height: number; tabs: DockTab[]; active: string | null; enabled: boolean; error: string;
  toggle: () => void; setOpen: (v: boolean) => void; setHeight: (h: number) => void; setActive: (k: string) => void;
  openTerminal: (spec?: TerminalSpec) => Promise<void>;
  openLogs: (objectId: string, title: string) => void;
  closeTab: (key: string) => void; markEnded: (key: string, code: number | null) => void;
}
const C = createContext<Ctx | null>(null);
export const useDock = () => { const c = useContext(C); if (!c) throw new Error('DockProvider missing'); return c; };

const KEY = 'hive-am.dock';
const MIN_H = 140;
const clamp = (h: number) => Math.max(MIN_H, Math.min(h, Math.round((typeof window === 'undefined' ? 900 : window.innerHeight) * 0.8)));

/** Keeps the panel's state. The page gives the content the height that is left (`--app-h`), so nothing hides behind the panel. */
export function DockProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpenState] = useState(false);
  const [height, setHeightState] = useState(320);
  const [tabs, setTabs] = useState<DockTab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState('');
  const loaded = useRef(false);

  // What was left open, and the terminals the server still has (they survive a reload).
  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem(KEY) ?? '{}'); if (typeof s.height === 'number') setHeightState(clamp(s.height)); if (s.open) setOpenState(true); if (typeof s.active === 'string') setActive(s.active); } catch { /* none */ }
    api.get<{ enabled: boolean; terminals: { id: string; title: string; cwd: string; alive: boolean; exitCode: number | null }[] }>('/terminals').then((r) => {
      setEnabled(r.enabled);
      setTabs((cur) => [...r.terminals.map((x): DockTab => ({ key: `t:${x.id}`, kind: 'term', id: x.id, title: x.title, cwd: x.cwd, ended: x.alive ? undefined : x.exitCode })), ...cur.filter((c) => c.kind === 'logs')]);
      setActive((a) => (a && r.terminals.some((x) => `t:${x.id}` === a) ? a : r.terminals[0] ? `t:${r.terminals[0].id}` : a));
    }).catch(() => undefined).finally(() => { loaded.current = true; });
  }, []);
  useEffect(() => { if (loaded.current) try { localStorage.setItem(KEY, JSON.stringify({ open, height, active })); } catch { /* private mode */ } }, [open, height, active]);
  useEffect(() => { document.documentElement.style.setProperty('--app-h', open ? `calc(100vh - ${height}px)` : '100vh'); }, [open, height]);

  const openTerminal = useCallback(async (spec: TerminalSpec = {}) => {
    setError('');
    try {
      const r = await api.post<{ id: string; title: string; cwd: string }>('/terminals', spec);
      const tab: DockTab = { key: `t:${r.id}`, kind: 'term', id: r.id, title: r.title, cwd: r.cwd };
      setTabs((x) => [...x, tab]); setActive(tab.key); setOpenState(true);
    } catch (e) { setError(e instanceof Error ? e.message : t('dock.failed')); setOpenState(true); }
  }, [t]);
  const openLogs = useCallback((objectId: string, title: string) => {
    const key = `l:${objectId}`;
    setTabs((x) => (x.some((y) => y.key === key) ? x : [...x, { key, kind: 'logs', objectId, title }])); setActive(key); setOpenState(true);
  }, []);
  const closeTab = useCallback((key: string) => {
    setTabs((x) => {
      const tab = x.find((y) => y.key === key);
      if (tab?.kind === 'term') void api.del(`/terminals/${tab.id}`).catch(() => undefined);
      const rest = x.filter((y) => y.key !== key);
      setActive((a) => (a === key ? rest[rest.length - 1]?.key ?? null : a));
      return rest;
    });
  }, []);
  const markEnded = useCallback((key: string, code: number | null) => setTabs((x) => x.map((y) => (y.key === key && y.kind === 'term' ? { ...y, ended: code ?? 0 } : y))), []);
  const toggle = useCallback(() => {
    if (open) { setOpenState(false); return; }
    setOpenState(true);
    if (!tabs.length && enabled) void openTerminal();      // the first time there is nothing to show: start a terminal
  }, [open, tabs.length, enabled, openTerminal]);

  // Ctrl+` opens and closes the panel, even while a terminal has the focus.
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.ctrlKey && !e.altKey && !e.metaKey && (e.key === '`' || e.code === 'Backquote')) { e.preventDefault(); e.stopPropagation(); toggle(); } };
    window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true);
  }, [toggle]);

  const value = useMemo<Ctx>(() => ({ open, height, tabs, active, enabled, error, toggle, setOpen: setOpenState, setHeight: (h) => setHeightState(clamp(h)), setActive, openTerminal, openLogs, closeTab, markEnded }), [open, height, tabs, active, enabled, error, toggle, openTerminal, openLogs, closeTab, markEnded]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
