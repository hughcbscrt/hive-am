'use client';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, Brain, ChevronRight, Square, AlertTriangle, Waypoints, Coins, Layers, Timer, Hammer } from 'lucide-react';
import { api } from '@/lib/api';
import { useHive } from '@/lib/store';
import { ago } from '@/lib/meta';
import type { Agent, Block, ChatMessage } from '@/lib/types';
import { Hex, useToast } from '@/components/ui';
import { ChangedFiles, ToolCall, ToolsOpen } from './ToolCall';
import { UserBubble } from './UserBubble';
import { fmtCost, fmtDur, fmtTokens, totalTokens } from '@/lib/format';
import { translateServerError, useI18n } from '@/lib/i18n/index';

/** Claude writes one transcript entry per tool call; show a run of assistant entries as one reply. */
function coalesce(list: ChatMessage[]): (ChatMessage & { durationMs?: number })[] {
  const out: (ChatMessage & { durationMs?: number })[] = [];
  let userTs: number | null = null;
  for (const m of list) {
    if (m.role === 'user') { userTs = m.ts; out.push(m); continue; }
    const last = out[out.length - 1];
    const merged = (a?: ChatMessage['meta'], b?: ChatMessage['meta']): ChatMessage['meta'] => {
      if (!a) return b; if (!b) return a;
      const ua = a.usage, ub = b.usage;
      return {
        model: b.model ?? a.model, endTs: b.endTs ?? a.endTs, cost: a.cost !== undefined || b.cost !== undefined ? (a.cost ?? 0) + (b.cost ?? 0) : undefined,
        costEstimated: a.costEstimated || b.costEstimated,
        usage: ua && ub ? { input: ua.input + ub.input, output: ua.output + ub.output, cacheRead: ua.cacheRead + ub.cacheRead, cacheWrite: ua.cacheWrite + ub.cacheWrite, reasoning: ua.reasoning + ub.reasoning, credits: (ua.credits ?? 0) + (ub.credits ?? 0) || undefined, contextPct: ub.contextPct ?? ua.contextPct } : ua ?? ub,
      };
    };
    let msg: ChatMessage & { durationMs?: number };
    if (last?.role === 'assistant') { msg = { ...last, blocks: [...last.blocks, ...m.blocks], meta: merged(last.meta, m.meta) }; out[out.length - 1] = msg; }
    else { msg = { ...m }; out.push(msg); }
    const end = msg.meta?.endTs;
    msg.durationMs = userTs && end ? Math.max(0, end - userTs) : undefined;
  }
  return out;
}

function ReplyMeta({ m }: { m: ChatMessage & { durationMs?: number } }) {
  const { t } = useI18n();
  const u = m.meta?.usage; const tools = m.blocks.filter((b) => b.type === 'tool').length;
  if (!u && !m.durationMs && !tools) return null;
  const tokens = totalTokens(u);
  return (
    <div className="replymeta">
      {m.meta?.model && <span className="mono">{m.meta.model.replace(/^claude-/, '').replace(/-\d{8}$/, '')}</span>}
      {tokens > 0 && <span title={u ? t('chat.tokenDetail', { input: u.input, output: u.output, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite }) : ''}><Layers size={12} />{t('chat.inOut', { in: fmtTokens(u!.input + u!.cacheRead + u!.cacheWrite), out: fmtTokens(u!.output) })}</span>}
      {u?.credits ? <span><Coins size={12} />{t('chat.credits', { value: u.credits.toFixed(2) })}</span> : null}
      {m.meta?.cost !== undefined && <span title={m.meta.costEstimated ? t('stats.costEstimated') : t('stats.costReported')}><Coins size={12} />{m.meta.costEstimated ? '≈ ' : ''}{fmtCost(m.meta.cost)}</span>}
      {tools > 0 && <span><Hammer size={12} />{t('chat.tools', { count: tools })}</span>}
      {m.durationMs ? <span><Timer size={12} />{fmtDur(m.durationMs)}</span> : null}
    </div>
  );
}

function LiveMeta({ turn }: { turn: NonNullable<ReturnType<typeof useHive>['live'][string]> }) {
  const { t } = useI18n();
  const [, set] = useState(0);
  useEffect(() => { const i = setInterval(() => set((x) => x + 1), 500); return () => clearInterval(i); }, []);
  const u = turn.usage; const tools = turn.blocks.filter((b) => b.type === 'tool').length;
  return (
    <div className="replymeta live">
      <span><Timer size={12} />{fmtDur(Date.now() - turn.startedAt)}</span>
      {tools > 0 && <span><Hammer size={12} />{t('chat.tools', { count: tools })}</span>}
      {u && (u.output ?? 0) > 0 && <span><Layers size={12} />{t('chat.inOut', { in: fmtTokens((u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0)), out: fmtTokens(u.output ?? 0) })}</span>}
      {u?.contextPct !== undefined && <span>{t('chat.contextPct', { pct: u.contextPct.toFixed(1) })}</span>}
    </div>
  );
}
const pretty = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));

/** Parsing markdown is the expensive part of rendering a chat, so each text block is parsed only when its text changes. */
const Md = memo(function Md({ text }: { text: string }) {
  return <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>;
});

const Blocks = memo(function Blocks({ blocks, streaming }: { blocks: Block[]; streaming?: boolean }) {
  const { t } = useI18n();
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === 'text') return <Md key={i} text={b.text} />;
        if (b.type === 'thinking') return (
          <details key={i} className="fold think"><summary><Brain size={14} />{streaming && i === blocks.length - 1 ? t('activity.thinking') : t('chat.thought')}<ChevronRight size={14} className="chev" /></summary><pre>{b.text}</pre></details>
        );
        return <ToolCall key={i} tool={b} streaming={streaming} />;
      })}
      <ChangedFiles blocks={blocks} />
    </>
  );
});

type Reply = ChatMessage & { durationMs?: number };

/** The saved transcript. Memoised so typing in the composer never re-renders it. */
const History = memo(function History({ msgs, agent }: { msgs: ChatMessage[]; agent: Pick<Agent, 'name' | 'provider' | 'role'> }) {
  useI18n(); // re-render the relative times when the language changes
  const list = useMemo(() => coalesce(msgs), [msgs]);
  return (
    <>
      {list.map((m: Reply) => m.role === 'user' ? (
        <UserBubble key={m.id} text={m.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('')} />
      ) : (
        <div key={m.id} className="msg assistant">
          <div className="who"><Hex agent={agent} size="sm" />{agent.name}<span className="stamp">{m.ts ? ago(m.ts) : ''}</span></div>
          <Blocks blocks={m.blocks} />
          <ReplyMeta m={m} />
        </div>
      ))}
    </>
  );
}, (a, b) => a.msgs === b.msgs && a.agent.name === b.agent.name && a.agent.provider === b.agent.provider && a.agent.role === b.agent.role);

/** Owns the draft text, so each keystroke re-renders only this small box. */
const Composer = memo(function Composer({ name, running, queued, readOnly, onSend, onStop, toolsOpen, onToggleTools }: {
  name: string; running: boolean; queued: number; readOnly: boolean;
  onSend: (prompt: string) => Promise<boolean>; onStop: () => void; toolsOpen: boolean | null; onToggleTools: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const grow = () => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 200) + 'px'; } };
  const send = async () => {
    const prompt = text.trim(); if (!prompt) return;
    setText(''); requestAnimationFrame(grow);
    if (!(await onSend(prompt))) { setText(prompt); requestAnimationFrame(grow); }
  };
  return (
    <div className="composer">
      {readOnly ? (
        <div className="composer-box" style={{ justifyContent: 'space-between', alignItems: 'center' }}><span className="muted">{t('chat.readOnly')}</span></div>
      ) : (
        <div className="composer-box">
          <textarea ref={ref} rows={1} value={text} placeholder={running ? t('chat.queuePlaceholder') : t('chat.placeholder', { name })} aria-label={t('chat.messageLabel')}
            onChange={(e) => { setText(e.target.value); grow(); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
          {running && <button className="btn" onClick={onStop} aria-label={t('chat.stop')}><Square size={14} fill="currentColor" />{t('chat.stop')}</button>}
          <button className="btn primary icon" onClick={() => void send()} disabled={!text.trim()} aria-label={t('chat.send')}><ArrowUp size={18} /></button>
        </div>
      )}
      <div className="composer-meta"><span>{t('chat.keys')}</span><button type="button" className="linkbtn" onClick={onToggleTools}>{toolsOpen ? t('chat.collapseTools') : t('chat.expandTools')}</button>{queued > 0 && <span>{t('queue.count', { count: queued })}</span>}</div>
    </div>
  );
});

export function Chat({ agent, sessionOverride }: { agent: Agent; sessionOverride?: string | null }) {
  const { t } = useI18n();
  const { live, finished, clearLive, agents } = useHive();
  const toast = useToast();
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [toolsOpen, setToolsOpen] = useState<boolean | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const turn = live[agent.id];
  const running = agent.status === 'running' || !!turn;
  const readOnly = sessionOverride !== undefined && sessionOverride !== agent.session_id;

  const load = useCallback(() => {
    const sid = readOnly ? sessionOverride : agent.session_id;
    if (!sid) { setMsgs([]); setLoaded(true); return Promise.resolve(); }
    return api.get<{ messages: ChatMessage[] }>(`/agents/${agent.id}/history?session=${encodeURIComponent(sid)}`)
      .then((r) => { setMsgs(r.messages); setLoaded(true); }).catch((e) => { toast(e.message, 'err'); setLoaded(true); });
  }, [agent.id, agent.session_id, readOnly, sessionOverride, toast]);

  useEffect(() => { setLoaded(false); void load(); }, [load]);
  // A finished turn is now in the CLI's own transcript: re-read it, then drop the optimistic echo.
  const fin = finished[agent.id] ?? 0;
  useEffect(() => { if (fin) void load().then(() => setPending(null)); }, [fin]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the view pinned to the newest content while the user hasn't scrolled away,
  // including when markdown/tool blocks grow after the first paint.
  useEffect(() => {
    const el = threadRef.current; const inner = el?.firstElementChild; if (!el || !inner) return;
    const pin = () => { if (stick.current) el.scrollTop = el.scrollHeight; };
    const ro = new ResizeObserver(pin); ro.observe(inner); pin();
    return () => ro.disconnect();
  }, [loaded, agent.id]);

  const send = useCallback(async (prompt: string) => {
    if (readOnly) return false;
    setPending(prompt); stick.current = true;
    try { await api.post(`/agents/${agent.id}/messages`, { prompt }); return true; }
    catch (e) { setPending(null); toast(e instanceof Error ? e.message : t('chat.sendFailed'), 'err'); return false; }
  }, [agent.id, readOnly, toast, t]);
  const stop = useCallback(() => { void api.post(`/agents/${agent.id}/stop`).catch(() => undefined); }, [agent.id]);
  const toggleTools = useCallback(() => setToolsOpen((o) => (o ? false : true)), []);

  const showPending = pending && !msgs.some((m) => m.role === 'user' && m.blocks.some((b) => b.type === 'text' && b.text.trim() === pending));
  const isEmpty = loaded && !msgs.length && !turn && !pending;

  return (
    <>
      <ToolsOpen.Provider value={toolsOpen}>
      <div className="thread" ref={threadRef} onWheel={(e) => { if (e.deltaY < 0) stick.current = false; }} onScroll={(e) => { const el = e.currentTarget; if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) stick.current = true; }}>
        <div className="thread-inner">
          {isEmpty && (
            <div className="empty" style={{ marginTop: 40 }}>
              <Hex agent={agent} size="lg" /><h3>{t('chat.empty.title', { name: agent.name })}</h3>
              <p>{agent.role === 'orchestrator' ? t('chat.empty.orchestrator') : t('chat.empty.worker')}</p>
            </div>
          )}
          <History msgs={msgs} agent={agent} />
          {showPending && !turn?.prompt && <UserBubble text={pending ?? ''} />}
          {turn && (
            <>
              {turn.source === 'dispatch' ? (
                <div className="delegation-card">
                  <div className="head"><Waypoints size={14} />{t('chat.delegatedFrom', { name: agents.find((a) => a.id === turn.from)?.name ?? t('chat.anOrchestrator') })}</div>
                  <p>{turn.prompt}</p>
                  <span className="hint">{t('chat.delegatedNote')}</span>
                </div>
              ) : !msgs.some((m) => m.role === 'user' && m.blocks.some((b) => b.type === 'text' && b.text.trim() === turn.prompt.trim())) && (
                <UserBubble text={turn.prompt} />
              )}
              <div className="msg assistant">
                <div className="who"><Hex agent={agent} size="sm" />{agent.name}</div>
                <Blocks blocks={turn.blocks} streaming />
                {!turn.error && <span className="typing" aria-label={t('common.working')}><i /><i /><i /></span>}
                <LiveMeta turn={turn} />
                {turn.error && (
                  <div className="banner err"><AlertTriangle size={16} /><div className="grow">{translateServerError(turn.error)}</div><button className="btn sm" onClick={() => clearLive(agent.id)}>{t('common.dismiss')}</button></div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      </ToolsOpen.Provider>
      <Composer name={agent.name} running={running} queued={agent.queued ?? 0} readOnly={readOnly} onSend={send} onStop={stop} toolsOpen={toolsOpen} onToggleTools={toggleTools} />
    </>
  );
}
