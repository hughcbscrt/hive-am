'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { useHive } from '@/lib/store';
import type { ObjectKind, ObjectView } from '@/lib/types';
import { Drawer, useToast } from '@/components/ui';
import { ObjectFields, draftFrom, toConfig, useDraft } from './ObjectForm';

/** Creating an object. (Changing one is done in its own screen: see ObjectWorkspace.) */
export function ObjectEditor({ presetColonyId, presetKind, onClose, onSaved }: { presetColonyId?: string; presetKind?: ObjectKind; onClose: () => void; onSaved?: (id: string) => void }) {
  const { t } = useI18n();
  const { refresh } = useHive();
  const toast = useToast();
  const { d, set, setD } = useDraft(() => draftFrom(undefined, presetColonyId, presetKind));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!d.name.trim()) { setErr(t('obj.err.name')); return; }
    setBusy(true); setErr('');
    try {
      const r = await api.post<ObjectView>('/objects', { name: d.name.trim(), colony_id: d.colony_id || null, kind: d.kind, config: toConfig(d) });
      await refresh(['objects']);
      toast(t('obj.created')); onSaved?.(r.id); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : t('edit.saveFailed')); setBusy(false); }
  };

  return (
    <Drawer title={t('obj.newTitle')} subtitle={t('obj.subtitle')} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={busy} onClick={() => void save()}>{t('obj.create')}</button></>}>
      <ObjectFields d={d} set={set} setD={setD} showKind error={err} />
    </Drawer>
  );
}
