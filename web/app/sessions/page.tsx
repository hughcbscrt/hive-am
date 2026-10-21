'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useHiveData } from '@/lib/store';
import { usePolling } from '@/lib/hooks/usePolling';
import { useQueryState } from '@/lib/hooks/useQueryState';
import { History } from '@/components/chat/Chat';
import { CopyBtn } from '@/components/chat/ToolCall';
import { PROVIDERS, ago, shortPath } from '@/lib/meta';
import { fmtCost, fmtTokens, totalTokens } from '@/lib/format';
import type { ChatMessage, Provider, SessionRow } from '@/lib/types';
import { Banner, EmptyState, ProviderBadge, SearchInput, Segmented } from '@/components/ui';
import { dateLocale, useI18n } from '@/lib/i18n';
import { HomeCrumb } from '@/components/HomeCrumb';

const FIRST = 100, MORE = 200; // messages first loaded / added per click

export default function Sessions() {
  const { t, locale } = useI18n();
  const { agents } = useHiveData();
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [q, setQ] = useState('');
  const [prov, setProv] = useState<'all' | Provider>('all');
  // The open session is in the URL (?session=<id>) so a refresh or a shared link comes back to it.
  const [selId, setSelId] = useQueryState('session', '');
  const [loadErr, setLoadErr] = useState(false);
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(FIRST);
  const scroller = useRef<HTMLDivElement>(null);

  // The list comes back at once with what is cached; rows still being read are asked about again until they are all known.
  const pending = rows === null || rows.some((x) => x.pending);
  usePolling(async () => { setRows(await api.get<SessionRow[]>('/sessions')); setLoadErr(false); }, 2500, { enabled: pending, onError: () => { setLoadErr(true); setRows((x) => x ?? []); } });
  const sel = useMemo(() => (selId && rows?.find((r) => r.session_id === selId)) || null, [rows, selId]);
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
      {loadErr && !rows?.length ? (
        <div className="m-xl"><HomeCrumb /><Banner kind="err">{t('fa.sessions.loadFailed')}</Banner></div>
      ) : rows && !rows.length ? (
        <div className="m-xl"><HomeCrumb /><EmptyState title={t('sessions.empty.title')} body={t('sessions.empty.body')} action={<Link className="btn primary" href="/agents">{t('sessions.empty.go')}</Link>} /></div>
      ) : (
        <div className="sk-ws sx-ws">
          <aside className="switcher" aria-label={t('nav.sessions')}>
            <div className="switcher-head">
              <HomeCrumb />
              <b className="fa-title">{t('nav.sessions')}</b>
              <SearchInput value={q} onChange={setQ} placeholder={t('sessions.searchPlaceholder')} label={t('sessions.searchLabel')} />
              <Segmented value={prov} onChange={setProv} options={[{ id: 'all', label: t('common.all') }, ...(Object.keys(PROVIDERS) as Provider[]).map((p) => ({ id: p, label: PROVIDERS[p].short }))]} />
            </div>
            <div className="switcher-list">
              {rows === null && <p className="muted small pad-m">{t('sessions.reading')}</p>}
              {byDay.map(([day, items]) => (
                <div key={day}>
                  <div className="switcher-group">{day}<span>{items.length}</span></div>
                  {items.map((r) => (
                    <button key={r.agent_id + r.session_id} className="sk-item" aria-current={sel?.session_id === r.session_id} onClick={() => setSelId(r.session_id)}>
                      <div className="row gap-xs"><b className="grow">{r.agent_name}</b><ProviderBadge provider={r.provider} />{r.current && <span className="chip honey">{t('sessions.current')}</span>}</div>
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
              {rows && rows.length > 0 && !list.length && <p className="muted small pad-m">{t('sessions.noMatch')}</p>}
            </div>
          </aside>
          {!sel ? <section className="sk-main sk-none"><p className="muted">{t('sessions.select')}</p></section> : (
            <section className="sk-main">
              <header className="sx-head">
                <div className="grow"><b className="fa-title lg">{sel.agent_name}</b><div className="muted small mono sess-id">{shortPath(sel.cwd)} · {sel.session_id} <CopyBtn compact text={sel.session_id} label={t('agent.sessions.copyId')} /></div></div>
                {agent && <Link className="btn sm primary" href={`/agents/${agent.id}`}>{t('sessions.openAgent')}</Link>}
              </header>
              <div className="transcript col sx-transcript" ref={scroller}>
                {msgs === null ? <p className="muted">{t('sessions.loading')}</p> : msgs.length === 0 ? <p className="muted">{t('sessions.noMessages')}</p> : (
                  <>
                    {older > 0 && <button className="btn sm push-c" onClick={() => setLimit(limit + MORE)}>{t('sessions.older', { count: older })}</button>}
                    <History msgs={msgs} agent={{ id: sel.agent_id, name: sel.agent_name, provider: sel.provider, role: sel.agent_role }} />
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
