'use client';
import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { api } from './api';
import type { Agent, AgentType, Block, Colony, Connection, Dispatch, ObjectView, ProviderInfo, Skill, StreamEvent, Usage } from './types';

export interface LiveTurn { turnId: string; prompt: string; source: 'user' | 'dispatch'; from?: string; blocks: Block[]; error?: string; startedAt: number; usage?: Partial<Usage>; cost?: number; model?: string }

interface State {
  /** True once the API has answered at least once (not merely because a request finished). Before that, show a skeleton, or `error`. */
  ready: boolean; connected: boolean;
  /** Translated message of the first failed load, null when all loaded. The store retries by itself with backoff; `retry()` forces it now. */
  error: string | null;
  agents: Agent[]; types: AgentType[]; skills: Skill[]; colonies: Colony[]; connections: Connection[]; objects: ObjectView[]; providers: ProviderInfo[];
  /** Recent delegations, newest first. Kept fresh from WebSocket events, so pages need no polling. */
  dispatches: Dispatch[];
  live: Record<string, LiveTurn>;
  /** Bumped when a turn finishes so open chats re-read the native transcript. */
  finished: Record<string, number>;
}
type Action =
  | { k: 'data'; p: Partial<State> }
  | { k: 'conn'; v: boolean }
  | { k: 'turn_start'; agentId: string; turnId: string; prompt: string; source: 'user' | 'dispatch'; from?: string }
  | { k: 'event'; agentId: string; turnId: string; ev: StreamEvent }
  | { k: 'status'; agentId: string; status: Agent['status']; queued: number };

export function foldEvent(blocks: Block[], ev: StreamEvent): Block[] {
  const out = blocks.slice();
  const last = out[out.length - 1];
  if (ev.t === 'text' || ev.t === 'thinking') {
    const type = ev.t === 'text' ? 'text' : 'thinking';
    if (last && last.type === type) out[out.length - 1] = { ...last, text: last.text + ev.delta } as Block;
    else out.push({ type, text: ev.delta });
  } else if (ev.t === 'tool') out.push({ type: 'tool', id: ev.id, name: ev.name, input: ev.input, startedAt: Date.now() });
  else if (ev.t === 'tool_result') {
    const i = out.findIndex((b) => b.type === 'tool' && b.id === ev.id);
    if (i >= 0) { const t = out[i] as Extract<Block, { type: 'tool' }>; out[i] = { ...t, output: ev.output, error: ev.error, durationMs: t.startedAt ? Date.now() - t.startedAt : undefined }; }
  }
  return out;
}

function reduce(s: State, a: Action): State {
  switch (a.k) {
    case 'data': { const ks = Object.keys(a.p) as (keyof State)[]; return ks.every((k) => Object.is(s[k], a.p[k])) ? s : { ...s, ...a.p }; }
    case 'conn': return { ...s, connected: a.v };
    case 'turn_start': return { ...s, live: { ...s.live, [a.agentId]: { turnId: a.turnId, prompt: a.prompt, source: a.source, from: a.from, blocks: [], startedAt: Date.now() } } };
    case 'event': {
      const cur = s.live[a.agentId]; if (!cur || cur.turnId !== a.turnId) return s;
      const next = { ...cur, blocks: foldEvent(cur.blocks, a.ev) };
      if (a.ev.t === 'error') next.error = a.ev.message;
      if (a.ev.t === 'usage') {
        const u = a.ev.usage; const p = next.usage ?? {};
        // Providers report running totals per request/step; accumulate tokens, keep the latest context gauge.
        next.usage = { input: (p.input ?? 0) + (u.input ?? 0), output: (p.output ?? 0) + (u.output ?? 0), cacheRead: (p.cacheRead ?? 0) + (u.cacheRead ?? 0), cacheWrite: (p.cacheWrite ?? 0) + (u.cacheWrite ?? 0), reasoning: (p.reasoning ?? 0) + (u.reasoning ?? 0), credits: u.credits ?? p.credits, contextPct: u.contextPct ?? p.contextPct };
        next.cost = a.ev.cost ?? next.cost; next.model = a.ev.model ?? next.model;
      }
      return { ...s, live: { ...s.live, [a.agentId]: next } };
    }
    case 'status': {
      const agents = s.agents.map((x) => (x.id === a.agentId ? { ...x, status: a.status, queued: a.queued } : x));
      if (a.status === 'running') return { ...s, agents };
      const live = { ...s.live };
      const hadLive = !!live[a.agentId];
      // Keep an errored turn visible; clear a clean one once the transcript has the real messages.
      if (a.status !== 'error') delete live[a.agentId];
      return { ...s, agents, live, finished: hadLive ? { ...s.finished, [a.agentId]: (s.finished[a.agentId] ?? 0) + 1 } : s.finished };
    }
  }
}

type What = 'agents' | 'types' | 'skills' | 'colonies' | 'connections' | 'objects' | 'dispatches';
const ALL: What[] = ['agents', 'types', 'skills', 'colonies', 'connections', 'objects', 'dispatches'];
const LOADERS: Record<What, () => Promise<unknown>> = {
  agents: () => api.get<Agent[]>('/agents'), types: () => api.get<AgentType[]>('/types'), skills: () => api.get<Skill[]>('/skills'),
  colonies: () => api.get<Colony[]>('/colonies'), connections: () => api.get<Connection[]>('/connections'), objects: () => api.get<ObjectView[]>('/objects'),
  dispatches: () => api.get<Dispatch[]>('/dispatches'),
};

/** What the WebSocket URL points at: same host as the page, ws/wss to match it. An empty NEXT_PUBLIC_HIVE_WS_PORT means "same port as the page" (behind a reverse proxy). */
export function wsUrl(): string {
  const port = process.env.NEXT_PUBLIC_HIVE_WS_PORT ?? '4400';
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${port === '' ? location.host : `${location.hostname}:${port}`}/ws`;
}

interface Actions {
  /** Reload slices from the API (everything by default). Never throws: failures land in `error`. */
  refresh: (what?: What[]) => Promise<void>;
  /** Reload everything now, including providers. */
  retry: () => Promise<void>;
  agent: (id: string) => Agent | undefined;
  clearLive: (id: string) => void;
}
/** Same shape as before; `error`, `retry` and `dispatches` are additions. */
type Ctx = State & Actions;

/** Tiny external store: components subscribe to the slice they read, so a streamed token only re-renders chats showing that agent. */
interface Store { get: () => State; set: (a: Action) => void; sub: (l: () => void) => () => void; actions: Actions }
const C = createContext<Store | null>(null);
const useStore = () => { const c = useContext(C); if (!c) throw new Error('HiveProvider missing'); return c; };

/** Subscribe to part of the state. `select` must return the same reference when nothing it reads changed (pick existing fields; do not build new objects/arrays). */
export function useHiveSelector<T>(select: (s: State) => T): T {
  const st = useStore();
  return useSyncExternalStore(st.sub, () => select(st.get()), () => select(st.get()));
}

const DATA_KEYS = ['ready', 'connected', 'error', 'agents', 'types', 'skills', 'colonies', 'connections', 'objects', 'providers', 'dispatches'] as const;
type DataSlice = Pick<State, (typeof DATA_KEYS)[number]> & Actions;

/** Everything except the streaming parts (`live`, `finished`): does NOT re-render on each token. Use in Nav, the colony, tables. */
export function useHiveData(): DataSlice {
  const st = useStore();
  const prev = useRef<DataSlice | null>(null);
  const snap = () => {
    const s = st.get(); const p = prev.current;
    if (p && DATA_KEYS.every((k) => Object.is(p[k], s[k]))) return p;
    const next = { ...st.actions } as DataSlice; for (const k of DATA_KEYS) (next as any)[k] = s[k];
    return (prev.current = next);
  };
  return useSyncExternalStore(st.sub, snap, snap);
}
/** The turn being streamed for one agent (undefined when idle). Re-renders only when that agent's turn changes. */
export const useLive = (agentId: string | undefined): LiveTurn | undefined => useHiveSelector((s) => (agentId ? s.live[agentId] : undefined));
/** Counter bumped each time that agent finishes a turn; re-read the transcript when it changes. */
export const useFinished = (agentId: string | undefined): number => useHiveSelector((s) => (agentId ? s.finished[agentId] ?? 0 : 0));
/** One agent by id, re-rendering only when that agent object changes. */
export const useAgent = (id: string | undefined): Agent | undefined => useHiveSelector((s) => (id ? s.agents.find((a) => a.id === id) : undefined));
/** Stable actions (refresh, retry, agent, clearLive) without subscribing to any state. */
export const useHiveActions = (): Actions => useStore().actions;

/** Compatible full context: re-renders on every change, `live` deltas included. Prefer the narrow hooks above in hot components. */
export function useHive(): Ctx {
  const st = useStore();
  const prev = useRef<{ s: State; v: Ctx } | null>(null);
  const snap = () => { const s = st.get(); if (prev.current?.s !== s) prev.current = { s, v: { ...s, ...st.actions } }; return prev.current.v; };
  return useSyncExternalStore(st.sub, snap, snap);
}

const INITIAL: State = { ready: false, connected: false, error: null, agents: [], types: [], skills: [], colonies: [], connections: [], objects: [], providers: [], dispatches: [], live: {}, finished: {} };

export function HiveProvider({ children }: { children: ReactNode }) {
  const ref = useRef<Store | null>(null);
  const timers = useRef({ retry: undefined as ReturnType<typeof setTimeout> | undefined, disp: undefined as ReturnType<typeof setTimeout> | undefined, attempts: 0 });
  if (!ref.current) {
    let state = INITIAL; const ls = new Set<() => void>();
    const failures = new Map<What, string>();
    const set = (a: Action) => { const n = reduce(state, a); if (n !== state) { state = n; ls.forEach((l) => l()); } };
    const refresh: Actions['refresh'] = async (what = ALL) => {
      const got: Record<string, unknown> = {}; let answered = 0;
      await Promise.all(what.map(async (w) => {
        try { got[w] = await LOADERS[w](); failures.delete(w); answered++; }
        catch (e) { failures.set(w, e instanceof Error ? e.message : String(e)); }
      }));
      set({ k: 'data', p: { ...got, ...(answered ? { ready: true } : {}), error: failures.values().next().value ?? null } as Partial<State> });
      // Keep trying while something is failing (the API may still be starting), with a growing pause.
      const tm = timers.current; clearTimeout(tm.retry);
      if (failures.size) tm.retry = setTimeout(() => void refresh([...failures.keys()]), Math.min(15000, 2000 * 2 ** tm.attempts++));
      else tm.attempts = 0;
    };
    const loadProviders = () => api.get<ProviderInfo[]>('/providers').then((providers) => set({ k: 'data', p: { providers } })).catch(() => undefined);
    const actions: Actions = {
      refresh,
      retry: async () => { await Promise.all([refresh(), loadProviders()]); },
      agent: (id) => state.agents.find((a) => a.id === id),
      clearLive: (id) => set({ k: 'status', agentId: id, status: 'idle', queued: 0 }),
    };
    ref.current = { get: () => state, set, sub: (l) => { ls.add(l); return () => { ls.delete(l); }; }, actions };
  }
  const store = ref.current;

  useEffect(() => {
    const tm = timers.current;
    void store.actions.retry();
    return () => { clearTimeout(tm.retry); clearTimeout(tm.disp); };
  }, [store]);

  const retry = useRef(0);
  useEffect(() => {
    let ws: WebSocket | null = null; let timer: ReturnType<typeof setTimeout>; let closed = false;
    const { refresh } = store.actions; const d = store.set;
    // Delegations start and finish around a turn: one debounced reload after the burst of events keeps the feed current.
    const refreshDispatches = () => { clearTimeout(timers.current.disp); timers.current.disp = setTimeout(() => void refresh(['dispatches']), 400); };
    const open = () => {
      ws = new WebSocket(wsUrl());
      ws.onopen = () => {
        retry.current = 0; d({ k: 'conn', v: true });
        void refresh(['agents', 'dispatches']);
        // Recover any turn that was mid-flight when this tab connected.
        api.get<Agent[]>('/agents').then((list) => list.filter((a) => a.live).forEach((a) =>
          api.get<{ turnId: string; prompt: string; source: 'user' | 'dispatch'; events: StreamEvent[] } | null>(`/agents/${a.id}/live`).then((t) => {
            if (!t) return;
            d({ k: 'turn_start', agentId: a.id, turnId: t.turnId, prompt: t.prompt, source: t.source });
            t.events.forEach((ev) => d({ k: 'event', agentId: a.id, turnId: t.turnId, ev }));
          }))).catch(() => undefined);
      };
      ws.onmessage = (m) => {
        try {
          const msg = JSON.parse(m.data);
          if (msg.kind === 'agents_changed') { void refresh(['agents', 'colonies', 'connections']); refreshDispatches(); }
          else if (msg.kind === 'objects_changed') void refresh(['objects']);
          else if (msg.kind === 'turn_start') { d({ k: 'turn_start', agentId: msg.agentId, turnId: msg.turnId, prompt: msg.prompt, source: msg.source, from: msg.from }); if (msg.source === 'dispatch') refreshDispatches(); }
          else if (msg.kind === 'event') d({ k: 'event', agentId: msg.agentId, turnId: msg.turnId, ev: msg.event });
          else if (msg.kind === 'status') {
            d({ k: 'status', agentId: msg.agentId, status: msg.status === 'queued' ? 'running' : msg.status, queued: msg.queued });
            if (msg.status === 'idle' || msg.status === 'error') refreshDispatches();
          }
        } catch { /* a malformed or unexpected frame must not kill the socket handler */ }
      };
      ws.onclose = () => {
        d({ k: 'conn', v: false });
        if (!closed) timer = setTimeout(open, Math.min(8000, 800 * 2 ** retry.current++));
      };
    };
    open();
    return () => { closed = true; clearTimeout(timer); ws?.close(); };
  }, [store]);

  return <C.Provider value={store}>{children}</C.Provider>;
}
