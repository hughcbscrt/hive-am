'use client';
import { useEffect, useState } from 'react';
import { Activity, ChevronDown, Coins, Gauge, Hammer, Layers, Timer } from 'lucide-react';
import { api } from '@/lib/api';
import { useHive } from '@/lib/store';
import { fmtCost, fmtDur, fmtTokens, totalTokens } from '@/lib/format';
import type { Agent, SessionStats } from '@/lib/types';

const CTX_WINDOW = 200_000;

export function StatsBar({ agent, session }: { agent: Agent; session?: string | null }) {
  const { finished, live } = useHive();
  const [s, setS] = useState<SessionStats | null>(null);
  const [open, setOpen] = useState(false);
  const fin = finished[agent.id] ?? 0;
  const lv = live[agent.id];

  useEffect(() => {
    if (!agent.session_id && !session) { setS(null); return; }
    api.get<SessionStats>(`/agents/${agent.id}/stats${session ? `?session=${encodeURIComponent(session)}` : ''}`).then(setS).catch(() => undefined);
  }, [agent.id, agent.session_id, session, fin]);

  if (!s || (s.turns === 0 && !lv)) return null;
  // While a turn runs, fold its live numbers on top of the saved session totals.
  const lu = lv?.usage;
  const tokens = totalTokens(s.usage) + (lu ? totalTokens({ input: lu.input ?? 0, output: lu.output ?? 0, cacheRead: lu.cacheRead ?? 0, cacheWrite: lu.cacheWrite ?? 0 }) : 0);
  const cost = (s.cost ?? 0) + (lv?.cost ?? 0);
  const credits = (s.usage.credits ?? 0) + (lu?.credits ?? 0);
  const ctxPct = lu?.contextPct ?? s.contextPct ?? (s.lastContext ? Math.min(100, (s.lastContext / CTX_WINDOW) * 100) : null);
  const hasCost = s.cost !== null || lv?.cost !== undefined;
  const u = s.usage;
  const sum = Math.max(1, u.input + u.output + u.cacheRead + u.cacheWrite);
  const maxTool = Math.max(1, ...s.tools.map((t) => t.count));
  const maxTurn = Math.max(1, ...s.timeline.map((t) => t.tokens));

  return (
    <div className="stats-wrap">
      <button className="statsbar" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="sb" title="Tokens in the latest request's context"><Gauge size={14} /><b>{ctxPct !== null ? `${ctxPct.toFixed(ctxPct < 10 ? 1 : 0)}%` : fmtTokens(s.lastContext)}</b>context</span>
        <span className="sb"><Layers size={14} /><b>{fmtTokens(tokens)}</b>tokens</span>
        {credits > 0 && <span className="sb"><Coins size={14} /><b>{credits.toFixed(2)}</b>credits</span>}
        {hasCost && <span className="sb" title={s.costEstimated ? 'Estimated from public list prices' : 'Reported by the CLI'}><Coins size={14} /><b>{s.costEstimated ? '≈ ' : ''}{fmtCost(cost)}</b></span>}
        <span className="sb"><Activity size={14} /><b>{s.turns}</b>{s.turns === 1 ? 'turn' : 'turns'}</span>
        <span className="sb"><Hammer size={14} /><b>{s.toolCalls}</b>tool calls{s.toolErrors > 0 && <em className="tbad"> · {s.toolErrors} failed</em>}</span>
        {s.durationMs > 0 && <span className="sb"><Timer size={14} /><b>{fmtDur(s.durationMs)}</b>working</span>}
        <ChevronDown size={15} className={`chev2 ${open ? 'open' : ''}`} />
      </button>
      {open && (
        <div className="statspanel">
          <section>
            <div className="eyebrow">Token mix</div>
            <div className="mixbar" role="img" aria-label="Token mix">
              <i style={{ width: `${(u.cacheRead / sum) * 100}%`, background: 'var(--p-opencode)' }} />
              <i style={{ width: `${(u.cacheWrite / sum) * 100}%`, background: 'var(--p-kiro)' }} />
              <i style={{ width: `${(u.input / sum) * 100}%`, background: 'var(--honey)' }} />
              <i style={{ width: `${(u.output / sum) * 100}%`, background: 'var(--p-claude)' }} />
            </div>
            <dl className="legend">
              <div><i style={{ background: 'var(--p-opencode)' }} /><dt>Cache read</dt><dd>{fmtTokens(u.cacheRead)}</dd></div>
              <div><i style={{ background: 'var(--p-kiro)' }} /><dt>Cache write</dt><dd>{fmtTokens(u.cacheWrite)}</dd></div>
              <div><i style={{ background: 'var(--honey)' }} /><dt>Input</dt><dd>{fmtTokens(u.input)}</dd></div>
              <div><i style={{ background: 'var(--p-claude)' }} /><dt>Output</dt><dd>{fmtTokens(u.output)}{u.reasoning > 0 && <span className="muted"> ({fmtTokens(u.reasoning)} thinking)</span>}</dd></div>
            </dl>
            {s.models.length > 0 && (<><div className="eyebrow" style={{ marginTop: 14 }}>Models</div>{s.models.map((m) => <div key={m.model} className="row small" style={{ justifyContent: 'space-between' }}><span className="mono">{m.model}</span><span className="muted">{m.messages} msgs · {fmtTokens(m.output)} out</span></div>)}</>)}
          </section>
          <section>
            <div className="eyebrow">Tools used {s.toolTimeMs > 0 && <span className="muted">· {fmtDur(s.toolTimeMs)} total</span>}</div>
            {s.tools.length === 0 ? <p className="muted small" style={{ margin: '6px 0 0' }}>No tools called yet.</p> : s.tools.slice(0, 9).map((t) => (
              <div key={t.name} className="toolrow" title={`${t.count} calls · ${fmtDur(t.totalMs)} total`}>
                <span className="mono tn">{t.name.replace(/^mcp__/, '').replace('__', ' · ')}</span>
                <span className="tbar"><i style={{ width: `${(t.count / maxTool) * 100}%` }} /></span>
                <span className="tc">{t.count}{t.errors > 0 && <em className="tbad"> ({t.errors}✗)</em>}</span>
                <span className="td muted">{t.totalMs ? fmtDur(t.totalMs / t.count) : ''}</span>
              </div>
            ))}
          </section>
          <section style={{ gridColumn: '1 / -1' }}>
            <div className="eyebrow">Tokens per turn</div>
            <div className="spark" role="list">
              {s.timeline.slice(-40).map((t, i) => (
                <div key={i} className="sbar" role="listitem" title={`${t.prompt || '(prompt)'}\n${fmtTokens(t.tokens)} tokens${t.cost !== null ? ` · ${fmtCost(t.cost)}` : ''} · ${t.tools} tools · ${fmtDur(t.durationMs)}`}>
                  <i style={{ height: `${Math.max(4, (t.tokens / maxTurn) * 100)}%` }} />
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
