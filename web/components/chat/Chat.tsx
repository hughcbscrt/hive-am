'use client';
import { Fragment, memo, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowDown, ArrowUp, Brain, ChevronRight, Paperclip, Square, X, Waypoints, Coins, Layers, Timer, Hammer } from 'lucide-react';
import { api } from '@/lib/api';
import { useFinished, useHiveActions, useHiveData, useLive, type LiveTurn } from '@/lib/store';
import { usePersistentState } from '@/lib/hooks/usePersistentState';
import { setChatView, useChatView } from '@/lib/chat/chatPrefs';
import { splitRuns } from '@/lib/chat/pills';
import { ago } from '@/lib/meta';
import type { Agent, Block, ChatMessage } from '@/lib/types';
import { Banner, EmptyState, Hex, useToast } from '@/components/ui';
import { ChangedFiles, ToolCall, ToolsOpen } from './ToolCall';
import { StepPanels, StepPills, SummaryPill, type PillState } from './Pills';
import { UserBubble } from './UserBubble';
import { fmtCost, fmtDur, fmtTokens, totalTokens } from '@/lib/format';
import { translateServerError, useI18n } from '@/lib/i18n/index';

/** Claude writes one transcript entry per tool call; show a run of assistant entries as one reply. */
function coalesce(list: ChatMessage[]): (ChatMessage & { durationMs?: number })[] {
  const out: (ChatMessage & { durationMs?: number })[] = [];
  let userTs: number | null = null;
  for (const m of list) {
    if (m.role === 'user') { userTs = m.ts; out.push(m); continue; }
    if (m.compact) { out.push(m); continue; }
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
    if (last?.role === 'assistant' && !last.compact) { msg = { ...last, blocks: [...last.blocks, ...m.blocks], meta: merged(last.meta, m.meta) }; out[out.length - 1] = msg; }
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

/** What to do about a failed turn. OpenCode 2.x can compact the conversation; any other version or provider can only start a new one. */
const USAGE_LIMIT = /usage limit|quota|insufficient|rate.?limit|too many requests|credits/i;
function FailedHint({ agent, error, onDone }: { agent: Agent; error: string; onDone: () => void }) {
  const { t } = useI18n(); const toast = useToast();
  const [can, setCan] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { if (agent.provider !== 'opencode') return; let live = true; api.get<{ supported: boolean }>(`/agents/${agent.id}/compact`).then((r) => { if (live) setCan(r.supported); }).catch(() => {}); return () => { live = false; }; }, [agent.id, agent.provider]);
  const compact = async () => {
    setBusy(true);
    try { await api.post(`/agents/${agent.id}/compact`); toast(t('chat.compacted'), 'ok'); onDone(); }
    catch (e) { toast(t('chat.compactFailed', { reason: e instanceof Error ? e.message : String(e) }), 'err'); }
    finally { setBusy(false); }
  };
  const limit = USAGE_LIMIT.test(error);      // a limit of the account: compacting does not help, another model might
  return (
    <>
      <br /><span className="muted">{t(limit ? 'chat.failedHintLimit' : can ? 'chat.failedHintCompact' : 'chat.failedHint')}</span>
      {can && !limit && <><br /><button type="button" className="btn sm" disabled={busy} onClick={() => void compact()}>{busy ? t('chat.compacting') : t('chat.compact')}</button></>}
    </>
  );
}

function LiveMeta({ turn }: { turn: LiveTurn }) {
  const { t } = useI18n();
  const [, set] = useState(0);
  const failed = !!turn.error;
  useEffect(() => { if (failed) return; const i = setInterval(() => set((x) => x + 1), 500); return () => clearInterval(i); }, [failed]);
  const stopped = useRef(0); if (failed && !stopped.current) stopped.current = Date.now();      // a failed turn keeps the time it had when it failed
  const u = turn.usage; const tools = turn.blocks.filter((b) => b.type === 'tool').length;
  return (
    <div className="replymeta live">
      <span><Timer size={12} />{fmtDur((failed ? stopped.current : Date.now()) - turn.startedAt)}</span>
      {tools > 0 && <span><Hammer size={12} />{t('chat.tools', { count: tools })}</span>}
      {u && (u.output ?? 0) > 0 && <span><Layers size={12} />{t('chat.inOut', { in: fmtTokens((u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0)), out: fmtTokens(u.output ?? 0) })}</span>}
      {u?.contextPct !== undefined && <span>{t('chat.contextPct', { pct: u.contextPct.toFixed(1) })}</span>}
    </div>
  );
}
const ANCHOR_PX = 2;   // the view counts as at the bottom within this distance
const JUMP_PX = 8;     // the "latest" button needs at least this much content out of view (about a line)
const PAGE = 60; // messages loaded at first, and the step of "Show earlier" is twice this
const pretty = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));

/** Parsing markdown is the expensive part of rendering a chat, so each text block is parsed only when its text changes. */
const Md = memo(function Md({ text }: { text: string }) {
  return <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>;
});

export const Blocks = memo(function Blocks({ blocks, streaming }: { blocks: Block[]; streaming?: boolean }) {
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

/** The compact view of a reply: its steps as pills, the first run in the agent's row (`head`). A foldable reply shows one summary pill until it is unfolded. */
function PillReply({ head, blocks, streaming, foldable = false, durationMs }: { head: ReactNode; blocks: Block[]; streaming?: boolean; foldable?: boolean; durationMs?: number }) {
  const forced = useContext(ToolsOpen);
  // Every pill is open or closed as `all` says, except the ones clicked since; new steps of a streaming reply follow `all` too.
  const [all, setAll] = useState(forced ?? false);
  const [flipped, setFlipped] = useState<ReadonlySet<number>>(() => new Set());
  const [unfolded, setUnfolded] = useState(forced ?? false);
  useEffect(() => { if (forced === null) return; setAll(forced); setFlipped(new Set()); setUnfolded(forced); }, [forced]);
  const ids = useId();
  const st: PillState = {
    ids, isOpen: (i) => all !== flipped.has(i),
    toggle: (i) => setFlipped((f) => { const n = new Set(f); if (!n.delete(i)) n.add(i); return n; }),
  };
  const runs = splitRuns(blocks);
  const lead = runs[0] && 'steps' in runs[0] ? runs[0].steps : null;
  const shown = !foldable || unfolded;
  return (
    <>
      <div className="who pills">{head}{foldable && <SummaryPill blocks={blocks} durationMs={durationMs} open={unfolded} onToggle={() => setUnfolded((u) => !u)} />}{shown && lead && <StepPills blocks={blocks} idx={lead} streaming={streaming} st={st} />}</div>
      {shown && lead && <StepPanels blocks={blocks} idx={lead} st={st} />}
      {runs.map((r, k) => 'text' in r ? <Md key={r.text} text={(blocks[r.text] as { text: string }).text} />
        : k === 0 || !shown ? null : (
          <Fragment key={r.steps[0]}>
            <div className="pillrow"><StepPills blocks={blocks} idx={r.steps} streaming={streaming} st={st} /></div>
            <StepPanels blocks={blocks} idx={r.steps} st={st} />
          </Fragment>
        ))}
      <ChangedFiles blocks={blocks} compact />
    </>
  );
}

type Reply = ChatMessage & { durationMs?: number };

/** The saved transcript. Memoised so typing in the composer never re-renders it. */
export const History = memo(function History({ msgs, agent, live = false }: { msgs: ChatMessage[]; agent: Pick<Agent, 'id' | 'name' | 'provider' | 'role'>; /** a turn is running: in the compact view it is the latest reply, so every saved one folds */ live?: boolean }) {
  const { t } = useI18n(); // also re-renders the relative times when the language changes
  const list = useMemo(() => coalesce(msgs), [msgs]);
  const compact = useChatView() === 'compact';
  const latest = live ? -1 : list.findLastIndex((m) => m.role === 'assistant' && !m.compact);
  return (
    <>
      {list.map((m: Reply, i) => m.compact ? (
        <div key={m.id} className="compact-mark" role="separator"><span>{t('chat.compactMark', { pre: fmtTokens(m.compact.pre), post: fmtTokens(m.compact.post) })}</span></div>
      ) : m.role === 'user' ? (
        <UserBubble key={m.id} agentId={agent.id} text={m.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('')} />
      ) : (
        <div key={m.id} className="msg assistant">
          {compact ? (
            <PillReply head={<><Hex agent={agent} size="sm" />{agent.name}<span className="stamp">{m.ts ? ago(m.ts) : ''}</span></>} blocks={m.blocks} foldable={i !== latest} durationMs={m.durationMs} />
          ) : (<>
            <div className="who"><Hex agent={agent} size="sm" />{agent.name}<span className="stamp">{m.ts ? ago(m.ts) : ''}</span></div>
            <Blocks blocks={m.blocks} />
          </>)}
          <ReplyMeta m={m} />
        </div>
      ))}
    </>
  );
}, (a, b) => a.msgs === b.msgs && a.live === b.live && a.agent.id === b.agent.id && a.agent.name === b.agent.name && a.agent.provider === b.agent.provider && a.agent.role === b.agent.role);

const fileSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
interface Pic { id: string; name: string; data: string; type: string; size: number }
const MAX_FILES = 5, MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Owns the draft text, so each keystroke re-renders only this small box. */
const Composer = memo(function Composer({ agentId, name, running, queued, readOnly, onSend, onStop, toolsOpen, onToggleTools }: {
  agentId: string; name: string; running: boolean; queued: number; readOnly: boolean;
  onSend: (prompt: string, files?: { name: string; data: string; type: string }[]) => Promise<boolean>; onStop: () => void; toolsOpen: boolean | null; onToggleTools: () => void;
}) {
  const { t } = useI18n();
  const view = useChatView();
  // The draft is kept per agent (in this browser), so leaving the page or reloading does not lose a half-written message.
  const [text, setText] = usePersistentState(`hive-am.draft.${agentId}`, '');
  const [images, setImages] = useState<Pic[]>([]);
  const [over, setOver] = useState(false);
  const toast = useToast();
  const ref = useRef<HTMLTextAreaElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const grow = () => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 200) + 'px'; } };
  // Files come from paste (Ctrl+V, or ⌘+V on a Mac: pictures and copied files), from dropping them on the box, or from the clip button.
  const addFiles = async (files: File[]) => {
    const room = files.slice(0, Math.max(0, MAX_FILES - images.length));
    if (room.length < files.length) toast(t('chat.img.max', { n: MAX_FILES }), 'err');
    const ok = room.filter((f) => f.size <= MAX_FILE_BYTES && f.size > 0);
    if (ok.length < room.length) toast(t('chat.img.big', { mb: MAX_FILE_BYTES / 1024 / 1024 }), 'err');
    const read = await Promise.all(ok.map((f, i) => new Promise<Pic>((res, rej) => { const r = new FileReader(); r.onload = () => res({ id: `${Date.now()}-${i}`, name: f.name && f.name !== 'image.png' ? f.name : `pasted-${i + 1}.png`, data: String(r.result), type: f.type, size: f.size }); r.onerror = () => rej(r.error); r.readAsDataURL(f); })));
    setImages((x) => [...x, ...read]);
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const files = [...e.clipboardData.files];
    if (!files.length || e.clipboardData.getData('text/plain').trim()) return;   // text in the clipboard pastes as text
    e.preventDefault(); void addFiles(files);
  };
  const send = async () => {
    const prompt = text.trim(); if (!prompt && !images.length) return;
    const sending = images;
    setText(''); setImages([]); requestAnimationFrame(grow);
    if (!(await onSend(prompt, sending.map(({ name, data, type }) => ({ name, data, type }))))) { setText(prompt); setImages(sending); requestAnimationFrame(grow); }
  };
  return (
    <div className="composer">
      {readOnly ? (
        <div className="composer-box chat-readonly"><span className="muted">{t('chat.readOnly')}</span></div>
      ) : (
        <div className={`composer-box ${over ? 'over' : ''}`} onDragOver={(e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { setOver(false); const f = [...e.dataTransfer.files]; if (f.length) { e.preventDefault(); void addFiles(f); } }}>
          {images.length > 0 && (
            <div className="cmp-imgs">{images.map((p) => (
              <span key={p.id} className={`cmp-img${p.type.startsWith('image/') ? '' : ' file'}`} title={p.name}>{p.type.startsWith('image/') ? <img src={p.data} alt={p.name} /> : <><Paperclip size={14} aria-hidden /><b>{p.name}</b><i>{fileSize(p.size)}</i></>}<button type="button" onClick={() => setImages((x) => x.filter((y) => y.id !== p.id))} aria-label={t('chat.img.remove', { name: p.name })} title={t('chat.img.remove', { name: p.name })}><X size={12} /></button></span>))}
            </div>
          )}
          <input ref={pick} type="file" multiple hidden onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
          <button type="button" className="btn ghost icon" onClick={() => pick.current?.click()} aria-label={t('chat.img.attach')} title={t('chat.img.attach')}><Paperclip size={18} /></button>
          <textarea ref={ref} rows={1} onPaste={onPaste} value={text} placeholder={running ? t('chat.queuePlaceholder') : t('chat.placeholder', { name })} aria-label={t('chat.messageLabel')}
            onChange={(e) => { setText(e.target.value); grow(); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
          {running && <button className="btn" onClick={onStop} aria-label={t('chat.stop')}><Square size={14} fill="currentColor" />{t('chat.stop')}</button>}
          <button className="btn primary icon" onClick={() => void send()} disabled={!text.trim() && !images.length} aria-label={t('chat.send')}><ArrowUp size={18} /></button>
        </div>
      )}
      <div className="composer-meta"><span>{t('chat.keys')}</span>
        <div className="seg sm" role="group" aria-label={t('chat.view')}>
          <button type="button" aria-pressed={view === 'normal'} onClick={() => setChatView('normal')}>{t('chat.view.normal')}</button>
          <button type="button" aria-pressed={view === 'compact'} onClick={() => setChatView('compact')}>{t('chat.view.compact')}</button>
        </div>
        <button type="button" className="linkbtn" onClick={onToggleTools}>{toolsOpen ? t('chat.collapseTools') : t('chat.expandTools')}</button>{queued > 0 && <span>{t('queue.count', { count: queued })}</span>}</div>
    </div>
  );
});

export function Chat({ agent, sessionOverride }: { agent: Agent; sessionOverride?: string | null }) {
  const { t } = useI18n();
  const { agents } = useHiveData(); // not `live`: the stream must not re-render this through the app-wide context
  const { clearLive } = useHiveActions();
  const toast = useToast();
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Only the newest messages are loaded: thousands of rendered messages freeze the browser. "Show earlier" asks for more.
  const [limit, setLimit] = useState(PAGE);
  const [total, setTotal] = useState(0);
  const anchor = useRef<number | null>(null);
  // Messages sent from this tab that are not in the transcript yet: the next turn's, or ones waiting behind the running turn.
  const [outbox, setOutbox] = useState<string[]>([]);
  const [toolsOpen, setToolsOpen] = useState<boolean | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastTop = useRef(0);
  // A scroll that goes up only counts as the person scrolling when a gesture (touch, pointer, scrollbar drag) just happened: when a turn ends the live reply is swapped for the saved one,
  // the content shrinks for a moment, the browser clamps scrollTop and the scroll event it fires would otherwise look like "the person scrolled away".
  const gesture = useRef(0);
  const touched = useCallback(() => { gesture.current = performance.now(); }, []);
  const [away, setAway] = useState(false); // scrolled up from the newest content: shows the "latest" button
  // One measurement decides everything: how far the view is from the end. The button needs the view released by the person and something really out of view.
  const distance = useCallback(() => { const el = threadRef.current; return el ? el.scrollHeight - el.scrollTop - el.clientHeight : 0; }, []);
  const sync = useCallback(() => setAway(!stick.current && distance() >= JUMP_PX), [distance]);
  const release = useCallback(() => { stick.current = false; sync(); }, [sync]);
  const toBottom = useCallback(() => { const el = threadRef.current; stick.current = true; setAway(false); if (el) el.scrollTop = el.scrollHeight; }, []);
  // Going up only releases the view when there is something to scroll: on a short conversation the reply that grows must still be followed.
  const scrollable = useCallback(() => { const el = threadRef.current; return !!el && el.scrollHeight > el.clientHeight; }, []);
  const turn = useLive(agent.id);
  const running = agent.status === 'running' || (!!turn && !turn.error);
  const readOnly = sessionOverride !== undefined && sessionOverride !== agent.session_id;
  const compact = useChatView() === 'compact';

  const load = useCallback(() => {
    const sid = readOnly ? sessionOverride : agent.session_id;
    if (!sid) { setMsgs([]); setTotal(0); setLoaded(true); return Promise.resolve(); }
    return api.get<{ messages: ChatMessage[]; total?: number }>(`/agents/${agent.id}/history?session=${encodeURIComponent(sid)}&limit=${limit}`)
      .then((r) => { setMsgs(r.messages); setTotal(r.total ?? r.messages.length); setLoaded(true); }).catch((e) => { toast(e.message, 'err'); setLoaded(true); });
  }, [agent.id, agent.session_id, readOnly, sessionOverride, toast, limit]);

  useEffect(() => { setLoaded(false); setLimit(PAGE); }, [agent.id, agent.session_id, sessionOverride]);
  useEffect(() => { void load(); }, [load]);
  // Earlier messages are added above: keep what the person was reading where it was.
  useLayoutEffect(() => {
    const el = threadRef.current;
    if (el && anchor.current !== null) { el.scrollTop += el.scrollHeight - anchor.current; anchor.current = null; }
  }, [msgs]);
  const earlier = useCallback(() => { anchor.current = threadRef.current?.scrollHeight ?? null; release(); setLimit((l) => l + PAGE * 2); }, [release]);
  // A finished turn is now in the CLI's own transcript: re-read it, then drop the optimistic echo.
  const fin = useFinished(agent.id);
  const idle = useRef(true);
  idle.current = !turn && agent.status !== 'running' && !(agent.queued ?? 0);
  // When a turn ends and nothing is left behind it, whatever is still in the outbox was sent (its text just differs in the transcript).
  useEffect(() => { if (fin) void load().then(() => { if (idle.current) setOutbox((o) => (o.length ? [] : o)); }); }, [fin]); // eslint-disable-line react-hooks/exhaustive-deps
  // Whatever the transcript already holds is no longer "sent but pending".
  useEffect(() => {
    setOutbox((o) => { const left = o.filter((p) => !msgs.some((m) => m.role === 'user' && m.blocks.some((b) => b.type === 'text' && b.text.trim() === p.trim()))); return left.length === o.length ? o : left; });
  }, [msgs]);

  // Keep the view pinned to the newest content while the user hasn't scrolled away,
  // including when markdown/tool blocks grow after the first paint.
  useEffect(() => {
    const el = threadRef.current; const inner = el?.firstElementChild; if (!el || !inner) return;
    // The thread's own size matters too (a taller draft, a window resize, the terminal panel): while anchored the bottom stays in view.
    const pin = () => { if (stick.current) el.scrollTop = el.scrollHeight; sync(); };
    const ro = new ResizeObserver(pin); ro.observe(inner); ro.observe(el); pin();
    return () => ro.disconnect();
  }, [loaded, agent.id, sync]);

  const send = useCallback(async (prompt: string, files: { name: string; data: string; type: string }[] = []) => {
    if (readOnly) return false;
    setOutbox((o) => [...o, prompt]); toBottom();
    try {
      const r = await api.post<{ prompt?: string }>(`/agents/${agent.id}/messages`, { prompt, ...(files.length ? { files } : {}) });
      // With pictures the server adds a note with where it saved them: the waiting bubble shows the message as the agent got it.
      if (r.prompt && r.prompt !== prompt) setOutbox((o) => { const i = o.lastIndexOf(prompt); return i < 0 ? o : o.map((x, j) => (j === i ? r.prompt! : x)); });
      return true;
    }
    catch (e) { setOutbox((o) => { const i = o.lastIndexOf(prompt); return i < 0 ? o : o.filter((_, j) => j !== i); }); toast(e instanceof Error ? e.message : t('chat.sendFailed'), 'err'); return false; }
  }, [agent.id, readOnly, toast, t, toBottom]);
  const stop = useCallback(() => { void api.post(`/agents/${agent.id}/stop`).catch(() => undefined); }, [agent.id]);
  const toggleTools = useCallback(() => setToolsOpen((o) => (o ? false : true)), []);

  // The running turn already shows its own prompt; the rest of the outbox waits its turn and is shown as queued.
  const waiting = outbox.filter((p, i) => !(turn && i === outbox.findIndex((x) => x.trim() === turn.prompt.trim())));
  const isEmpty = loaded && !msgs.length && !turn && !outbox.length;

  return (
    <>
      <ToolsOpen.Provider value={toolsOpen}>
      <div className="thread-wrap">
      {/* A log, announced politely only between turns: while a reply streams it is aria-live off (a token-by-token read-out is unusable); the status line below says when it starts and ends. */}
      <div className="thread" ref={threadRef} role="log" aria-label={t('fa.chat.log', { name: agent.name })} aria-live={turn ? 'off' : 'polite'} aria-relevant="additions" tabIndex={-1}
        onWheel={(e) => { if (e.deltaY < 0 && scrollable()) release(); }} onTouchStart={touched} onTouchMove={touched} onPointerDown={touched} onPointerMove={(e) => { if (e.buttons) touched(); }}
        onKeyDown={(e) => { if (['PageUp', 'ArrowUp', 'Home'].includes(e.key) && !(e.target instanceof HTMLTextAreaElement) && scrollable()) release(); }}
        // Opening or folding a pill of an earlier reply changes the height under it: the view stays where the person is reading instead of following the bottom.
        onClickCapture={(e) => { const pill = (e.target as Element).closest('.pill'); if (pill && !pill.closest('[data-live]')) release(); }}
        onScroll={(e) => { const el = e.currentTarget;
          // Anchored only at the very bottom; a person's move up (a recent gesture) releases at any size. The gesture window, not the distance, tells a layout clamp from a scroll.
          if (distance() <= ANCHOR_PX) stick.current = true;
          else if (el.scrollTop < lastTop.current - 1 && performance.now() - gesture.current < 700) stick.current = false;
          sync(); lastTop.current = el.scrollTop; }}>
        <div className={`thread-inner ${loaded ? 'in' : ''}`}>
          {isEmpty && (
            <div className="mt-l"><EmptyState icon={<Hex agent={agent} size="lg" />} title={t('chat.empty.title', { name: agent.name })} body={agent.role === 'orchestrator' ? t('chat.empty.orchestrator') : t('chat.empty.worker')} /></div>
          )}
          {total > msgs.length && <button type="button" className="btn sm chat-earlier" onClick={earlier}>{t('chat.earlier', { n: total - msgs.length })}</button>}
          <History msgs={msgs} agent={agent} live={!!turn} />
          {turn && (
            <>
              {turn.source === 'dispatch' ? (
                <div className="delegation-card">
                  <div className="head"><Waypoints size={14} />{t('chat.delegatedFrom', { name: agents.find((a) => a.id === turn.from)?.name ?? t('chat.anOrchestrator') })}</div>
                  <p>{turn.prompt}</p>
                  <span className="hint">{t('chat.delegatedNote')}</span>
                </div>
              ) : !msgs.some((m) => m.role === 'user' && m.blocks.some((b) => b.type === 'text' && b.text.trim() === turn.prompt.trim())) && (
                <UserBubble text={turn.prompt} agentId={agent.id} />
              )}
              <div className="msg assistant" data-live="">
                {compact ? <PillReply head={<><Hex agent={agent} size="sm" />{agent.name}</>} blocks={turn.blocks} streaming /> : (<>
                  <div className="who"><Hex agent={agent} size="sm" />{agent.name}</div>
                  <Blocks blocks={turn.blocks} streaming />
                </>)}
                {!turn.error && <span className="typing" aria-label={t('common.working')}><i /><i /><i /></span>}
                <LiveMeta turn={turn} />
                {turn.error && (
                  <Banner kind="err" onDismiss={() => clearLive(agent.id)}>{translateServerError(turn.error)}<FailedHint agent={agent} error={turn.error} onDone={() => clearLive(agent.id)} /></Banner>
                )}
              </div>
            </>
          )}
          {waiting.map((p, i) => <UserBubble key={`${i}:${p}`} agentId={agent.id} text={p} badge={turn ? t('chat.queuedBadge') : undefined} />)}
        </div>
      </div>
      {away && <button type="button" className="btn sm chat-jump" onClick={toBottom}><ArrowDown size={14} aria-hidden />{t('fa.chat.jump')}</button>}
      </div>
      </ToolsOpen.Provider>
      <span className="chat-sr" role="status">{turn ? t('fa.chat.working', { name: agent.name }) : fin ? t('fa.chat.done', { name: agent.name }) : ''}</span>
      <Composer agentId={agent.id} name={agent.name} running={running} queued={agent.queued ?? 0} readOnly={readOnly} onSend={send} onStop={stop} toolsOpen={toolsOpen} onToggleTools={toggleTools} />
    </>
  );
}
