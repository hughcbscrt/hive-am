'use client';
import Link from 'next/link';
import { Fragment, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Play, Plus, RotateCw, Square, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { useHive } from '@/lib/store';
import { ago, shortPath } from '@/lib/meta';
import { fmtBytes } from '@/lib/format';
import type { ClusterConfig, DockerConfig, ObjectStats, ObjectView, ServerConfig } from '@/lib/types';
import { useToast } from '@/components/ui';
import { KIND, detailText } from './meta';
import { StatusDot } from './ObjectPanel';
import { ServicesTable } from './ServicesTable';

/** What each running member uses (and the services of a compose member), asked every few seconds. */
function useMemberStats(members: ObjectView[]): { stats: Record<string, ObjectStats>; reload: () => void } {
  const [stats, setStats] = useState<Record<string, ObjectStats>>({});
  const [nonce, setNonce] = useState(0);
  const key = members.map((m) => `${m.id}:${m.state.status}`).join(',');
  useEffect(() => {
    let dead = false, timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const live = members.filter((m) => m.kind !== 'cluster' && m.kind !== 'http');
      const got = await Promise.all(live.map((m) => api.get<ObjectStats>(`/objects/${m.id}/stats`).then((r) => [m.id, r] as const).catch(() => null)));
      if (dead) return;
      setStats(Object.fromEntries(got.filter((x): x is readonly [string, ObjectStats] => !!x)));
      if (members.some((m) => m.state.status === 'running' || m.state.status === 'starting')) timer = setTimeout(tick, 5000);
    };
    void tick();
    return () => { dead = true; clearTimeout(timer); };
  }, [key, nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  return { stats, reload: () => setNonce((n) => n + 1) };
}

/** What a member is, in one line: the command of a server, the image of a container, the file and services of a compose project. */
function summaryOf(m: ObjectView, st?: ObjectStats): string {
  if (m.kind === 'server') return (m.config as ServerConfig).start;
  const c = m.config as DockerConfig;
  if (c.mode === 'compose') return `${shortPath(c.file ?? '')}${st?.services ? ` · ${st.info.running ?? 0}/${st.info.services ?? 0}` : ''}`;
  return String(st?.info.image ?? c.image ?? c.container ?? '');
}

/** The members of a cluster as a tree, the way Docker Desktop shows a project: state and use of each, the services of a compose member under it, one by one actions, and the order they start in. */
export function ClusterMembers({ cluster }: { cluster: ObjectView }) {
  const { t } = useI18n();
  const { objects, refresh } = useHive();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const ids = (cluster.config as ClusterConfig).members;
  const members = ids.map((id) => objects.find((o) => o.id === id)).filter((o): o is ObjectView => !!o);
  const { stats, reload } = useMemberStats(members);
  const toggle = (id: string) => setOpen((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pool = objects.filter((o) => (o.kind === 'server' || o.kind === 'docker') && (o.colony_id ?? null) === (cluster.colony_id ?? null) && !ids.includes(o.id));

  const saveMembers = async (next: string[]) => {
    setBusy('members');
    try { await api.patch(`/objects/${cluster.id}`, { config: { members: next } }); await refresh(['objects']); }
    catch (e) { toast(e instanceof Error ? e.message : t('edit.saveFailed'), 'err'); } finally { setBusy(null); }
  };
  const move = (i: number, d: number) => { const next = [...ids]; const j = i + d; if (j < 0 || j >= next.length) return; [next[i], next[j]] = [next[j], next[i]]; void saveMembers(next); };
  const act = async (m: ObjectView, action: 'start' | 'stop' | 'restart') => {
    setBusy(`${m.id}:${action}`);
    try { await api.post(`/objects/${m.id}/action`, { action }); } catch (e) { toast(`${t('obj.act.failed', { action: t(`obj.act.${action}`) })}: ${e instanceof Error ? e.message : ''}`, 'err'); } finally { setBusy(null); reload(); }
  };

  return (
    <div className="cm">
      {members.length === 0 ? <p className="muted">{t('cl.none')}</p> : (
        <table className="cm-table cm-tree">
          <thead><tr><th>{t('cl.order')}</th><th>{t('obj.f.name')}</th><th>{t('svc.col.runs')}</th><th>{t('ow.state')}</th><th className="num">{t('ow.cpu')}</th><th className="num">{t('ow.mem')}</th><th /></tr></thead>
          <tbody>
            {members.map((m, i) => {
              const { icon: Icon, color } = KIND[m.kind]; const live = m.state.status === 'running' || m.state.status === 'starting';
              const st = stats[m.id]; const sv = st?.services; const expanded = open.has(m.id);
              return (
                <Fragment key={m.id}>
                  <tr>
                    <td className="cm-ord"><span className="ord">{i + 1}</span>
                      <button className="btn ghost icon sm" disabled={i === 0 || !!busy} onClick={() => move(i, -1)} aria-label={t('cl.up')} title={t('cl.up')}><ArrowUp size={14} /></button>
                      <button className="btn ghost icon sm" disabled={i === members.length - 1 || !!busy} onClick={() => move(i, 1)} aria-label={t('cl.down')} title={t('cl.down')}><ArrowDown size={14} /></button></td>
                    <td><span className="row gap-s">
                      {sv && sv.length > 0 ? <button className="cm-chev" onClick={() => toggle(m.id)} aria-expanded={expanded} aria-label={expanded ? t('svc.collapse') : t('svc.expand')} title={expanded ? t('svc.collapse') : t('svc.expand')}>{expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button> : <span style={{ width: 20 }} />}
                      <Link href={`/objects/${m.id}`} className="cm-name"><Icon size={15} style={{ color }} /><b>{m.name}</b></Link></span></td>
                    <td className="mono small svc-img" title={summaryOf(m, st)}>{summaryOf(m, st) || '—'}</td>
                    <td><span className="row gap-s small"><StatusDot status={m.state.status} />{t(`obj.status.${m.state.status}`)}</span>
                      <span className="muted small">{[detailText(t, m.state.detail), m.state.since && live ? t('obj.since', { time: ago(m.state.since) }) : ''].filter(Boolean).join(' · ')}</span></td>
                    <td className="num mono small">{st?.cpu != null ? `${st.cpu}%` : '—'}</td>
                    <td className="num mono small">{st?.memBytes != null ? fmtBytes(st.memBytes) : '—'}</td>
                    <td className="cm-act">
                      <button className="btn ghost icon sm" disabled={!!busy || live} onClick={() => void act(m, 'start')} aria-label={t('obj.act.start')} title={t('obj.act.start')}><Play size={14} /></button>
                      <button className="btn ghost icon sm" disabled={!!busy || (!live && m.state.status !== 'error')} onClick={() => void act(m, 'stop')} aria-label={t('obj.act.stop')} title={t('obj.act.stop')}><Square size={14} /></button>
                      <button className="btn ghost icon sm" disabled={!!busy} onClick={() => void act(m, 'restart')} aria-label={t('obj.act.restart')} title={t('obj.act.restart')}><RotateCw size={14} /></button>
                      <button className="btn ghost icon sm" disabled={!!busy} onClick={() => void saveMembers(ids.filter((x) => x !== m.id))} aria-label={t('cl.remove')} title={t('cl.remove')}><X size={14} /></button></td>
                  </tr>
                  {expanded && sv && <tr className="cm-sub"><td colSpan={7}><ServicesTable objectId={m.id} services={sv} onChanged={reload} /></td></tr>}
                </Fragment>);
            })}
          </tbody>
        </table>
      )}
      <p className="muted small" style={{ margin: '8px 0' }}>{t('cl.startOrder')}</p>
      {pool.length > 0 && (
        <div className="row gap-s"><Plus size={15} className="muted" />
          <select className="select" style={{ width: 'auto' }} value="" onChange={(e) => e.target.value && void saveMembers([...ids, e.target.value])} aria-label={t('cl.add')}>
            <option value="">{t('cl.add')}…</option>{pool.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
      )}
    </div>
  );
}
