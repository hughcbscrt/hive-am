'use client';
import { TerminalButton } from '@/components/dock/TerminalButton';
import { useState } from 'react';
import Link from 'next/link';
import { Database, ExternalLink, FileText, Loader2, Lock, Pencil, PlugZap, Play, RotateCw, Square, Unlock, UserPlus, Users, X } from 'lucide-react';
import { AnchoredCard } from '@/components/agents/AgentCard';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { ago, shortPath } from '@/lib/meta';
import type { ClusterConfig, DatabaseConfig, DockerConfig, HttpConfig, ObjectView, ServerConfig } from '@/lib/types';
import { useToast } from '@/components/ui';
import { PickSearch } from '@/components/PickSearch';
import { useHive } from '@/lib/store';
import { useDock } from '@/lib/dock';
import { DATABASES_SKILL_ID, OBJECTS_SKILL_ID } from '@/components/agents/NewAgentDrawer';
import { KIND, STATUS_TONE, detailText } from './meta';
import { LogView } from './LogView';

const DB_LABEL = { mysql: 'MySQL / MariaDB', postgresql: 'PostgreSQL', sqlite: 'SQLite', mssql: 'SQL Server' } as const;

export function StatusDot({ status, className = '' }: { status: ObjectView['state']['status']; className?: string }) {
  return <i className={`odot ${STATUS_TONE[status]} ${className}`} aria-hidden />;
}

/** One-line summary of how an object is run. */
export function objectSummary(o: ObjectView): string {
  if (o.kind === 'server') { const c = o.config as ServerConfig; return c.start; }
  if (o.kind === 'http') return shortPath((o.config as HttpConfig).folder);
  if (o.kind === 'database') { const c = o.config as DatabaseConfig; return c.engine === 'sqlite' ? shortPath(c.file ?? '') : `${c.host || '127.0.0.1'}${c.port ? `:${c.port}` : ''}${c.database ? `/${c.database}` : ''}`; }
  if (o.kind === 'cluster') return `${(o.config as ClusterConfig).members.length}`;
  const c = o.config as DockerConfig;
  return c.mode === 'container' ? c.image ?? '' : c.mode === 'compose' ? shortPath(c.file ?? '') : c.container ?? '';
}

/** The panel shown when an object of the colony map is selected: its state, start/stop/restart, and its logs. */
export function ObjectPanel({ object: o, target, onClose, onCreateManager }: { object: ObjectView; target: Element | null; onClose: () => void; onCreateManager: () => void }) {
  const { t } = useI18n();
  const { agents, objects, colonies } = useHive();
  const dock = useDock();
  // A terminal where the server runs, or inside the container (a compose project has several, so it only has logs).
  const canShell = o.kind === 'server' || (o.kind === 'docker' && (o.config as DockerConfig).mode !== 'compose');
  // The agents that can act on it: the ones with the Colony resources skill in the same colony (or, with no colony, among the objects that have none).
  // One chosen manager looks after it alone; with none chosen, the agents of its colony that have the skill do.
  const managers = o.manager_id ? agents.filter((a) => a.id === o.manager_id) : agents.filter((a) => a.skill_ids.includes(o.kind === 'database' ? DATABASES_SKILL_ID : OBJECTS_SKILL_ID) && (a.colony_id ?? null) === (o.colony_id ?? null));
  const [adding, setAdding] = useState(false);
  const { refresh } = useHive();
  const setManager = async (agentId: string | null) => {
    try { await api.put(`/objects/${o.id}/manager`, { agent_id: agentId }); await refresh(['objects', 'agents']); setAdding(false); }
    catch (e) { toast(e instanceof Error ? e.message : '', 'err'); }
  };
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
  const testDb = async () => {
    setBusy('test');
    try { const r = await api.post<{ version: string; ms: number }>('/object-db/test', { id: o.id, config: o.config }); toast(`${t('db.test.ok')} · ${r.version} · ${r.ms} ms`); }
    catch (e) { toast(e instanceof Error ? e.message : '', 'err'); } finally { setBusy(null); }
  };
  const members = o.kind === 'cluster' ? (o.config as ClusterConfig).members.map((id) => objects.find((x) => x.id === id)).filter((x): x is ObjectView => !!x) : [];
  return (
    <AnchoredCard target={target} pinned width={380} label={o.name} onClose={onClose}>
     <div className="col obj-panel res-gap12">
      <div className="ap-corner row gap-s"><Link className="btn ghost icon sm" href={`/resources/${o.id}?tab=config`} aria-label={t('obj.act.edit')} title={t('obj.act.edit')}><Pencil size={15} /></Link><button className="btn ghost icon sm" onClick={onClose} aria-label={t('common.close')} title={`${t('common.close')} (Esc)`}><X size={16} /></button></div>
      <div className="row gap-l res-pr70">
        <span className="obj-ico" style={{ ['--c' as never]: color }}><Icon size={22} /></span>
        <div className="grow res-minw0">
          <h2 className="res-h2">{o.name}</h2>
          <div className="row gap-s wrap res-mt4">
            <span className={`ostatus ${STATUS_TONE[st]}`}><StatusDot status={st} />{t(`obj.status.${st}`)}</span>
            <span className="muted small">{t(`obj.kind.${o.kind}`)}</span>
          </div>
        </div>
      </div>
      {(o.state.detail || o.state.since) && (
        <p className="muted small res-m0">{[detailText(t, o.state.detail), o.state.since && live ? t('obj.since', { time: ago(o.state.since) }) : '', o.state.pid ? t('obj.pid', { pid: o.state.pid }) : ''].filter(Boolean).join(' · ')}</p>
      )}
      <Link className="btn primary" href={`/resources/${o.id}`}><ExternalLink size={15} />{t('obj.open')}</Link>
      {o.kind !== 'cluster' && <div className="mono small obj-cmd" title={objectSummary(o)}>{objectSummary(o)}</div>}
      {o.kind === 'database' && (
        <div className="row gap-s wrap">
          <span className="db-badge"><Database size={12} />{DB_LABEL[(o.config as DatabaseConfig).engine]}</span>
          {(o.config as DatabaseConfig).readOnly !== false ? <span className="db-badge ro"><Lock size={12} />{t('db.readonly.badge')}</span> : <span className="db-badge rw"><Unlock size={12} />{t('db.write.badge')}</span>}
          <button className="btn sm" disabled={!!busy} onClick={() => void testDb()}>{busy === 'test' ? <Loader2 size={14} className="spin" /> : <PlugZap size={14} />}{t('db.test')}</button>
        </div>
      )}
      {o.kind === 'http' || o.kind === 'database' ? null : (<>
        <div className="row gap-s wrap">
          <button className="btn primary sm" disabled={!!busy || (o.kind === 'cluster' ? st === 'running' : live)} onClick={() => void act('start')}><Play size={14} />{t(o.kind === 'cluster' ? 'obj.act.startAll' : 'obj.act.start')}</button>
          <button className="btn sm" disabled={!!busy || (!live && st !== 'error' && !(o.kind === 'cluster' && members.some((m) => m.state.status === 'running')))} onClick={() => void act('stop')}><Square size={14} />{t(o.kind === 'cluster' ? 'obj.act.stopAll' : 'obj.act.stop')}</button>
          <button className="btn sm" disabled={!!busy} onClick={() => void act('restart')}><RotateCw size={14} />{t(o.kind === 'cluster' ? 'obj.act.restartAll' : 'obj.act.restart')}</button>
        </div>
        {o.kind === 'cluster' && (
          <div>
            <div className="eyebrow res-mb6">{t('obj.members')}</div>
            {members.length ? <div className="col res-gap4">{members.map((m, i) => (
              <div key={m.id} className="row gap-s small"><span className="ord">{i + 1}</span><StatusDot status={m.state.status} /><b className="grow ellipsis">{m.name}</b><span className="muted">{t(`obj.status.${m.state.status}`)}</span></div>))}</div>
              : <p className="muted small res-m0">{t('obj.members.empty')}</p>}
          </div>
        )}
        <div className="row gap-s wrap">
          {canShell && <TerminalButton spec={{ objectId: o.id }} label={o.kind === 'server' ? t('dock.here') : t('dock.shell')} />}
          <button className="btn sm" onClick={() => dock.openLogs(o.id, o.name)}><FileText size={14} />{t('dock.logs')}</button>
        </div>
        <div><div className="eyebrow res-mb6">{t('obj.logs')}</div><LogView id={o.id} /></div>
      </>)}
      {o.kind !== 'http' && <div className="obj-managers">
        <div className="eyebrow res-mb6">{t('obj.managers')}</div>
        {managers.length ? <div className="row gap-s wrap">{managers.map((a) => (
          <span key={a.id} className="chip ps-chip"><Link href={`/agents/${a.id}`} title={a.permission === 'plan' ? t(o.kind === 'database' ? 'obj.managers.readonly.db' : 'obj.managers.readonly') : undefined}>{a.name}{a.permission === 'plan' ? ` · ${t('obj.managers.ro')}` : ''}</Link>
            {o.manager_id === a.id && <button type="button" onClick={() => void setManager(null)} aria-label={t('obj.managers.remove')} title={t('obj.managers.remove')}><X size={12} /></button>}</span>))}</div>
          : <p className="muted small res-m0">{t('obj.managers.none')}</p>}
        {o.manager_id && <p className="muted small res-mt6">{t('obj.managers.only')}</p>}
        <div className="row gap-s wrap res-mt8">
          <button className="btn sm" onClick={onCreateManager}><UserPlus size={14} />{t('obj.managers.create')}</button>
          <button className="btn sm" aria-pressed={adding} onClick={() => setAdding((v) => !v)}><Users size={14} />{t('obj.managers.add')}</button>
        </div>
        {adding && <div className="res-mt8"><PickSearch inline autoFocus options={agents.filter((a) => a.id !== o.manager_id).map((a) => ({ id: a.id, label: a.name, hint: colonies.find((c) => c.id === a.colony_id)?.name ?? t('common.noColony') }))} value={[]} onChange={(ids) => ids[0] && void setManager(ids[0])} placeholder={t('obj.manager.placeholder')} empty={t('obj.manager.empty')} ariaLabel={t('obj.managers.add')} /></div>}
      </div>}
     </div>
    </AnchoredCard>
  );
}
