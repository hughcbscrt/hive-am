'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { usePolling } from '@/lib/hooks/usePolling';
import { useI18n } from '@/lib/i18n/index';
import { useLogStream } from '@/lib/useLogStream';
import { NO_VALUE, ago, shortPath } from '@/lib/meta';
import { fmtBytes } from '@/lib/format';
import type { ClusterConfig, DockerConfig, ObjectStats, ObjectView, ServerConfig } from '@/lib/types';
import { StatusDot } from './ObjectPanel';
import { detailText } from './meta';
import { Spark } from './Spark';
import { ClusterMembers } from './ClusterMembers';
import { ServicesTable } from './ServicesTable';

const HISTORY = 60;
const dur = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`; };

/** What an object is using, asked every few seconds while it is running (and once when it is not, for the details Docker knows). */
function useStats(o: ObjectView) {
  const [stats, setStats] = useState<ObjectStats | null>(null);
  const [cpu, setCpu] = useState<number[]>([]);
  const [mem, setMem] = useState<number[]>([]);
  const live = o.state.status === 'running' || o.state.status === 'starting';
  const [nonce, setNonce] = useState(0);
  const reload = () => setNonce((n) => n + 1);
  useEffect(() => {
    if (o.kind !== 'server' && o.kind !== 'docker') return;
    if (nonce === 0) { setStats(null); setCpu([]); setMem([]); }
    let dead = false, timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await api.get<ObjectStats>(`/objects/${o.id}/stats`);
        if (dead) return;
        setStats(r);
        if (r.cpu !== null) setCpu((c) => [...c, r.cpu!].slice(-HISTORY));
        if (r.memBytes !== null) setMem((m) => [...m, r.memBytes!].slice(-HISTORY));
      } catch { /* the next one tries again */ }
      if (!dead && live) timer = setTimeout(tick, 3000);
    };
    void tick();
    return () => { dead = true; clearTimeout(timer); };
  }, [o.id, o.kind, live, nonce]);
  return { stats, cpu, mem, live, reload };
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="ov-row"><dt>{k}</dt><dd>{v}</dd></div>;

/** The first tab of a server, a container or a cluster: its state, what it uses, how it is set up and its latest output. */
export function ObjectSummary({ object: o, onSeeLogs }: { object: ObjectView; onSeeLogs: (filter?: string) => void }) {
  const { t } = useI18n();
  const { stats, cpu, mem, live, reload } = useStats(o);
  const [, tick] = useState(0);
  usePolling(() => tick((x) => x + 1), 1000, { enabled: live, immediate: false });
  const { text } = useLogStream(o.id, { max: 40_000, pollMs: 2000 });
  const lastLines = useMemo(() => (text ?? '').split('\n').filter((l) => l.trim()).slice(-14).join('\n'), [text]);
  const info = stats?.info ?? {};
  const st = o.state;
  const none = t('ow.d.none');

  const details: [string, React.ReactNode][] = [];
  if (o.kind === 'server') {
    const c = o.config as ServerConfig;
    details.push([t('ow.d.command'), <code key="c" className="mono">{c.start}</code>], [t('ow.d.folder'), <code key="f" className="mono" title={c.cwd}>{shortPath(c.cwd)}</code>]);
    if (c.port) details.push([t('ow.d.port'), c.port]);
    if (c.stop) details.push([t('ow.d.stop'), <code key="s" className="mono">{c.stop}</code>]);
    details.push([t('ow.d.restart'), c.restart && c.restart !== 'no' ? `${t(c.restart === 'always' ? 'obj.sup.restart.always' : 'obj.sup.restart.fail')} (${c.maxRestarts ?? 5})` : t('obj.sup.restart.no')]);
    details.push([t('ow.d.health'), c.health ? `${c.health.kind.toUpperCase()}: ${c.health.target}` : none]);
    if (st.pid) details.push(['PID', st.pid]);
  } else if (o.kind === 'docker') {
    const c = o.config as DockerConfig;
    details.push([t('ow.d.mode'), t(`obj.mode.${c.mode}`)]);
    if (c.mode === 'compose') details.push([t('ow.d.compose'), <code key="f" className="mono" title={c.file}>{shortPath(c.file ?? '')}</code>], [t('ow.d.services'), `${info.running ?? 0}/${info.services ?? 0}`]);
    else {
      details.push([t('ow.d.container'), <code key="n" className="mono">{c.mode === 'existing' ? c.container : `hive-am-${o.id.slice(0, 8)}`}</code>]);
      if (info.image || c.image) details.push([t('ow.d.image'), <code key="i" className="mono">{String(info.image ?? c.image)}</code>]);
      if (info.ports || c.ports?.length) details.push([t('ow.d.ports'), String(info.ports ?? c.ports?.join(', '))]);
      if (info.network || c.network) details.push([t('ow.d.network'), String(info.network ?? c.network)]);
      if (info.restartPolicy) details.push([t('ow.d.restart'), String(info.restartPolicy)]);
      if (info.restarts !== undefined && info.restarts !== null) details.push([t('ow.d.restarts'), String(info.restarts)]);
      if (info.memoryLimit) details.push([t('ow.d.memLimit'), fmtBytes(Number(info.memoryLimit))]);
      if (info.cpuLimit) details.push([t('ow.d.cpuLimit'), String(info.cpuLimit)]);
      if (info.created) details.push([t('ow.d.created'), ago(Number(info.created))]);
    }
  }

  return (
    <div className="ov">
      <div className="ov-grid">
        <section className="ov-card">
          <div className="eyebrow">{t('ow.state')}</div>
          <div className="ov-big"><StatusDot status={st.status} className="lg" />{t(`obj.status.${st.status}`)}</div>
          {st.detail && <p className="muted small" style={{ margin: 0 }}>{detailText(t, st.detail)}</p>}
          {st.since && live && <p className="small" style={{ margin: 0 }}>{t('ow.uptime')} <b>{dur(Date.now() - st.since)}</b></p>}
        </section>
        {(o.kind === 'server' || o.kind === 'docker') && (
          <section className="ov-card">
            <div className="eyebrow">{t('ow.usage')}</div>
            {!live && stats?.cpu === null ? <p className="muted small" style={{ margin: 0 }}>{t('ow.noUsage')}</p> : (<>
              <div className="ov-meter"><span>{t('ow.cpu')}</span><b>{stats?.cpu !== null && stats?.cpu !== undefined ? `${stats.cpu}%` : NO_VALUE}</b></div>
              <Spark values={cpu} color="var(--p-opencode)" />
              <div className="ov-meter"><span>{t('ow.mem')}</span><b>{stats?.memBytes != null ? `${fmtBytes(stats.memBytes)}${stats.memLimitBytes ? ` / ${fmtBytes(stats.memLimitBytes)}` : ''}` : NO_VALUE}</b></div>
              <Spark values={mem} color="var(--ok)" />
              <dl className="ov-dl">
                {stats?.pids != null && <Row k={t('ow.procs')} v={stats.pids} />}
                {stats?.net && <Row k={t('ow.net')} v={stats.net} />}
                {stats?.block && <Row k={t('ow.block')} v={stats.block} />}
              </dl>
            </>)}
          </section>
        )}
        {details.length > 0 && <section className="ov-card"><div className="eyebrow">{t('ow.info')}</div><dl className="ov-dl">{details.map(([k, v], i) => <Row key={i} k={k} v={v} />)}</dl></section>}
      </div>

      {o.kind === 'docker' && (o.config as DockerConfig).mode === 'compose' && (
        <section className="ov-card wide"><div className="eyebrow">{t('ow.d.services')}{stats?.services?.length ? ` · ${info.running ?? 0}/${info.services ?? 0}` : ''}</div>
          {stats === null ? <p className="muted small ov-empty"><Loader2 size={14} className="spin" /> {t('ow.svc.loading')}</p>
            : stats.services && stats.services.length > 0 ? <ServicesTable objectId={o.id} services={stats.services} onLogs={(sv) => onSeeLogs(`${sv}-`)} onChanged={reload} />
            : <p className="muted small ov-empty">{t(live ? 'ow.svc.none' : 'ow.svc.stopped')}</p>}
        </section>
      )}
      {o.kind === 'cluster' && <section className="ov-card wide"><div className="eyebrow">{t('cl.members')}</div><ClusterMembers cluster={o} /></section>}
      <section className="ov-card wide grow">
        <div className="row"><div className="eyebrow grow">{t('ow.recent')}</div><button className="btn ghost sm" onClick={() => onSeeLogs()}>{t('ow.seeLogs')}</button></div>
        <pre className="ov-log mono">{text === null ? t('git.loading') : lastLines || t('obj.logs.empty')}</pre>
      </section>
    </div>
  );
}
