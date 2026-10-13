'use client';
import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Pause, Play, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';
import { useHiveData } from '@/lib/store';
import { usePolling } from '@/lib/hooks/usePolling';
import { fmtDateTime } from '@/lib/format';
import { ago } from '@/lib/meta';
import { useI18n } from '@/lib/i18n';
import type { ScheduleItem, ScheduleRun, ScheduleRunStatus } from '@/lib/types';
import { Banner, ConfirmDialog, EmptyState, Hex, useToast } from '@/components/ui';

const WARN: ScheduleRunStatus[] = ['failed', 'skipped_reassigned'];

export default function Schedules() {
  const { t } = useI18n();
  const toast = useToast();
  const { agents, ready } = useHiveData();
  const [items, setItems] = useState<ScheduleItem[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [runs, setRuns] = useState<ScheduleRun[]>([]);
  const [removing, setRemoving] = useState<ScheduleItem | null>(null);

  const [loadErr, setLoadErr] = useState(false);
  // One failing request shows one banner (not a toast every 10 s); the list keeps polling, but not while the tab is hidden.
  const load = useCallback(async () => { const r = await api.get<ScheduleItem[]>('/schedules'); setItems(r.sort((a, b) => (a.next_due ?? Infinity) - (b.next_due ?? Infinity))); setLoadErr(false); }, []);
  usePolling(load, 10_000, { onError: () => setLoadErr(true) });
  // The history is read when a row is opened, and again only when that row has fired since (not on every poll).
  const openFired = items?.find((s) => s.id === open)?.fire_count;
  useEffect(() => { if (open) void api.get<ScheduleRun[]>(`/schedules/${open}/runs`).then(setRuns).catch(() => setRuns([])); }, [open, openFired]);

  const until = (ts: number) => {
    const m = Math.max(1, Math.round((ts - Date.now()) / 60000));
    if (m < 60) return t('sched.minShort', { count: m });
    const h = Math.round(m / 60); if (h < 48) return t('sched.hourShort', { count: h });
    return t('sched.dayShort', { count: Math.round(h / 24) });
  };
  const toggle = (s: ScheduleItem) => api.patch(`/schedules/${s.id}`, { enabled: !s.enabled }).then(load).catch((e) => toast(e.message, 'err'));
  const remove = async (s: ScheduleItem) => { await api.del(`/schedules/${s.id}`); await load(); };

  return (
    <div className="page">
      <div className="page-head"><div><h1>{t('nav.schedules')}</h1><p>{t('sched.subtitle')}</p></div></div>

      {loadErr && <Banner kind="err">{t('fa.sched.loadFailed')}</Banner>}
      {ready && items && items.length === 0 ? (
        <EmptyState icon={<CalendarClock size={28} />} title={t('sched.empty.title')} body={t('sched.empty.body')} />
      ) : (
        <div className="sched-list">
          {(items ?? []).map((s) => {
            const agent = agents.find((a) => a.id === s.agent_id);
            const recurring = s.kind !== 'once';
            return (
              <div key={s.id} className={`card card-pad sched ${s.enabled ? '' : 'off'}`}>
                <div className="row gap-s">
                  {agent ? <Hex agent={agent} size="sm" /> : null}<b>{s.agent_name}</b>
                  <span className="chip">{t(`sched.kind.${s.kind}`)}</span>
                  <span className="chip">{s.thread_id ? s.place || 'chat' : t('sched.where.web')}</span>
                  {!s.enabled && <span className="chip warn">{t('sched.paused')}</span>}
                  <span className="grow" />
                  {recurring && <button className="btn ghost sm" onClick={() => void toggle(s)}>{s.enabled ? <><Pause size={14} />{t('sched.pause')}</> : <><Play size={14} />{t('sched.resume')}</>}</button>}
                  <button className="btn ghost sm" aria-label={t('common.delete')} onClick={() => setRemoving(s)}><Trash2 size={14} /></button>
                </div>
                {(recurring || s.kind === 'watch') && <div className="small"><code>{s.description}</code></div>}
                <p className="note">{s.note}</p>
                <div className="meta muted small">
                  <span>{t(s.kind === 'watch' ? 'sched.until' : 'sched.next')}: {s.next_due ? `${fmtDateTime(s.next_due)} · ${t('sched.in', { when: until(s.next_due) })}` : t('sched.never')}</span>
                  {recurring && s.last_status && <span>{t('sched.last')}: <span className={`chip ${WARN.includes(s.last_status) ? 'warn' : ''}`}>{t(`sched.status.${s.last_status}`)}</span> {ago(s.last_fired_at)}</span>}
                  {recurring && <span>{t('sched.runs', { count: s.fire_count })}</span>}
                  {recurring && <button className="linkbtn" onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? <><ChevronUp size={13} /> {t('sched.hide')}</> : <><ChevronDown size={13} /> {t('sched.history')}</>}</button>}
                </div>
                {open === s.id && (
                  <div className="sched-runs">
                    {runs.length === 0 ? <span className="muted">{t('sched.noRuns')}</span> : runs.map((r) => (
                      <div key={r.id} className="r">
                        <span className="muted">{fmtDateTime(r.fired_at)}</span>
                        <span className={`chip ${WARN.includes(r.status) ? 'warn' : ''}`}>{t(`sched.status.${r.status}`)}</span>
                        {r.duration_ms ? <span className="muted">{Math.round(r.duration_ms / 1000)} s</span> : null}
                        {r.detail ? <span className="muted">{r.detail}</span> : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {removing && <ConfirmDialog danger title={t('sched.deleteTitle')} body={t('sched.deleteBody')} confirmLabel={t('common.delete')} onConfirm={() => remove(removing)} onClose={() => setRemoving(null)} />}
    </div>
  );
}
