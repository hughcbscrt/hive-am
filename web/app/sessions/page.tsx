'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
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

const FIRST = 100, MORE = 200, LONG = 1600; // messages first loaded / added per click; characters before a message is folded

/** A long message (a pasted log, a whole file) is folded so one of them cannot push the rest of the conversation out of view. */
function Folded({ children, text }: { children: React.ReactNode; text: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (text.length <= LONG) return <>{children}</>;
  return (
    <div className={`sx-fold ${open ? 'open' : ''}`}>
      <div className="sx-fold-body">{children}</div>
      <button className="btn ghost sm" onClick={() => setOpen(!open)}>{open ? t('sessions.showLess') : t('sessions.showMore', { count: Math.round(text.length / 1000) })}</button>
    </div>
  );
}

export default function Sessions() {
  const { t, locale } = useI18n();
  const { agents } = useHive();
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [q, setQ] = useState('');
  const [prov, setProv] = useState<'all' | Provider>('all');
  const [sel, setSel] = useState<SessionRow | null>(null);
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(FIRST);
  const scroller = useRef<HTMLDivElement>(null);

  // The list comes back at once with what is cached; rows still being read are asked about again until they are all known.
  useEffect(() => {
    let dead = false, timer: ReturnType<typeof setTimeout>;
    const load = () => api.get<SessionRow[]>('/sessions').then((r) => { if (dead) return; setRows(r); if (r.some((x) => x.pending)) timer = setTimeout(load, 2500); }).catch(() => !dead && setRows((x) => x ?? []));
    load();
    return () => { dead = true; clearTimeout(timer); };
  }, []);
  // A different session starts again from the newest messages.
  useEffect(() => { setLimit(FIRST); }, [sel?.session_id]);
  useEffect(() => {
    let dead = false;
    if (!sel) { setMsgs(null); return; }
    api.get<{ messages: ChatMessage[]; total?: number }>(`/agents/${sel.agent_id}/history?session=${encodeURIComponent(sel.session_id)}&limit=${limit}`)
      .then((r) => { if (dead) return; setMsgs(r.messages); setTotal(r.total ?? r.messages.length); })
      .catch(() => !dead && setMsgs([]));
    return () => { dead = true; };
  }, [sel?.agent_id, sel?.session_id, limit]); // eslint-disable-line react-hooks/exhaustive-deps
  // Opening a session shows its end (what happened last), like a chat.
  useEffect(() => { if (msgs && limit === FIRST && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [msgs, limit]);

  const list = useMemo(() => (rows ?? []).filter((r) => (prov === 'all' || r.provider === prov) && (!q || `${r.agent_name} ${r.preview} ${r.cwd}`.toLowerCase().includes(q.toLowerCase()))), [rows, q, prov]);
  const byDay = useMemo(() => {
    const g = new Map<string, SessionRow[]>();
    for (const r of list) { const k = new Date(r.last_seen).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'short' }); g.set(k, [...(g.get(k) ?? []), r]); }
    return [...g.entries()];
  }, [list, locale]);
  const agent = sel && agents.find((a) => a.id === sel.agent_id);
  const older = msgs ? total - msgs.length : 0;

  return (
    <div className="page full">
      {rows && !rows.length ? (
        <div className="empty" style={{ margin: 36 }}><h3>{t('sessions.empty.title')}</h3><p>{t('sessions.empty.body')}</p><Link className="btn primary" href="/agents">{t('sessions.empty.go')}</Link></div>
      ) : (
        <div className="sk-ws sx-ws">
          <aside className="switcher" aria-label={t('nav.sessions')}>
            <div className="switcher-head">
              <b style={{ fontFamily: 'var(--font-display)', fontSize: 16 }}>{t('nav.sessions')}</b>
              <div className="search"><Search size={15} /><input className="input" placeholder={t('sessions.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('sessions.searchLabel')} /></div>
              <Segmented value={prov} onChange={setProv} options={[{ id: 'all', label: t('common.all') }, ...(Object.keys(PROVIDERS) as Provider[]).map((p) => ({ id: p, label: PROVIDERS[p].short }))]} />
            </div>
            <div className="switcher-list">
              {rows === null && <p className="muted small" style={{ padding: 16 }}>{t('sessions.reading')}</p>}
              {byDay.map(([day, items]) => (
                <div key={day}>
                  <div className="switcher-group">{day}<span>{items.length}</span></div>
                  {items.map((r) => (
                    <button key={r.agent_id + r.session_id} className="sk-item" aria-current={sel?.session_id === r.session_id} onClick={() => setSel(r)}>
                      <div className="row" style={{ gap: 6 }}><b className="grow">{r.agent_name}</b><ProviderBadge provider={r.provider} />{r.current && <span className="chip honey">{t('sessions.current')}</span>}</div>
                      <span className="sk-desc">{r.preview || (r.pending ? t('sessions.counting') : r.task || t('sessions.emptySession'))}</span>
                      <span className="sk-meta">
                        {ago(r.last_seen)}{r.kind === 'delegation' && ` · ${t('sessions.delegatedBy', { name: r.from_name ?? t('chat.anOrchestrator') })}`}
                        {r.pending && !r.message_count ? ' · …' : ` · ${t('sessions.messages', { count: r.message_count })}`}
                        {totalTokens(r.usage) > 0 && ` · ${fmtTokens(totalTokens(r.usage))} ${t('stats.tokens')}`}{r.cost !== null && ` · ≈ ${fmtCost(r.cost)}`}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
              {rows && rows.length > 0 && !list.length && <p className="muted small" style={{ padding: 16 }}>{t('sessions.noMatch')}</p>}
            </div>
          </aside>
          {!sel ? <section className="sk-main sk-none"><p className="muted">{t('sessions.select')}</p></section> : (
            <section className="sk-main">
              <header className="sx-head">
                <div className="grow" style={{ minWidth: 0 }}><b style={{ fontFamily: 'var(--font-display)', fontSize: 17 }}>{sel.agent_name}</b><div className="muted small mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortPath(sel.cwd)} · {sel.session_id}</div></div>
                {agent && <Link className="btn sm primary" href={`/agents/${agent.id}`}>{t('sessions.openAgent')}</Link>}
              </header>
              <div className="transcript col sx-transcript" ref={scroller} style={{ gap: 16 }}>
                {msgs === null ? <p className="muted">{t('sessions.loading')}</p> : msgs.length === 0 ? <p className="muted">{t('sessions.noMessages')}</p> : (
                  <>
                    {older > 0 && <button className="btn sm" style={{ alignSelf: 'center' }} onClick={() => setLimit(limit + MORE)}>{t('sessions.older', { count: older })}</button>}
                    {msgs.map((m) => {
                      const text = m.role === 'user' ? m.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('') : '';
                      return (
                        <div key={m.id} className={`msg ${m.role}`}>
                          {m.role === 'user' ? <Folded text={text}><div className="bubble">{text}</div></Folded> :
                            m.blocks.filter((b) => b.type === 'text').map((b, i) => { const x = (b as { text: string }).text; return <Folded key={i} text={x}><div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{x}</ReactMarkdown></div></Folded>; })}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
