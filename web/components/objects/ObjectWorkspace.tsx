'use client';
import { useEffect, useLayoutEffect, useState } from 'react';
import { Hammer, Info, Loader2, Play, PlugZap, RefreshCcw, RotateCw, Square } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { useHive } from '@/lib/store';
import type { ClusterConfig, DatabaseConfig, DockerConfig, ObjectView } from '@/lib/types';
import { Banner, ConfirmDialog, EmptyState, TabPanel, Tabs, WorkspaceHeader, useToast, type HeaderAction } from '@/components/ui';
import { useQueryState } from '@/lib/hooks/useQueryState';
import { KIND, STATUS_TONE, detailText } from './meta';
import { StatusDot } from './ObjectPanel';
import { ObjectSwitcher } from './ObjectSwitcher';
import { ObjectSummary } from './ObjectSummary';
import { ObjectConfig } from './ObjectConfig';
import { LogPane } from './LogPane';
import { ServiceDetail } from './ServiceDetail';
import { TerminalButton } from '@/components/dock/TerminalButton';
import { HttpWorkspace } from './HttpWorkspace';
import { HttpVars } from './HttpVars';
import { DbWorkspace } from './DbWorkspace';
import { FileEditor } from './FileEditor';
import { copyCompose, readCompose, saveCompose } from '@/lib/dockerFiles';

type Tab = 'summary' | 'logs' | 'file' | 'config' | 'requests' | 'history' | 'vars' | 'query' | 'schema';
// Only a compose resource has a file of its own to edit (an existing container has none).
const tabsOf = (o: ObjectView): Tab[] => (o.kind === 'http' ? ['requests', 'history', 'vars', 'config'] : o.kind === 'database' ? ['query', 'schema', 'history', 'config']
  : o.kind === 'docker' && (o.config as DockerConfig).mode === 'compose' ? ['summary', 'logs', 'file', 'config'] : ['summary', 'logs', 'config']);

/** One object on a whole screen, like an agent: the list at the left, and its tabs (summary, logs, settings, or requests and variables). */
export function ObjectWorkspace({ id }: { id?: string }) {
  const { t } = useI18n();
  const { objects, ready, objects: all, error, retry } = useHive();
  const o = id ? objects.find((x) => x.id === id) : undefined;
  const [collapsed, setCollapsed] = useState(false);
  useLayoutEffect(() => { try { setCollapsed(localStorage.getItem('hive-obj-switcher-collapsed') === '1'); } catch { /* none */ } }, []);
  const [animate, setAnimate] = useState(false);
  const toggle = () => { setAnimate(true); setCollapsed((c) => { try { localStorage.setItem('hive-obj-switcher-collapsed', c ? '0' : '1'); } catch { /* none */ } return !c; }); };

  return (
    <div className={`ws ${collapsed ? 'sw-collapsed' : ''} ${animate ? 'sw-anim' : ''}`}>
      <ObjectSwitcher activeId={id} collapsed={collapsed} onToggle={toggle} />
      {!ready && error ? (
        <section className="ws-chat"><div className="ow-pad"><Banner kind="err">
          <div className="row gap-s wrap"><span className="grow">{error}</span><button className="btn sm" onClick={() => void retry()}>{t('rs.retry')}</button></div>
        </Banner></div></section>
      ) : !id && !ready ? (
        <section className="ws-chat" />
      ) : !id ? (
        <section className="ws-chat"><div className="ow-pad"><EmptyState title={all.length ? t('ow.pick') : t('ow.empty.title')} body={!all.length ? t('ow.empty.body') : undefined} /></div></section>
      ) : !o ? (
        <section className="ws-chat"><div className="ow-pad">{ready ? <EmptyState title={t('ow.gone')} /> : <EmptyState title={t('git.loading')} />}</div></section>
      ) : <Screen key={o.id} object={o} />}
    </div>
  );
}

function Screen({ object: o }: { object: ObjectView }) {
  const { t } = useI18n();
  const toast = useToast();
  const tabs = tabsOf(o);
  // The tab lives in the URL (`?tab=config`: the colony map links to the settings); an unknown one falls back to the first.
  const [rawTab, setTab] = useQueryState('tab', tabs[0]);
  const tab = (tabs as string[]).includes(rawTab) ? (rawTab as Tab) : tabs[0];
  const [logFilter, setLogFilter] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const [recreating, setRecreating] = useState(false);
  // Unsaved edits of the File tab: leaving it for another tab asks first.
  const [fileDirty, setFileDirty] = useState(false);
  const [leaving, setLeaving] = useState<Tab | null>(null);
  const go = (x: Tab) => { if (x === 'logs') setLogFilter(''); setTab(x); };
  const [busy, setBusy] = useState<string | null>(null);
  const { icon: Icon, color } = KIND[o.kind];
  const st = o.state.status, live = st === 'running' || st === 'starting';
  const act = async (action: 'start' | 'stop' | 'restart' | 'recreate' | 'rebuild') => {
    setBusy(action);
    try { await api.post(`/objects/${o.id}/action`, { action }); }
    catch (e) { toast(`${t('obj.act.failed', { action: t(`obj.act.${action}`) })}: ${e instanceof Error ? e.message : ''}`, 'err'); } finally { setBusy(null); }
  };
  // A database is not started: this asks it for its state again right away (the list refreshes it every few seconds on its own).
  const testDb = async () => {
    setBusy('test');
    try { const r = await api.post<{ version: string; ms: number }>('/object-db/test', { id: o.id, config: o.config }); toast(`${t('db.test.ok')} · ${r.version} · ${r.ms} ms`); }
    catch (e) { toast(e instanceof Error ? e.message : '', 'err'); } finally { setBusy(null); }
  };
  const cluster = o.kind === 'cluster';
  const members = cluster ? (o.config as ClusterConfig).members : [];
  const { objects } = useHive();
  const memberNames = members.map((id) => objects.find((x) => x.id === id)?.name ?? '').filter(Boolean);
  const canShell = o.kind === 'server' || (o.kind === 'docker' && (o.config as DockerConfig).mode !== 'compose');

  const docker = o.kind === 'docker' ? (o.config as DockerConfig) : null;
  const actions: HeaderAction[] = [];
  if (o.kind !== 'http' && o.kind !== 'database') {
    actions.push({ id: 'stop', label: t(cluster ? 'obj.act.stopAll' : 'obj.act.stop'), icon: <Square size={14} />, disabled: !!busy || (!live && st !== 'error'), onClick: () => void act('stop') });
    actions.push({ id: 'restart', label: t(cluster ? 'obj.act.restartAll' : 'obj.act.restart'), icon: <RotateCw size={14} />, disabled: !!busy, onClick: () => void act('restart') });
  }
  if (docker && docker.mode !== 'compose') actions.push({ id: 'inspect', label: t('svc.inspect'), icon: <Info size={14} />, onClick: () => setInspecting(true) });
  if (docker && docker.mode !== 'existing') actions.push({ id: 'recreate', label: t('obj.act.recreate'), icon: <RefreshCcw size={14} />, danger: true, hint: t('svc.recreate.hint'), disabled: !!busy, onClick: () => setRecreating(true) });
  if (docker && docker.mode === 'compose') actions.push({ id: 'rebuild', label: t('obj.act.rebuild'), icon: <Hammer size={14} />, hint: t('svc.rebuild.hint'), disabled: !!busy, onClick: () => void act('rebuild') });
  const primary = (<>
    {o.kind === 'database' && (
      <button className="btn sm" disabled={!!busy} onClick={() => void testDb()}>{busy === 'test' ? <Loader2 size={14} className="spin" /> : <PlugZap size={14} />}{t('db.test')}</button>
    )}
    {o.kind !== 'http' && o.kind !== 'database' && (
      <button className="btn primary sm" disabled={!!busy || (cluster ? st === 'running' : live)} onClick={() => void act('start')}><Play size={14} />{t(cluster ? 'obj.act.startAll' : 'obj.act.start')}</button>
    )}
    {canShell && <TerminalButton spec={{ objectId: o.id }} title={o.kind === 'server' ? t('dock.here') : t('dock.shell')} />}
  </>);

  return (
    <section className="ws-chat">
      <WorkspaceHeader
        back={{ href: '/colony', label: t('ow.back') }}
        avatar={<span className="obj-ico" style={{ ['--c' as never]: color }}><Icon size={22} /></span>}
        title={o.name}
        meta={<>
          <span className={`ostatus ${STATUS_TONE[st]}`}><StatusDot status={st} />{t(`obj.status.${st}`)}</span>
          <span>{t(`obj.kind.${o.kind}`)}</span>
          {o.state.detail && <span>{detailText(t, o.state.detail)}</span>}
        </>}
        primary={primary}
        actions={actions}
      />
      <Tabs idPrefix="ow" label={t('rs.tabs')} value={tab} onChange={(x) => { if (tab === 'file' && fileDirty && x !== 'file') setLeaving(x as Tab); else go(x as Tab); }} tabs={tabs.map((x) => ({ id: x, label: t(`ow.tab.${x}`) }))} />
      <div className={`ow-body ${tab === 'logs' || tab === 'file' || tab === 'requests' || tab === 'history' || tab === 'query' || tab === 'schema' ? 'full' : ''}`}>
        <TabPanel id={tab} value={tab} idPrefix="ow">
          {tab === 'summary' && <ObjectSummary object={o} onSeeLogs={(filter) => { setLogFilter(filter ?? ''); setTab('logs'); }} />}
          {tab === 'logs' && <LogPane key={logFilter} id={o.id} members={cluster ? memberNames : undefined} initialFilter={logFilter || undefined} />}
          {tab === 'file' && docker?.mode === 'compose' && (
            <FileEditor key={docker.file} kind="compose" load={() => readCompose(o.id)} save={(content, etag) => saveCompose(o.id, content, etag)} copy={(p) => copyCompose(o.id, p)}
              repointOption onRecreate={() => setRecreating(true)} onDirty={setFileDirty} />
          )}
          {tab === 'config' && <ObjectConfig object={o} />}
          {o.kind === 'database' && (tab === 'query' || tab === 'schema' || tab === 'history') && <DbWorkspace object={o} pane={tab} onPane={setTab} />}
          {o.kind === 'http' && (tab === 'requests' || tab === 'history') && <HttpWorkspace object={o} pane={tab} onOpenVars={() => setTab('vars')} onGoRequests={() => setTab('requests')} />}
          {tab === 'vars' && <HttpVars object={o} />}
        </TabPanel>
      </div>
      {inspecting && <ServiceDetail objectId={o.id} title={o.name} onClose={() => setInspecting(false)} />}
      {leaving && (
        <ConfirmDialog title={t('fe.leave.title')} body={t('fe.leave.body')} confirmLabel={t('common.discard')} danger
          onConfirm={() => { setFileDirty(false); go(leaving); }} onClose={() => setLeaving(null)} />
      )}
      {recreating && (
        <ConfirmDialog title={t('rs.recreate.title', { name: o.name })} body={t('svc.recreate.hint')} confirmLabel={t('obj.act.recreate')} danger
          onConfirm={() => act('recreate')} onClose={() => setRecreating(false)} />
      )}
    </section>
  );
}
