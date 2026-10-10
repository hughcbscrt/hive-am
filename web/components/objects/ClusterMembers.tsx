'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ArrowDown, ArrowUp, Play, Plus, RotateCw, Square, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { useHive } from '@/lib/store';
import { ago } from '@/lib/meta';
import type { ClusterConfig, ObjectView } from '@/lib/types';
import { useToast } from '@/components/ui';
import { KIND } from './meta';
import { StatusDot } from './ObjectPanel';

/** The members of a cluster: their state, one by one actions, and the order they start in. */
export function ClusterMembers({ cluster }: { cluster: ObjectView }) {
  const { t } = useI18n();
  const { objects, refresh } = useHive();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const ids = (cluster.config as ClusterConfig).members;
  const members = ids.map((id) => objects.find((o) => o.id === id)).filter((o): o is ObjectView => !!o);
  const pool = objects.filter((o) => (o.kind === 'server' || o.kind === 'docker') && (o.colony_id ?? null) === (cluster.colony_id ?? null) && !ids.includes(o.id));

  const saveMembers = async (next: string[]) => {
    setBusy('members');
    try { await api.patch(`/objects/${cluster.id}`, { config: { members: next } }); await refresh(['objects']); }
    catch (e) { toast(e instanceof Error ? e.message : t('edit.saveFailed'), 'err'); } finally { setBusy(null); }
  };
  const move = (i: number, d: number) => { const next = [...ids]; const j = i + d; if (j < 0 || j >= next.length) return; [next[i], next[j]] = [next[j], next[i]]; void saveMembers(next); };
  const act = async (m: ObjectView, action: 'start' | 'stop' | 'restart') => {
    setBusy(`${m.id}:${action}`);
    try { await api.post(`/objects/${m.id}/action`, { action }); } catch (e) { toast(`${t('obj.act.failed', { action: t(`obj.act.${action}`) })}: ${e instanceof Error ? e.message : ''}`, 'err'); } finally { setBusy(null); }
  };

  return (
    <div className="cm">
      {members.length === 0 ? <p className="muted">{t('cl.none')}</p> : (
        <table className="cm-table">
          <thead><tr><th>{t('cl.order')}</th><th>{t('obj.f.name')}</th><th>{t('ow.state')}</th><th /></tr></thead>
          <tbody>
            {members.map((m, i) => { const { icon: Icon, color } = KIND[m.kind]; const live = m.state.status === 'running' || m.state.status === 'starting'; return (
              <tr key={m.id}>
                <td className="cm-ord"><span className="ord">{i + 1}</span>
                  <button className="btn ghost icon sm" disabled={i === 0 || !!busy} onClick={() => move(i, -1)} aria-label={t('cl.up')} title={t('cl.up')}><ArrowUp size={14} /></button>
                  <button className="btn ghost icon sm" disabled={i === members.length - 1 || !!busy} onClick={() => move(i, 1)} aria-label={t('cl.down')} title={t('cl.down')}><ArrowDown size={14} /></button></td>
                <td><Link href={`/objects/${m.id}`} className="cm-name"><Icon size={15} style={{ color }} /><b>{m.name}</b></Link></td>
                <td><span className="row gap-s small"><StatusDot status={m.state.status} />{t(`obj.status.${m.state.status}`)}</span>
                  <span className="muted small">{[m.state.detail, m.state.since && live ? t('obj.since', { time: ago(m.state.since) }) : ''].filter(Boolean).join(' · ')}</span></td>
                <td className="cm-act">
                  <button className="btn ghost icon sm" disabled={!!busy || live} onClick={() => void act(m, 'start')} aria-label={t('obj.act.start')} title={t('obj.act.start')}><Play size={14} /></button>
                  <button className="btn ghost icon sm" disabled={!!busy || (!live && m.state.status !== 'error')} onClick={() => void act(m, 'stop')} aria-label={t('obj.act.stop')} title={t('obj.act.stop')}><Square size={14} /></button>
                  <button className="btn ghost icon sm" disabled={!!busy} onClick={() => void act(m, 'restart')} aria-label={t('obj.act.restart')} title={t('obj.act.restart')}><RotateCw size={14} /></button>
                  <button className="btn ghost icon sm" disabled={!!busy} onClick={() => void saveMembers(ids.filter((x) => x !== m.id))} aria-label={t('cl.remove')} title={t('cl.remove')}><X size={14} /></button></td>
              </tr>); })}
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
