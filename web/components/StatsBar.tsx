'use client';
import { useEffect, useState } from 'react';
import { Activity, ChevronDown, Coins, Gauge, Hammer, Layers, Timer } from 'lucide-react';
import { api } from '@/lib/api';
import { useHive } from '@/lib/store';
import { fmtCost, fmtDur, fmtTokens, totalTokens } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { Agent, SessionStats } from '@/lib/types';

const CTX_WINDOW = 200_000;

export function StatsBar({ agent, session }: { agent: Agent; session?: string | null }) {
  const { t } = useI18n();
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
  const maxTool = Math.max(1, ...s.tools.map((x) => x.count));
  const maxTurn = Math.max(1, ...s.timeline.map((x) => x.tokens));

  return (
    <div className="stats-wrap">
      <button className="statsbar" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="sb" title={t('stats.contextTitle')}><Gauge size={14} /><b>{ctxPct !== null ? `${ctxPct.toFixed(ctxPct < 10 ? 1 : 0)}%` : fmtTokens(s.lastContext)}</b>{t('stats.context')}</span>
        <span className="sb"><Layers size={14} /><b>{fmtTokens(tokens)}</b>{t('stats.tokens')}</span>
        {credits > 0 && <span className="sb"><Coins size={14} /><b>{credits.toFixed(2)}</b>{t('stats.credits')}</span>}
        {hasCost && <span className="sb" title={s.costEstimated ? t('stats.costEstimated') : t('stats.costReported')}><Coins size={14} /><b>{s.costEstimated ? '≈ ' : ''}{fmtCost(cost)}</b></span>}
        <span className="sb"><Activity size={14} /><b>{s.turns}</b>{t('stats.turns', { count: s.turns })}</span>
        <span className="sb"><Hammer size={14} /><b>{s.toolCalls}</b>{t('stats.toolCalls', { count: s.toolCalls })}{s.toolErrors > 0 && <em className="tbad"> · {t('stats.failed', { count: s.toolErrors })}</em>}</span>
        {s.durationMs > 0 && <span className="sb"><Timer size={14} /><b>{fmtDur(s.durationMs)}</b>{t('stats.working')}</span>}
        <ChevronDown size={15} className={`chev2 ${open ? 'open' : ''}`} />
      </button>
      {open && (
        <div className="statspanel">
          <section>
            <div className="eyebrow">{t('stats.mix')}</div>
            <div className="mixbar" role="img" aria-label={t('stats.mix')}>
              <i style={{ width: `${(u.cacheRead / sum) * 100}%`, background: 'var(--p-opencode)' }} />
              <i style={{ width: `${(u.cacheWrite / sum) * 100}%`, background: 'var(--p-kiro)' }} />
              <i style={{ width: `${(u.input / sum) * 100}%`, background: 'var(--honey)' }} />
              <i style={{ width: `${(u.output / sum) * 100}%`, background: 'var(--p-claude)' }} />
            </div>
            <dl className="legend">
              <div><i style={{ background: 'var(--p-opencode)' }} /><dt>{t('stats.cacheRead')}</dt><dd>{fmtTokens(u.cacheRead)}</dd></div>
              <div><i style={{ background: 'var(--p-kiro)' }} /><dt>{t('stats.cacheWrite')}</dt><dd>{fmtTokens(u.cacheWrite)}</dd></div>
              <div><i style={{ background: 'var(--honey)' }} /><dt>{t('stats.input')}</dt><dd>{fmtTokens(u.input)}</dd></div>
              <div><i style={{ background: 'var(--p-claude)' }} /><dt>{t('stats.output')}</dt><dd>{fmtTokens(u.output)}{u.reasoning > 0 && <span className="muted"> ({t('stats.thinking', { tokens: fmtTokens(u.reasoning) })})</span>}</dd></div>
            </dl>
            {s.models.length > 0 && (<><div className="eyebrow" style={{ marginTop: 14 }}>{t('stats.models')}</div>{s.models.map((m) => <div key={m.model} className="row small" style={{ justifyContent: 'space-between' }}><span className="mono">{m.model}</span><span className="muted">{t('stats.modelLine', { count: m.messages, out: fmtTokens(m.output) })}</span></div>)}</>)}
          </section>
          <section>
            <div className="eyebrow">{t('stats.toolsUsed')} {s.toolTimeMs > 0 && <span className="muted">· {t('stats.totalTime', { time: fmtDur(s.toolTimeMs) })}</span>}</div>
            {s.tools.length === 0 ? <p className="muted small" style={{ margin: '6px 0 0' }}>{t('stats.noTools')}</p> : s.tools.slice(0, 9).map((x) => (
              <div key={x.name} className="toolrow" title={t('stats.toolTitle', { count: x.count, time: fmtDur(x.totalMs) })}>
                <span className="mono tn">{x.name.replace(/^mcp__/, '').replace('__', ' · ')}</span>
                <span className="tbar"><i style={{ width: `${(x.count / maxTool) * 100}%` }} /></span>
                <span className="tc">{x.count}{x.errors > 0 && <em className="tbad"> ({x.errors}✗)</em>}</span>
                <span className="td muted">{x.totalMs ? fmtDur(x.totalMs / x.count) : ''}</span>
              </div>
            ))}
          </section>
          <section style={{ gridColumn: '1 / -1' }}>
            <div className="eyebrow">{t('stats.perTurn')}</div>
            <div className="spark" role="list">
              {s.timeline.slice(-40).map((x, i) => (
                <div key={i} className="sbar" role="listitem" title={`${x.prompt || t('stats.promptFallback')}\n${t('stats.turnLine', { tokens: fmtTokens(x.tokens), tools: x.tools, time: fmtDur(x.durationMs) })}${x.cost !== null ? ` · ${fmtCost(x.cost)}` : ''}`}>
                  <i style={{ height: `${Math.max(4, (x.tokens / maxTurn) * 100)}%` }} />
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
