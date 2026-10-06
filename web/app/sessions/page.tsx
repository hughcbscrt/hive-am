'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useHive } from '@/lib/store';
import { PROVIDERS, ago, shortPath } from '@/lib/meta';
import { fmtCost, fmtTokens, totalTokens } from '@/lib/format';
import type { ChatMessage, Provider, SessionRow } from '@/lib/types';
import { ProviderBadge, Segmented } from '@/components/ui';
import { dateLocale, useI18n } from '@/lib/i18n';

export default function Sessions() {
  const { t, locale } = useI18n();
  const { agents } = useHive();
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [q, setQ] = useState('');
  const [prov, setProv] = useState<'all' | Provider>('all');
  const [sel, setSel] = useState<SessionRow | null>(null);
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);

  useEffect(() => { api.get<SessionRow[]>('/sessions').then(setRows).catch(() => setRows([])); }, []);
  useEffect(() => {
    setMsgs(null); if (!sel) return;
    api.get<{ messages: ChatMessage[] }>(`/agents/${sel.agent_id}/history?session=${encodeURIComponent(sel.session_id)}`).then((r) => setMsgs(r.messages)).catch(() => setMsgs([]));
  }, [sel]);

  const list = useMemo(() => (rows ?? []).filter((r) => (prov === 'all' || r.provider === prov) && (!q || `${r.agent_name} ${r.preview} ${r.cwd}`.toLowerCase().includes(q.toLowerCase()))), [rows, q, prov]);
  const byDay = useMemo(() => {
    const g = new Map<string, SessionRow[]>();
    for (const r of list) { const k = new Date(r.last_seen).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'short' }); g.set(k, [...(g.get(k) ?? []), r]); }
    return [...g.entries()];
  }, [list, locale]);
  const agent = sel && agents.find((a) => a.id === sel.agent_id);

  return (
    <div className="page">
      <div className="page-head"><div><h1>{t('nav.sessions')}</h1><p>{t('sessions.subtitle')}</p></div></div>
      <div className="row wrap" style={{ marginBottom: 16 }}>
        <div className="search grow" style={{ maxWidth: 380 }}><Search size={16} /><input className="input" placeholder={t('sessions.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('sessions.searchLabel')} /></div>
        <Segmented value={prov} onChange={setProv} options={[{ id: 'all', label: t('common.all') }, ...(Object.keys(PROVIDERS) as Provider[]).map((p) => ({ id: p, label: PROVIDERS[p].short }))]} />
      </div>
      {rows && !rows.length ? (
        <div className="empty"><h3>{t('sessions.empty.title')}</h3><p>{t('sessions.empty.body')}</p><Link className="btn primary" href="/agents">{t('sessions.empty.go')}</Link></div>
      ) : (
        <div className="sess-grid">
          <div className="card" style={{ overflow: 'hidden' }}>
            {rows === null && <p className="muted" style={{ padding: 20 }}>{t('sessions.reading')}</p>}
            {byDay.map(([day, items]) => (
              <div key={day}>
                <div className="eyebrow" style={{ padding: '12px 16px 6px', background: 'var(--surface-2)' }}>{day}</div>
                {items.map((r) => (
                  <button key={r.agent_id + r.session_id} className="sess" aria-current={sel?.session_id === r.session_id} onClick={() => setSel(r)}>
                    <div className="row"><b style={{ fontFamily: 'var(--font-display)' }}>{r.agent_name}</b><ProviderBadge provider={r.provider} />{r.current && <span className="chip honey">{t('sessions.current')}</span>}{r.kind === 'delegation' && <span className="chip">{t('sessions.delegatedBy', { name: r.from_name ?? t('chat.anOrchestrator') })}</span>}<span className="grow" /><span className="muted small">{ago(r.last_seen)}</span></div>
                    <div className="pv">{r.preview || r.task || t('sessions.emptySession')}</div>
                    <div className="muted small mono">{shortPath(r.cwd)} · {t('sessions.messages', { count: r.message_count })}</div>
                    <div className="sessmeta">{totalTokens(r.usage) > 0 && <span>{fmtTokens(totalTokens(r.usage))} {t('stats.tokens')}</span>}{r.usage.credits ? <span>{r.usage.credits.toFixed(2)} {t('stats.credits')}</span> : null}{r.cost !== null && <span>≈ {fmtCost(r.cost)}</span>}{r.tool_calls > 0 && <span>{r.tool_calls} {t('stats.toolCalls', { count: r.tool_calls })}</span>}{r.model && <span className="mono">{r.model.replace(/^claude-/, '')}</span>}</div>
                  </button>
                ))}
              </div>
            ))}
            {rows && rows.length > 0 && !list.length && <p className="muted" style={{ padding: 20 }}>{t('sessions.noMatch')}</p>}
          </div>
          <div className="card" style={{ position: 'sticky', top: 20, minHeight: 300 }}>
            {!sel ? <div className="empty" style={{ border: 0 }}><p>{t('sessions.select')}</p></div> : (
              <>
                <div className="row" style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)' }}>
                  <div className="grow"><b style={{ fontFamily: 'var(--font-display)', fontSize: 17 }}>{sel.agent_name}</b><div className="muted small mono">{sel.session_id}</div></div>
                  {agent && <Link className="btn sm primary" href={`/agents/${agent.id}`}>{t('sessions.openAgent')}</Link>}
                </div>
                <div className="transcript col" style={{ gap: 16 }}>
                  {msgs === null ? <p className="muted">{t('sessions.loading')}</p> : msgs.length === 0 ? <p className="muted">{t('sessions.noMessages')}</p> : msgs.map((m) => (
                    <div key={m.id} className={`msg ${m.role}`}>
                      {m.role === 'user' ? <div className="bubble">{m.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('')}</div> :
                        m.blocks.filter((b) => b.type === 'text').map((b, i) => <div key={i} className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{(b as { text: string }).text}</ReactMarkdown></div>)}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
