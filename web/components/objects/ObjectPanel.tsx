'use client';
import { useState } from 'react';
import { Pencil, Play, RotateCw, Square } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { ago, shortPath } from '@/lib/meta';
import type { DockerConfig, ObjectView, ServerConfig } from '@/lib/types';
import { useToast } from '@/components/ui';
import { KIND, STATUS_TONE } from './meta';
import { LogView } from './LogView';

export function StatusDot({ status, className = '' }: { status: ObjectView['state']['status']; className?: string }) {
  return <i className={`odot ${STATUS_TONE[status]} ${className}`} aria-hidden />;
}

/** One-line summary of how an object is run. */
export function objectSummary(o: ObjectView): string {
  if (o.kind === 'server') { const c = o.config as ServerConfig; return c.start; }
  const c = o.config as DockerConfig;
  return c.mode === 'container' ? c.image ?? '' : c.mode === 'compose' ? shortPath(c.file ?? '') : c.container ?? '';
}

/** The panel shown when an object of the colony map is selected: its state, start/stop/restart, and its logs. */
export function ObjectPanel({ object: o, onEdit }: { object: ObjectView; onEdit: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const { icon: Icon, color } = KIND[o.kind];
  const st = o.state.status;
  const act = async (action: 'start' | 'stop' | 'restart') => {
    setBusy(action);
    try { await api.post(`/objects/${o.id}/action`, { action }); }
    catch (e) { toast(`${t('obj.act.failed', { action: t(`obj.act.${action}`) })}: ${e instanceof Error ? e.message : ''}`, 'err'); }
    finally { setBusy(null); }
  };
  const live = st === 'running' || st === 'starting';
  return (
    <aside className="side-float card card-pad col obj-panel" style={{ gap: 12 }} aria-label={o.name}>
      <div className="card-corner row gap-s"><button className="btn ghost icon sm" onClick={onEdit} aria-label={t('obj.act.edit')} title={t('obj.act.edit')}><Pencil size={15} /></button></div>
      <div className="row gap-l" style={{ paddingRight: 44 }}>
        <span className="obj-ico" style={{ ['--c' as never]: color }}><Icon size={22} /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 20, overflowWrap: 'anywhere' }}>{o.name}</h2>
          <div className="row gap-s wrap" style={{ marginTop: 4 }}>
            <span className={`ostatus ${STATUS_TONE[st]}`}><StatusDot status={st} />{t(`obj.status.${st}`)}</span>
            <span className="muted small">{t(`obj.kind.${o.kind}`)}</span>
          </div>
        </div>
      </div>
      {(o.state.detail || o.state.since) && (
        <p className="muted small" style={{ margin: 0 }}>{[o.state.detail, o.state.since && live ? t('obj.since', { time: ago(o.state.since) }) : '', o.state.pid ? t('obj.pid', { pid: o.state.pid }) : ''].filter(Boolean).join(' · ')}</p>
      )}
      <div className="mono small obj-cmd" title={objectSummary(o)}>{objectSummary(o)}</div>
      <div className="row gap-s">
        <button className="btn primary sm" disabled={!!busy || live} onClick={() => void act('start')}><Play size={14} />{t('obj.act.start')}</button>
        <button className="btn sm" disabled={!!busy || (!live && st !== 'error')} onClick={() => void act('stop')}><Square size={14} />{t('obj.act.stop')}</button>
        <button className="btn sm" disabled={!!busy} onClick={() => void act('restart')}><RotateCw size={14} />{t('obj.act.restart')}</button>
      </div>
      <div><div className="eyebrow" style={{ marginBottom: 6 }}>{t('obj.logs')}</div><LogView id={o.id} /></div>
    </aside>
  );
}
