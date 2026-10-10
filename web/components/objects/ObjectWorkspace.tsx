'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, Play, RotateCw, Square, SquareTerminal } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { useHive } from '@/lib/store';
import { useDock } from '@/lib/dock';
import type { ClusterConfig, DockerConfig, ObjectView } from '@/lib/types';
import { useToast } from '@/components/ui';
import { KIND, STATUS_TONE } from './meta';
import { StatusDot } from './ObjectPanel';
import { ObjectSwitcher } from './ObjectSwitcher';
import { ObjectSummary } from './ObjectSummary';
import { ObjectConfig } from './ObjectConfig';
import { LogPane } from './LogPane';
import { HttpWorkspace } from './HttpWorkspace';
import { HttpVars } from './HttpVars';

type Tab = 'summary' | 'logs' | 'config' | 'requests' | 'vars';
const tabsOf = (o: ObjectView): Tab[] => (o.kind === 'http' ? ['requests', 'vars', 'config'] : ['summary', 'logs', 'config']);

/** One object on a whole screen, like an agent: the list at the left, and its tabs (summary, logs, settings — or requests and variables). */
export function ObjectWorkspace({ id }: { id?: string }) {
  const { t } = useI18n();
  const { objects, ready, objects: all } = useHive();
  const o = id ? objects.find((x) => x.id === id) : undefined;
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { try { setCollapsed(localStorage.getItem('hive-obj-switcher-collapsed') === '1'); } catch { /* none */ } }, []);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem('hive-obj-switcher-collapsed', c ? '0' : '1'); } catch { /* none */ } return !c; });

  return (
    <div className={`ws ${collapsed ? 'sw-collapsed' : ''}`}>
      <ObjectSwitcher activeId={id} collapsed={collapsed} onToggle={toggle} />
      {!id ? (
        <section className="ws-chat"><div className="empty" style={{ margin: 40 }}><h3>{all.length ? t('ow.pick') : t('ow.empty.title')}</h3>{!all.length && <p>{t('ow.empty.body')}</p>}</div></section>
      ) : !o ? (
        <section className="ws-chat"><div className="empty" style={{ margin: 40 }}>{ready ? <h3>{t('ow.gone')}</h3> : <p>{t('git.loading')}</p>}</div></section>
      ) : <Screen key={o.id} object={o} />}
    </div>
  );
}

function Screen({ object: o }: { object: ObjectView }) {
  const { t } = useI18n();
  const toast = useToast();
  const dock = useDock();
  const tabs = tabsOf(o);
  const [tab, setTab] = useState<Tab>(tabs[0]);
  const [busy, setBusy] = useState<string | null>(null);
  // `?tab=config` opens that tab (the colony map links to the settings).
  useEffect(() => { const w = new URLSearchParams(window.location.search).get('tab') as Tab | null; if (w && tabs.includes(w)) setTab(w); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const { icon: Icon, color } = KIND[o.kind];
  const st = o.state.status, live = st === 'running' || st === 'starting';
  const act = async (action: 'start' | 'stop' | 'restart') => {
    setBusy(action);
    try { await api.post(`/objects/${o.id}/action`, { action }); }
    catch (e) { toast(`${t('obj.act.failed', { action: t(`obj.act.${action}`) })}: ${e instanceof Error ? e.message : ''}`, 'err'); } finally { setBusy(null); }
  };
  const cluster = o.kind === 'cluster';
  const members = cluster ? (o.config as ClusterConfig).members : [];
  const { objects } = useHive();
  const memberNames = members.map((id) => objects.find((x) => x.id === id)?.name ?? '').filter(Boolean);
  const canShell = o.kind === 'server' || (o.kind === 'docker' && (o.config as DockerConfig).mode !== 'compose');

  return (
    <section className="ws-chat">
      <header className="ws-head">
        <Link href="/" className="btn ghost icon" aria-label={t('ow.back')} title={t('ow.back')}><ArrowLeft size={18} /></Link>
        <span className="obj-ico" style={{ ['--c' as never]: color }}><Icon size={22} /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <h1 style={{ overflowWrap: 'anywhere' }}>{o.name}</h1>
          <div className="row gap-s wrap" style={{ marginTop: 3 }}>
            <span className={`ostatus ${STATUS_TONE[st]}`}><StatusDot status={st} />{t(`obj.status.${st}`)}</span>
            <span className="muted small">{t(`obj.kind.${o.kind}`)}</span>
            {o.state.detail && <span className="muted small">· {o.state.detail}</span>}
          </div>
        </div>
        {o.kind !== 'http' && (<>
          <button className="btn primary sm" disabled={!!busy || (cluster ? st === 'running' : live)} onClick={() => void act('start')}><Play size={14} />{t(cluster ? 'obj.act.startAll' : 'obj.act.start')}</button>
          <button className="btn sm" disabled={!!busy || (!live && st !== 'error')} onClick={() => void act('stop')}><Square size={14} />{t(cluster ? 'obj.act.stopAll' : 'obj.act.stop')}</button>
          <button className="btn sm" disabled={!!busy} onClick={() => void act('restart')}><RotateCw size={14} />{t(cluster ? 'obj.act.restartAll' : 'obj.act.restart')}</button>
        </>)}
        {canShell && <button className="btn sm" onClick={() => void dock.openTerminal({ objectId: o.id })} aria-label={o.kind === 'server' ? t('dock.here') : t('dock.shell')} title={o.kind === 'server' ? t('dock.here') : t('dock.shell')}><SquareTerminal size={14} /></button>}
      </header>
      <div className="tabs ow-tabs" role="tablist">
        {tabs.map((x) => <button key={x} className="tab" role="tab" aria-selected={tab === x} onClick={() => setTab(x)}>{t(`ow.tab.${x}`)}</button>)}
      </div>
      <div className={`ow-body ${tab === 'logs' || tab === 'requests' ? 'full' : ''}`}>
        {tab === 'summary' && <ObjectSummary object={o} onSeeLogs={() => setTab('logs')} />}
        {tab === 'logs' && <LogPane id={o.id} members={cluster ? memberNames : undefined} />}
        {tab === 'config' && <ObjectConfig object={o} />}
        {tab === 'requests' && <HttpWorkspace object={o} onOpenVars={() => setTab('vars')} />}
        {tab === 'vars' && <HttpVars object={o} />}
      </div>
    </section>
  );
}
