'use client';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { ago } from '@/lib/meta';
import type { Agent, Dispatch } from '@/lib/types';

/** The last six delegations between agents (`#recent`, the target of the "tasks" figure): shown in Home and in the Colony screen. */
export function RecentDelegations({ feed, agents }: { feed: Dispatch[]; agents: Agent[] }) {
  const { t } = useI18n();
  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? t('colony.removedAgent');
  return (
    <div className="card card-pad recent" id="recent">
      <div className="eyebrow recent-head">{t('colony.recent')}</div>
      {feed.length === 0 ? <p className="muted small m0">{t('colony.recentEmpty')}</p> :
        <div className="recent-grid">{feed.slice(0, 6).map((d) => (
          <div key={d.id} className="feed-item">
            <i className={`dot ${d.status === 'running' ? 'run' : d.status === 'queued' ? 'wait' : d.status === 'done' ? 'ok' : 'err'}`} title={t(`colony.task.${d.status}`)} />
            <div>
              <div className="feed-line">{agents.some((x) => x.id === d.from_id) ? <Link href={`/agents/${d.from_id}`} aria-label={t('cx.openAgent', { name: name(d.from_id) })}>{name(d.from_id)}</Link> : <b>{name(d.from_id)}</b>} → {agents.some((x) => x.id === d.to_id) ? <Link href={`/agents/${d.to_id}`} aria-label={t('cx.openAgent', { name: name(d.to_id) })}>{name(d.to_id)}</Link> : <b>{name(d.to_id)}</b>}</div>
              <div className="muted small ellipsis">{d.task}</div>
              <div className="muted feed-when">{ago(d.created_at)}</div>
            </div>
          </div>
        ))}</div>}
    </div>
  );
}
