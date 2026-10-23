'use client';
import { useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ago } from '@/lib/meta';
import type { Agent, Dispatch } from '@/lib/types';
import { ConfirmDialog } from './ConfirmDialog';
import { useToast } from './Toast';

const DOT: Record<Dispatch['status'], string> = { running: 'run', queued: 'wait', done: 'ok', cancelled: 'off', failed: 'err', interrupted: 'err' };
const unfinished = (d: Dispatch) => d.status === 'queued' || d.status === 'running';

/**
 * The latest delegations between agents (`#recent`, the target of the "tasks" figure): six in the Colony screen, fewer in Home with a link to all of them there.
 * Unfinished ones come first and are never cut by the limit, each with a Cancel action (a running one asks first, as it stops work in progress).
 */
export function RecentDelegations({ feed, agents, limit = 6, viewAll = false }: { feed: Dispatch[]; agents: Agent[]; limit?: number; viewAll?: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const [stopping, setStopping] = useState<Dispatch | null>(null);
  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? t('colony.removedAgent');
  const open = feed.filter(unfinished);
  const rows = [...open, ...feed.filter((d) => !unfinished(d)).slice(0, Math.max(0, limit - open.length))];
  // The list refreshes through the agents_changed event the server sends after the cancel.
  const cancel = (d: Dispatch) => api.post(`/dispatches/${d.id}/cancel`);
  const ask = (d: Dispatch) => {
    if (d.status === 'running') { setStopping(d); return; }
    cancel(d).catch((e) => toast(e instanceof Error ? e.message : String(e), 'err'));
  };
  return (
    <div className={`card card-pad recent${viewAll ? ' home-recent' : ''}`} id="recent">
      <div className="eyebrow recent-head">{t('colony.recent')}{viewAll && <Link className="recent-all" href="/colony#recent">{t('home.recentAll')}</Link>}</div>
      {feed.length === 0 ? <p className="muted small m0">{t('colony.recentEmpty')}</p> :
        <div className="recent-grid">{rows.map((d) => (
          <div key={d.id} className={`feed-item${unfinished(d) ? ' open' : ''}`}>
            <i className={`dot ${DOT[d.status] ?? 'err'}`} title={t(`colony.task.${d.status}`)} />
            <div>
              <div className="feed-line">{agents.some((x) => x.id === d.from_id) ? <Link href={`/agents/${d.from_id}`} aria-label={t('cx.openAgent', { name: name(d.from_id) })}>{name(d.from_id)}</Link> : <b>{name(d.from_id)}</b>} → {agents.some((x) => x.id === d.to_id) ? <Link href={`/agents/${d.to_id}`} aria-label={t('cx.openAgent', { name: name(d.to_id) })}>{name(d.to_id)}</Link> : <b>{name(d.to_id)}</b>}</div>
              <div className="muted small ellipsis">{d.task}</div>
              <div className="muted feed-when">{ago(d.created_at)}</div>
            </div>
            {unfinished(d) && <button type="button" className="btn ghost icon feed-cancel" onClick={() => ask(d)} aria-label={t('colony.cancelTask')} title={t('colony.cancelTask')}><X size={14} /></button>}
          </div>
        ))}</div>}
      {stopping && <ConfirmDialog danger title={t('colony.cancelRunning.title')} body={t('colony.cancelRunning.body', { name: name(stopping.to_id) })} confirmLabel={t('colony.cancelRunning.confirm')} onConfirm={() => cancel(stopping)} onClose={() => setStopping(null)} />}
    </div>
  );
}
