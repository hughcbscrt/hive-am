'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { useHive } from '@/lib/store';
import type { DockerConfig, HttpScan, ObjectView } from '@/lib/types';
import { Modal, useToast } from '@/components/ui';
import { ObjectFields, draftFrom, toConfig, useDraft } from './ObjectForm';

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
  const [scan, setScan] = useState<HttpScan | null>(null);
  useEffect(() => { if (o.kind === 'http') api.get<HttpScan>(`/objects/${o.id}/http`).then(setScan).catch(() => undefined); }, [o.id, o.kind]);
  const dirty = JSON.stringify(d) !== JSON.stringify(base);
  const live = o.state.status === 'running' || o.state.status === 'starting';
  const restartable = o.kind === 'server' || o.kind === 'docker' || o.kind === 'cluster';

  const save = async (restart = false) => {
    if (!d.name.trim()) { setErr(t('obj.err.name')); return; }
    setBusy(true); setErr('');
    try {
      await api.patch(`/objects/${o.id}`, { name: d.name.trim(), colony_id: d.colony_id || null, config: toConfig(d) });
      await refresh(['objects']);
      if (restart) await api.post(`/objects/${o.id}/action`, { action: 'restart' }).catch((e) => toast(e instanceof Error ? e.message : '', 'err'));
      toast(t('obj.saved'));
    } catch (e) { setErr(e instanceof Error ? e.message : t('edit.saveFailed')); } finally { setBusy(false); }
  };
  const del = async () => {
    setBusy(true);
    try { await api.del(`/objects/${o.id}`); await refresh(['objects']); toast(t('obj.deleted')); router.push('/objects'); }
    catch (e) { setErr(e instanceof Error ? e.message : ''); setConfirmDel(false); setBusy(false); }
  };

  return (
    <div className="oc">
      <div className="oc-form"><ObjectFields d={d} set={set} setD={setD} fileEnvs={scan ? Object.keys(scan.fileVars).filter((e) => e !== '$shared') : undefined} fileVars={scan?.fileVars} error={err} /></div>
      <div className="savebar oc-bar">
        <span className="muted small grow">{dirty ? t('ow.cfg.dirty') : t('ow.cfg.saved')}{dirty && restartable ? ` · ${live ? t('ow.cfg.appliesRunning') : t('ow.cfg.applies')}` : ''}</span>
        <button className="btn danger" onClick={() => setConfirmDel(true)}><Trash2 size={15} />{t('common.delete')}</button>
        <button className="btn ghost" disabled={!dirty || busy} onClick={() => { setD(() => base); setErr(''); }}>{t('ow.cfg.discard')}</button>
        {restartable && live && <button className="btn" disabled={!dirty || busy} onClick={() => void save(true)}>{t('ow.cfg.saveRestart')}</button>}
        <button className="btn primary" disabled={!dirty || busy} onClick={() => void save()}>{t('ow.cfg.save')}</button>
      </div>
      {confirmDel && (
        <Modal title={t('obj.delete.title', { name: o.name })} onClose={() => setConfirmDel(false)}>
          <p style={{ margin: 0 }} className="muted">{o.kind === 'server' ? t('obj.delete.server') : o.kind === 'docker' ? t(`obj.delete.${(o.config as DockerConfig).mode}`) : t(`obj.delete.${o.kind}`)}</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn ghost" onClick={() => setConfirmDel(false)}>{t('common.cancel')}</button><button className="btn danger" disabled={busy} onClick={() => void del()}>{t('obj.delete')}</button></div>
        </Modal>
      )}
    </div>
  );
}
