'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { useHive } from '@/lib/store';
import type { DockerConfig, DockerPlan, HttpScan, ObjectView } from '@/lib/types';
import { ConfirmDialog, useToast } from '@/components/ui';
import { MANAGEABLE } from './ManagerField';
import { ObjectFields, draftFrom, toConfig, useDraft } from './ObjectForm';
import { PlanDialog, applied } from './PlanDialog';

/** The settings of an object, in its own screen: fields, a bar that says whether something is unsaved, and delete. */
export function ObjectConfig({ object: o }: { object: ObjectView }) {
  const { t } = useI18n();
  const { refresh } = useHive();
  const toast = useToast();
  const router = useRouter();
  const base = useMemo(() => draftFrom(o), [o.updated_at, o.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const { d, set, setD } = useDraft(() => base);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  // Discarding mounts the fields again, so nothing opened in them (a folder list, a suggestion) outlives the values it was opened for.
  const [gen, setGen] = useState(0);
  const [scan, setScan] = useState<HttpScan | null>(null);
  useEffect(() => { if (o.kind === 'http') api.get<HttpScan>(`/objects/${o.id}/http`).then(setScan).catch(() => undefined); }, [o.id, o.kind]);
  const dirty = JSON.stringify(d) !== JSON.stringify(base);
  const live = o.state.status === 'running' || o.state.status === 'starting';
  const restartable = o.kind === 'server' || o.kind === 'docker' || o.kind === 'cluster';
  // A container hive-am creates is applied, not restarted: what changes in place changes in place, and recreating it asks first.
  const container = o.kind === 'docker' && (o.config as DockerConfig).mode === 'container';
  const [plan, setPlan] = useState<DockerPlan | null>(null);

  const persist = async () => {
    await api.patch(`/objects/${o.id}`, { name: d.name.trim(), colony_id: d.colony_id || null, config: toConfig(d) });
    if (d.manager !== base.manager && MANAGEABLE.includes(o.kind)) await api.put(`/objects/${o.id}/manager`, { agent_id: d.manager || null });
    await refresh(['objects', 'agents']);
  };
  const save = async (restart = false) => {
    if (!d.name.trim()) { setErr(t('obj.err.name')); return; }
    setBusy(true); setErr('');
    try {
      await persist();
      if (restart) await api.post(`/objects/${o.id}/action`, { action: 'restart' }).catch((e) => toast(e instanceof Error ? e.message : '', 'err'));
      toast(t('obj.saved'));
    } catch (e) { setErr(e instanceof Error ? e.message : t('edit.saveFailed')); } finally { setBusy(false); }
  };
  /** Save and apply: Docker is asked first what would change; a recreate waits for the confirmation, the rest is saved and applied now. */
  const runApply = async (p: DockerPlan, confirm: boolean) => {
    await persist();
    const r = await api.post<Parameters<typeof applied>[1]>(`/objects/${o.id}/docker/apply`, { confirm, drop: p.disconnect });
    toast(applied(t, r, p));
  };
  const apply = async () => {
    if (!d.name.trim()) { setErr(t('obj.err.name')); return; }
    setBusy(true); setErr('');
    try {
      const p = await api.post<DockerPlan>(`/objects/${o.id}/docker/plan`, { config: toConfig(d) });
      if (p.recreate) setPlan(p); else await runApply(p, false);
    } catch (e) { setErr(e instanceof Error ? e.message : t('edit.saveFailed')); } finally { setBusy(false); }
  };
  const del = async () => {
    await api.del(`/objects/${o.id}`); await refresh(['objects']); toast(t('obj.deleted')); router.push('/resources');
  };

  return (
    <div className="oc">
      <div className="oc-body">
        <div className="oc-form"><ObjectFields key={gen} objectId={o.id} d={d} set={set} setD={setD} scan={scan} error={err} /></div>
      </div>
      <div className="savebar oc-bar">
        <span className="muted small grow">{dirty ? t('ow.cfg.dirty') : t('ow.cfg.saved')}{dirty && restartable ? ` · ${container ? t('ow.cfg.appliesDocker') : live ? t('ow.cfg.appliesRunning') : t('ow.cfg.applies')}` : ''}</span>
        <button className="btn danger" onClick={() => setConfirmDel(true)}><Trash2 size={15} />{t('common.delete')}</button>
        <button className="btn ghost" disabled={!dirty || busy} onClick={() => { setD(() => base); setErr(''); setGen((g) => g + 1); }}>{t('ow.cfg.discard')}</button>
        {container ? <button className="btn" disabled={!dirty || busy} onClick={() => void apply()} title={t('ap.hint')}>{t('ow.cfg.saveApply')}</button>
          : restartable && live && <button className="btn" disabled={!dirty || busy} onClick={() => void save(true)}>{t('ow.cfg.saveRestart')}</button>}
        <button className="btn primary" disabled={!dirty || busy} onClick={() => void save()}>{t('ow.cfg.save')}</button>
      </div>
      {plan && <PlanDialog name={o.name} plan={plan} onConfirm={() => runApply(plan, true)} onClose={() => setPlan(null)} />}
      {confirmDel && (
        <ConfirmDialog title={t('obj.delete.title', { name: o.name })} confirmLabel={t('obj.delete')} danger onConfirm={del} onClose={() => setConfirmDel(false)}
          body={o.kind === 'server' ? t('obj.delete.server') : o.kind === 'docker' ? t(`obj.delete.${(o.config as DockerConfig).mode}`) : t(`obj.delete.${o.kind}`)} />
      )}
    </div>
  );
}
