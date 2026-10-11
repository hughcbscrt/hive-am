'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, Hammer, Info, MoreHorizontal, Play, RefreshCcw, RotateCw, Square } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { useHive } from '@/lib/store';
import type { ClusterConfig, DockerConfig, ObjectView } from '@/lib/types';
import { useToast } from '@/components/ui';
import { KIND, STATUS_TONE, detailText } from './meta';
import { StatusDot } from './ObjectPanel';
import { ObjectSwitcher } from './ObjectSwitcher';
import { ObjectSummary } from './ObjectSummary';
import { ObjectConfig } from './ObjectConfig';
import { LogPane } from './LogPane';
import { Menu, MenuItem } from '@/components/Menu';
import { ServiceDetail } from './ServiceDetail';
import { TerminalButton } from '@/components/dock/TerminalButton';
import { HttpWorkspace } from './HttpWorkspace';
import { HttpVars } from './HttpVars';

type Tab = 'summary' | 'logs' | 'config' | 'requests' | 'history' | 'vars';
const tabsOf = (o: ObjectView): Tab[] => (o.kind === 'http' ? ['requests', 'history', 'vars', 'config'] : ['summary', 'logs', 'config']);

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
  const tabs = tabsOf(o);
  const [tab, setTab] = useState<Tab>(tabs[0]);
  const [logFilter, setLogFilter] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // `?tab=config` opens that tab (the colony map links to the settings).
  useEffect(() => { const w = new URLSearchParams(window.location.search).get('tab') as Tab | null; if (w && tabs.includes(w)) setTab(w); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const { icon: Icon, color } = KIND[o.kind];
  const st = o.state.status, live = st === 'running' || st === 'starting';
  const act = async (action: 'start' | 'stop' | 'restart' | 'recreate' | 'rebuild') => {
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
            {o.state.detail && <span className="muted small">· {detailText(t, o.state.detail)}</span>}
          </div>
        </div>
        {o.kind !== 'http' && (<>
          <button className="btn primary sm" disabled={!!busy || (cluster ? st === 'running' : live)} onClick={() => void act('start')}><Play size={14} />{t(cluster ? 'obj.act.startAll' : 'obj.act.start')}</button>
          <button className="btn sm" disabled={!!busy || (!live && st !== 'error')} onClick={() => void act('stop')}><Square size={14} />{t(cluster ? 'obj.act.stopAll' : 'obj.act.stop')}</button>
          <button className="btn sm" disabled={!!busy} onClick={() => void act('restart')}><RotateCw size={14} />{t(cluster ? 'obj.act.restartAll' : 'obj.act.restart')}</button>
        </>)}
        {o.kind === 'docker' && (o.config as DockerConfig).mode !== 'existing' && (
          <Menu label={t('svc.more')} icon={<MoreHorizontal size={14} />}>{(close) => (<>
            {(o.config as DockerConfig).mode === 'container' && <MenuItem onClick={() => { close(); setInspecting(true); }}><span className="row gap-s"><Info size={14} />{t('svc.inspect')}</span></MenuItem>}
            <MenuItem onClick={() => { close(); void act('recreate'); }}><span className="row gap-s" title={t('svc.recreate.hint')}><RefreshCcw size={14} />{t('obj.act.recreate')}</span></MenuItem>
            {(o.config as DockerConfig).mode === 'compose' && <MenuItem onClick={() => { close(); void act('rebuild'); }}><span className="row gap-s" title={t('svc.rebuild.hint')}><Hammer size={14} />{t('obj.act.rebuild')}</span></MenuItem>}
          </>)}</Menu>
        )}
        {canShell && <TerminalButton spec={{ objectId: o.id }} title={o.kind === 'server' ? t('dock.here') : t('dock.shell')} />}
      </header>
      <div className="tabs ow-tabs" role="tablist">
        {tabs.map((x) => <button key={x} className="tab" role="tab" aria-selected={tab === x} onClick={() => { if (x === 'logs') setLogFilter(''); setTab(x); }}>{t(`ow.tab.${x}`)}</button>)}
      </div>
      <div className={`ow-body ${tab === 'logs' || tab === 'requests' || tab === 'history' ? 'full' : ''}`}>
        {tab === 'summary' && <ObjectSummary object={o} onSeeLogs={(filter) => { setLogFilter(filter ?? ''); setTab('logs'); }} />}
        {tab === 'logs' && <LogPane key={logFilter} id={o.id} members={cluster ? memberNames : undefined} initialFilter={logFilter || undefined} />}
        {tab === 'config' && <ObjectConfig object={o} />}
        {(tab === 'requests' || tab === 'history') && <HttpWorkspace object={o} pane={tab} onOpenVars={() => setTab('vars')} onGoRequests={() => setTab('requests')} />}
        {tab === 'vars' && <HttpVars object={o} />}
      </div>
      {inspecting && <ServiceDetail objectId={o.id} title={o.name} onClose={() => setInspecting(false)} />}
    </section>
  );
}
