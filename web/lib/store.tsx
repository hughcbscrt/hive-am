'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { api } from './api';
import type { Agent, AgentType, Block, Colony, ProviderInfo, Skill, StreamEvent, Usage } from './types';

export interface LiveTurn { turnId: string; prompt: string; source: 'user' | 'dispatch'; from?: string; blocks: Block[]; error?: string; startedAt: number; usage?: Partial<Usage>; cost?: number; model?: string }

interface State {
  ready: boolean; connected: boolean;
  agents: Agent[]; types: AgentType[]; skills: Skill[]; colonies: Colony[]; providers: ProviderInfo[];
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
    case 'data': return { ...s, ...a.p };
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

interface Ctx extends State {
  refresh: (what?: ('agents' | 'types' | 'skills' | 'colonies')[]) => Promise<void>;
  agent: (id: string) => Agent | undefined;
  clearLive: (id: string) => void;
}
const C = createContext<Ctx | null>(null);
export const useHive = () => { const c = useContext(C); if (!c) throw new Error('HiveProvider missing'); return c; };

export function HiveProvider({ children }: { children: ReactNode }) {
  const [s, d] = useReducer(reduce, { ready: false, connected: false, agents: [], types: [], skills: [], colonies: [], providers: [], live: {}, finished: {} });

  const refresh = useCallback(async (what: ('agents' | 'types' | 'skills' | 'colonies')[] = ['agents', 'types', 'skills', 'colonies']) => {
    const p: Partial<State> = {};
    await Promise.all(what.map(async (w) => {
      if (w === 'agents') p.agents = await api.get<Agent[]>('/agents');
      if (w === 'types') p.types = await api.get<AgentType[]>('/types');
      if (w === 'skills') p.skills = await api.get<Skill[]>('/skills');
      if (w === 'colonies') p.colonies = await api.get<Colony[]>('/colonies');
    })).catch(() => undefined);
    d({ k: 'data', p });
  }, []);

  useEffect(() => {
    void refresh().then(() => d({ k: 'data', p: { ready: true } }));
    api.get<ProviderInfo[]>('/providers').then((providers) => d({ k: 'data', p: { providers } })).catch(() => undefined);
  }, [refresh]);

  const retry = useRef(0);
  useEffect(() => {
    let ws: WebSocket | null = null; let timer: ReturnType<typeof setTimeout>; let closed = false;
    const open = () => {
      ws = new WebSocket(`ws://${location.hostname}:${process.env.NEXT_PUBLIC_HIVE_WS_PORT ?? 4400}/ws`);
      ws.onopen = () => {
        retry.current = 0; d({ k: 'conn', v: true });
        void refresh(['agents']);
        // Recover any turn that was mid-flight when this tab connected.
        api.get<Agent[]>('/agents').then((list) => list.filter((a) => a.live).forEach((a) =>
          api.get<{ turnId: string; prompt: string; source: 'user' | 'dispatch'; events: StreamEvent[] } | null>(`/agents/${a.id}/live`).then((t) => {
            if (!t) return;
            d({ k: 'turn_start', agentId: a.id, turnId: t.turnId, prompt: t.prompt, source: t.source });
            t.events.forEach((ev) => d({ k: 'event', agentId: a.id, turnId: t.turnId, ev }));
          }))).catch(() => undefined);
      };
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.kind === 'agents_changed') void refresh(['agents', 'colonies']);
        else if (msg.kind === 'turn_start') d({ k: 'turn_start', agentId: msg.agentId, turnId: msg.turnId, prompt: msg.prompt, source: msg.source, from: msg.from });
        else if (msg.kind === 'event') d({ k: 'event', agentId: msg.agentId, turnId: msg.turnId, ev: msg.event });
        else if (msg.kind === 'status') d({ k: 'status', agentId: msg.agentId, status: msg.status === 'queued' ? 'running' : msg.status, queued: msg.queued });
      };
      ws.onclose = () => {
        d({ k: 'conn', v: false });
        if (!closed) timer = setTimeout(open, Math.min(8000, 800 * 2 ** retry.current++));
      };
    };
    open();
    return () => { closed = true; clearTimeout(timer); ws?.close(); };
  }, [refresh]);

  const value = useMemo<Ctx>(() => ({
    ...s, refresh,
    agent: (id) => s.agents.find((a) => a.id === id),
    clearLive: (id) => d({ k: 'status', agentId: id, status: 'idle', queued: 0 }),
  }), [s, refresh]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
