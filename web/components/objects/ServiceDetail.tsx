'use client';
import { useEffect, useState } from 'react';
import { Eye, EyeOff, SquareTerminal } from 'lucide-react';
import { api } from '@/lib/api';
import { useDock } from '@/lib/dock';
import { useI18n } from '@/lib/i18n/index';
import { fmtDateTime } from '@/lib/format';
import type { DockerInspect } from '@/lib/types';
import { Modal } from '@/components/ui';
import { NO_VALUE } from '@/lib/meta';

const SECRET = /pass|secret|token|api[_-]?key|auth|credential|private/i;

/** What Docker says about a container (or one service of a compose project): how it runs, its variables, ports, mounts, networks and health. */
export function ServiceDetail({ objectId, service, title, onClose }: { objectId: string; service?: string; title: string; onClose: () => void }) {
  const { t } = useI18n();
  const dock = useDock();
  const [d, setD] = useState<DockerInspect | null>(null);
  const [err, setErr] = useState('');
  const [peek, setPeek] = useState(false);
  useEffect(() => { api.get<DockerInspect>(`/objects/${objectId}/inspect${service ? `?service=${encodeURIComponent(service)}` : ''}`).then(setD).catch((e) => setErr(e instanceof Error ? e.message : 'error')); }, [objectId, service]);
  const when = (iso: string) => (iso && !iso.startsWith('0001') ? fmtDateTime(Date.parse(iso)) : NO_VALUE);
  return (
    <Modal title={title} onClose={onClose} wide>
      {err ? <p className="gx-note err res-m0">{err}</p> : !d ? <p className="gx-note">{t('git.loading')}</p> : (<>
        <div className="row gap-s"><span className="muted small grow mono">{d.name} · {d.id}</span>
          {d.status === 'running' && <button className="btn sm" onClick={() => { void dock.openTerminal({ objectId, service }); onClose(); }}><SquareTerminal size={14} />{t('svc.shell')}</button>}</div>
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
        <section className="sd-sec"><div className="row gap-s"><div className="eyebrow grow">{t('of.env')} · {d.env.length}</div>
          <button className="btn ghost sm" onClick={() => setPeek((p) => !p)}>{peek ? <EyeOff size={14} /> : <Eye size={14} />}{t('iv.reveal')}</button></div>
          {d.env.length === 0 ? <p className="muted small res-m0">{t('ow.d.none')}</p> : <table className="sd-table"><tbody>{d.env.map((e) => <tr key={e.name}><td className="mono"><b>{e.name}</b></td><td className="mono">{SECRET.test(e.name) && !peek ? '••••••••' : e.value}</td></tr>)}</tbody></table>}</section>
        <section className="sd-sec"><div className="eyebrow">{t('ow.d.ports')}</div>
          {d.ports.length === 0 ? <p className="muted small res-m0">{t('ow.d.none')}</p> : <table className="sd-table"><tbody>{d.ports.map((p, i) => <tr key={i}><td className="mono">{p.container}</td><td className="mono">{p.host ? <a href={`http://localhost:${p.host}`} target="_blank" rel="noreferrer">localhost:{p.host}</a> : <span className="muted">{t('svc.d.unpublished')}</span>}</td></tr>)}</tbody></table>}</section>
        <section className="sd-sec"><div className="eyebrow">{t('svc.d.mounts')} · {d.mounts.length}</div>
          {d.mounts.length === 0 ? <p className="muted small res-m0">{t('ow.d.none')}</p> : <table className="sd-table"><thead><tr><th>{t('svc.d.source')}</th><th>{t('svc.d.dest')}</th><th /></tr></thead><tbody>{d.mounts.map((m, i) => <tr key={i}><td className="mono">{m.source}</td><td className="mono">{m.destination}</td><td className="muted">{m.type}{m.rw ? '' : ' · ro'}</td></tr>)}</tbody></table>}</section>
        <section className="sd-sec"><div className="eyebrow">{t('ow.d.network')} · {d.networks.length}</div>
          {d.networks.length === 0 ? <p className="muted small res-m0">{t('ow.d.none')}</p> : <table className="sd-table"><thead><tr><th>{t('obj.f.name')}</th><th>IP</th><th>{t('ow.d.gateway')}</th><th>{t('ow.d.aliases')}</th></tr></thead><tbody>{d.networks.map((n) => <tr key={n.name}><td className="mono">{n.name}</td><td className="mono">{n.ip}</td><td className="mono">{n.gateway}</td><td className="mono">{n.aliases.join(', ')}</td></tr>)}</tbody></table>}</section>
      </>)}
    </Modal>
  );
}
