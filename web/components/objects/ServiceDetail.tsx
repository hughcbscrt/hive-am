'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { Eye, EyeOff, SquareTerminal } from 'lucide-react';
import { api } from '@/lib/api';
import { useDock } from '@/lib/dock';
import { useI18n } from '@/lib/i18n/index';
import { fmtDateTime } from '@/lib/format';
import type { DockerConfigured, DockerInspect } from '@/lib/types';
import { Banner, Modal, TabPanel, Tabs } from '@/components/ui';
import { DockerRaw } from './DockerRaw';
import { NO_VALUE } from '@/lib/meta';

const SECRET = /pass|secret|token|api[_-]?key|auth|credential|private/i;
const MASK = '••••••••';
/** Labels in the order a person looks for them: the ones hive-am puts, the ones compose puts, then the rest. */
const LABEL_GROUPS = [{ id: 'hive', test: (k: string) => k.startsWith('hive-am.') }, { id: 'compose', test: (k: string) => k.startsWith('com.docker.compose.') }, { id: 'other', test: () => true }] as const;

/** What Docker says about a container (or one service of a compose project), next to what hive-am has configured for it. */
export function ServiceDetail({ objectId, service, title, onClose }: { objectId: string; service?: string; title: string; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose} wide>
      <InspectView objectId={objectId} service={service} onShell={onClose} />
    </Modal>
  );
}

/**
 * The content of Inspect without its window: what is configured in hive-am (always), and what Docker says when it has the container,
 * or why it does not (not created yet, not found, a service never started, Docker not available).
 */
export function InspectView({ objectId, service, onShell }: { objectId: string; service?: string; onShell?: () => void }) {
  const { t } = useI18n();
  const dock = useDock();
  const [d, setD] = useState<DockerInspect | null>(null);
  const [err, setErr] = useState('');
  const [peek, setPeek] = useState(false);
  const [view, setView] = useState<'summary' | 'raw'>('summary');
  useEffect(() => { api.get<DockerInspect>(`/objects/${objectId}/inspect${service ? `?service=${encodeURIComponent(service)}` : ''}`).then(setD).catch((e) => setErr(e instanceof Error ? e.message : 'error')); }, [objectId, service]);
  const when = (iso: string) => (iso && !iso.startsWith('0001') ? fmtDateTime(Date.parse(iso)) : NO_VALUE);
  const value = (name: string, v: string) => (SECRET.test(name) && !peek ? MASK : v);
  const revealBtn = <button className="btn ghost sm" onClick={() => setPeek((p) => !p)}>{peek ? <EyeOff size={14} /> : <Eye size={14} />}{t('iv.reveal')}</button>;
  if (err) return <p className="gx-note err res-m0">{err}</p>;
  if (!d) return <p className="gx-note">{t('git.loading')}</p>;
  const labels = d.exists ? Object.entries(d.labels).sort(([a], [b]) => a.localeCompare(b)) : [];
  const q = service ? `?service=${encodeURIComponent(service)}` : '';
  const summary = (<div className="ins-body">
    {d.exists && d.cfgStale && <Banner kind="warn">{t('ins.stale')}</Banner>}
    {!d.exists && <Banner kind={d.reason === 'no-docker' ? 'warn' : 'info'}>
      {t(`ins.absent.${d.reason}`)}{d.error && <span className="muted small mono"> · {d.error}</span>}
    </Banner>}
    <Configured c={d.configured} value={value} reveal={revealBtn} />
    {d.exists && (<section className="sd-pane">
      <div className="row gap-s"><h4 className="sd-pane-title grow">{t('ins.docker')}</h4><span className="muted small mono">{d.name} · {d.id}</span>
        {d.status === 'running' && <button className="btn sm" onClick={() => { void dock.openTerminal({ objectId, service }); onShell?.(); }}><SquareTerminal size={14} />{t('svc.shell')}</button>}</div>
      <section className="sd-sec"><div className="eyebrow">{t('svc.d.general')}</div>
        <dl className="sd-kv">
          <dt>{t('ow.d.image')}</dt><dd className="mono">{d.image}</dd><dt>{t('svc.col.status')}</dt><dd>{d.status}</dd>
          <dt>{t('ow.d.created')}</dt><dd>{when(d.created)}</dd><dt>{t('svc.d.started')}</dt><dd>{when(d.started)}</dd>
          <dt>{t('ow.d.restart')}</dt><dd>{d.restartPolicy}{d.restarts ? ` · ${t('ow.d.restarts')}: ${d.restarts}` : ''}</dd>
          {d.entrypoint && <><dt>{t('ow.d.entrypoint')}</dt><dd className="mono">{d.entrypoint}</dd></>}{d.command && <><dt>{t('ow.d.command')}</dt><dd className="mono">{d.command}</dd></>}
          {d.workdir && <><dt>{t('svc.d.workdir')}</dt><dd className="mono">{d.workdir}</dd></>}{d.user && <><dt>{t('svc.d.user')}</dt><dd className="mono">{d.user}</dd></>}
        </dl></section>
      {d.health && <section className="sd-sec"><div className="eyebrow">{t('ow.d.health')} · {d.health.status}</div>
        {d.health.log.length === 0 ? <p className="muted small res-m0">{t('ow.d.none')}</p> : <table className="sd-table"><tbody>{d.health.log.map((l, i) => <tr key={i}><td className="mono">{l.exit}</td><td className="muted">{when(l.at)}</td><td className="mono">{l.output.trim()}</td></tr>)}</tbody></table>}</section>}
      <section className="sd-sec"><div className="row gap-s"><div className="eyebrow grow">{t('of.env')} · {d.env.length}</div>{revealBtn}</div>
        {d.env.length === 0 ? <p className="muted small res-m0">{t('ow.d.none')}</p> : <table className="sd-table"><tbody>{d.env.map((e) => <tr key={e.name}><td className="mono"><b>{e.name}</b></td><td className="mono">{value(e.name, e.value)}</td></tr>)}</tbody></table>}</section>
      <section className="sd-sec"><div className="eyebrow">{t('ow.d.ports')}</div>
        {d.ports.length === 0 ? <p className="muted small res-m0">{t('ow.d.none')}</p> : <table className="sd-table"><tbody>{d.ports.map((p, i) => <tr key={i}><td className="mono">{p.container}</td><td className="mono">{p.host ? <a href={`http://localhost:${p.host}`} target="_blank" rel="noreferrer">localhost:{p.host}</a> : <span className="muted">{t('svc.d.unpublished')}</span>}</td></tr>)}</tbody></table>}</section>
      <section className="sd-sec"><div className="eyebrow">{t('svc.d.mounts')} · {d.mounts.length}</div>
        {d.mounts.length === 0 ? <p className="muted small res-m0">{t('ow.d.none')}</p> : <table className="sd-table"><thead><tr><th>{t('svc.d.source')}</th><th>{t('svc.d.dest')}</th><th /></tr></thead><tbody>{d.mounts.map((m, i) => <tr key={i}><td className="mono">{m.source}</td><td className="mono">{m.destination}</td><td className="muted">{m.type}{m.rw ? '' : ' · ro'}</td></tr>)}</tbody></table>}</section>
      <section className="sd-sec"><div className="eyebrow">{t('ow.d.network')} · {d.networks.length}</div>
        {d.networks.length === 0 ? <p className="muted small res-m0">{t('ow.d.none')}</p> : <table className="sd-table"><thead><tr><th>{t('obj.f.name')}</th><th>IP</th><th>{t('ow.d.gateway')}</th><th>{t('ow.d.aliases')}</th></tr></thead><tbody>{d.networks.map((n) => <tr key={n.name}><td className="mono">{n.name}</td><td className="mono">{n.ip}</td><td className="mono">{n.gateway}</td><td className="mono">{n.aliases.join(', ')}</td></tr>)}</tbody></table>}</section>
      <section className="sd-sec"><div className="eyebrow">{t('ins.labels')} · {labels.length}</div>
        {labels.length === 0 ? <p className="muted small res-m0">{t('ow.d.none')}</p> : <table className="sd-table"><tbody>{LABEL_GROUPS.flatMap((g, gi) => {
          const rows = labels.filter(([k]) => g.test(k) && !LABEL_GROUPS.slice(0, gi).some((p) => p.test(k)));
          return rows.length ? [<tr key={g.id} className="sd-group"><th colSpan={2}>{t(`ins.labels.${g.id}`)}</th></tr>, ...rows.map(([k, v]) => <tr key={k}><td className="mono">{k}</td><td className="mono">{v || NO_VALUE}</td></tr>)] : [];
        })}</tbody></table>}</section>
    </section>)}
  </div>);
  // The raw JSON only exists when Docker has the container; otherwise there is only the summary, without tabs.
  if (!d.exists) return summary;
  return (<>
    <Tabs idPrefix="ins" variant="pill" label={t('raw.tabs')} value={view} onChange={(x) => setView(x as 'summary' | 'raw')} tabs={[{ id: 'summary', label: t('raw.tab.summary') }, { id: 'raw', label: t('raw.tab.raw') }]} />
    <TabPanel id="summary" value={view} idPrefix="ins">{summary}</TabPanel>
    <TabPanel id="raw" value={view} idPrefix="ins"><DockerRaw src={`/objects/${objectId}/inspect/raw${q}`} /></TabPanel>
  </>);
}

/** What hive-am has for it: the settings of a container it creates, the name of an existing one, or the service as the compose file says. */
function Configured({ c, value, reveal }: { c: DockerConfigured; value: (name: string, v: string) => string; reveal: ReactNode }) {
  const { t } = useI18n();
  const list = (xs: string[]) => (xs.length ? xs.join(', ') : NO_VALUE);
  const limits = [c.memory && `${t('obj.dk.memory')} ${c.memory}`, c.cpus && `${t('obj.dk.cpus')} ${c.cpus}`, c.logMaxMb && `${t('obj.sup.logMax')} ${c.logMaxMb}`, c.stopTimeoutSec && `${t('obj.sup.stopTimeout')} ${c.stopTimeoutSec}`].filter(Boolean);
  return (
    <section className="sd-pane">
      <h4 className="sd-pane-title">{t('ins.configured')}</h4>
      {c.error && <p className="gx-note err res-m0">{t('ins.configured.unread', { error: c.error })}</p>}
      <dl className="sd-kv">
        <dt>{t('obj.f.name')}</dt><dd className="mono">{c.name}</dd>
        {c.image && <><dt>{t('obj.f.image')}</dt><dd className="mono">{c.image}</dd></>}
        {(c.image || c.ports.length > 0) && <><dt>{t('obj.f.ports')}</dt><dd className="mono">{list(c.ports)}</dd></>}
        {(c.image || c.volumes.length > 0) && <><dt>{t('obj.f.volumes')}</dt><dd className="mono">{list(c.volumes)}</dd></>}
        {(c.image || c.networks.length > 0) && <><dt>{t('obj.dk.network')}</dt><dd className="mono">{list(c.networks)}</dd></>}
        {c.restart && <><dt>{t('obj.f.restart')}</dt><dd className="mono">{c.restart}</dd></>}
        {c.command && <><dt>{t('ow.d.command')}</dt><dd className="mono">{c.command}</dd></>}
        {limits.length > 0 && <><dt>{t('of.limits')}</dt><dd>{limits.join(' · ')}</dd></>}
      </dl>
      {c.env.length > 0 && (<section className="sd-sec"><div className="row gap-s"><div className="eyebrow grow">{t('of.env')} · {c.env.length}</div>{reveal}</div>
        <table className="sd-table"><tbody>{c.env.map((e) => <tr key={e.name}><td className="mono"><b>{e.name}</b></td><td className="mono">{value(e.name, e.value)}</td></tr>)}</tbody></table></section>)}
    </section>
  );
}
