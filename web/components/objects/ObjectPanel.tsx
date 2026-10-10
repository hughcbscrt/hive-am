'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ExternalLink, FileText, Pencil, Play, RotateCw, Square, SquareTerminal, UserPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { ago, shortPath } from '@/lib/meta';
import type { ClusterConfig, DockerConfig, HttpConfig, ObjectView, ServerConfig } from '@/lib/types';
import { useToast } from '@/components/ui';
import { useHive } from '@/lib/store';
import { useDock } from '@/lib/dock';
import { OBJECTS_SKILL_ID } from '@/components/agents/NewAgentDrawer';
import { KIND, STATUS_TONE } from './meta';
import { LogView } from './LogView';

export function StatusDot({ status, className = '' }: { status: ObjectView['state']['status']; className?: string }) {
  return <i className={`odot ${STATUS_TONE[status]} ${className}`} aria-hidden />;
}

/** One-line summary of how an object is run. */
export function objectSummary(o: ObjectView): string {
  if (o.kind === 'server') { const c = o.config as ServerConfig; return c.start; }
  if (o.kind === 'http') return shortPath((o.config as HttpConfig).folder);
  if (o.kind === 'cluster') return `${(o.config as ClusterConfig).members.length}`;
  const c = o.config as DockerConfig;
  return c.mode === 'container' ? c.image ?? '' : c.mode === 'compose' ? shortPath(c.file ?? '') : c.container ?? '';
}

/** The panel shown when an object of the colony map is selected: its state, start/stop/restart, and its logs. */
export function ObjectPanel({ object: o, onCreateManager }: { object: ObjectView; onCreateManager: () => void }) {
  const { t } = useI18n();
  const { agents, objects } = useHive();
  const dock = useDock();
  // A terminal where the server runs, or inside the container (a compose project has several, so it only has logs).
  const canShell = o.kind === 'server' || (o.kind === 'docker' && (o.config as DockerConfig).mode !== 'compose');
  // The agents that can act on it: the ones with the Colony objects skill in the same colony (or, with no colony, among the objects that have none).
  const managers = agents.filter((a) => a.skill_ids.includes(OBJECTS_SKILL_ID) && (a.colony_id ?? null) === (o.colony_id ?? null));
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
  const members = o.kind === 'cluster' ? (o.config as ClusterConfig).members.map((id) => objects.find((x) => x.id === id)).filter((x): x is ObjectView => !!x) : [];
  return (
    <aside className="side-float card card-pad col obj-panel" style={{ gap: 12 }} aria-label={o.name}>
      <div className="card-corner row gap-s"><Link className="btn ghost icon sm" href={`/objects/${o.id}?tab=config`} aria-label={t('obj.act.edit')} title={t('obj.act.edit')}><Pencil size={15} /></Link></div>
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
      <Link className="btn primary" href={`/objects/${o.id}`}><ExternalLink size={15} />{t('obj.open')}</Link>
      {o.kind !== 'cluster' && <div className="mono small obj-cmd" title={objectSummary(o)}>{objectSummary(o)}</div>}
      {o.kind === 'http' ? null : (<>
        <div className="row gap-s wrap">
          <button className="btn primary sm" disabled={!!busy || (o.kind === 'cluster' ? st === 'running' : live)} onClick={() => void act('start')}><Play size={14} />{t(o.kind === 'cluster' ? 'obj.act.startAll' : 'obj.act.start')}</button>
          <button className="btn sm" disabled={!!busy || (!live && st !== 'error' && !(o.kind === 'cluster' && members.some((m) => m.state.status === 'running')))} onClick={() => void act('stop')}><Square size={14} />{t(o.kind === 'cluster' ? 'obj.act.stopAll' : 'obj.act.stop')}</button>
          <button className="btn sm" disabled={!!busy} onClick={() => void act('restart')}><RotateCw size={14} />{t(o.kind === 'cluster' ? 'obj.act.restartAll' : 'obj.act.restart')}</button>
        </div>
        {o.kind === 'cluster' && (
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>{t('obj.members')}</div>
            {members.length ? <div className="col" style={{ gap: 4 }}>{members.map((m, i) => (
              <div key={m.id} className="row gap-s small"><span className="ord">{i + 1}</span><StatusDot status={m.state.status} /><b className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</b><span className="muted">{t(`obj.status.${m.state.status}`)}</span></div>))}</div>
              : <p className="muted small" style={{ margin: 0 }}>{t('obj.members.empty')}</p>}
          </div>
        )}
        <div className="row gap-s wrap">
          {canShell && <button className="btn sm" onClick={() => void dock.openTerminal({ objectId: o.id })}><SquareTerminal size={14} />{o.kind === 'server' ? t('dock.here') : t('dock.shell')}</button>}
          <button className="btn sm" onClick={() => dock.openLogs(o.id, o.name)}><FileText size={14} />{t('dock.logs')}</button>
        </div>
        <div><div className="eyebrow" style={{ marginBottom: 6 }}>{t('obj.logs')}</div><LogView id={o.id} /></div>
      </>)}
      {o.kind !== 'http' && <div className="obj-managers">
        <div className="eyebrow" style={{ marginBottom: 6 }}>{t('obj.managers')}</div>
        {managers.length ? <div className="row gap-s wrap">{managers.map((a) => <Link key={a.id} href={`/agents/${a.id}`} className="chip" title={a.permission === 'plan' ? t('obj.managers.readonly') : undefined}>{a.name}{a.permission === 'plan' ? ` · ${t('obj.managers.ro')}` : ''}</Link>)}</div>
          : <p className="muted small" style={{ margin: 0 }}>{t('obj.managers.none')}</p>}
        <button className="btn sm" style={{ marginTop: 8 }} onClick={onCreateManager}><UserPlus size={14} />{t('obj.managers.create')}</button>
      </div>}
    </aside>
  );
}
