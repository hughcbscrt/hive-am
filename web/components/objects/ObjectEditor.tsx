'use client';
import { useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { useHive } from '@/lib/store';
import type { ObjectKind, ObjectView } from '@/lib/types';
import { Drawer, useToast } from '@/components/ui';
import { ObjectFields, draftFrom, toConfig, useDraft, type Draft } from './ObjectForm';
import { MANAGEABLE } from './ManagerField';
import { suggestDbName } from './DatabaseCards';

/** Creating an object. (Changing one is done in its own screen: see ObjectWorkspace.) `initial` opens it filled in (a managed copy), with `notice` above. */
export function ObjectEditor({ presetColonyId, presetKind, initial, title, notice, onClose, onSaved }: {
  presetColonyId?: string; presetKind?: ObjectKind; initial?: Draft; title?: string; notice?: ReactNode; onClose: () => void; onSaved?: (id: string) => void;
}) {
  const { t } = useI18n();
  const { refresh } = useHive();
  const toast = useToast();
  const { d, set, setD } = useDraft(() => initial ?? draftFrom(undefined, presetColonyId, presetKind));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const name = d.name.trim() || (d.kind === 'database' ? suggestDbName(d) : '');
    if (!name) { setErr(t('obj.err.name')); return; }
    setBusy(true); setErr('');
    try {
      if (d.kind === 'docker' && d.mode === 'template' && !d.template) { setErr(t('tpl.pick')); setBusy(false); return; }
      const r = d.kind === 'docker' && d.mode === 'template'
        ? await api.post<ObjectView>('/objects/from-template', { name, colony_id: d.colony_id || null, template: d.template, values: d.tplValues })
        : await api.post<ObjectView>('/objects', { name, colony_id: d.colony_id || null, kind: d.kind, config: toConfig(d) });
      if (d.manager && MANAGEABLE.includes(d.kind)) await api.put(`/objects/${r.id}/manager`, { agent_id: d.manager }).catch((e) => toast(e instanceof Error ? e.message : '', 'err'));
      await refresh(['objects', 'agents']);
      toast(t('obj.created')); onSaved?.(r.id); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : t('edit.saveFailed')); setBusy(false); }
  };

  return (
    <Drawer title={title ?? t('obj.newTitle')} subtitle={t('obj.subtitle')} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={busy} onClick={() => void save()}>{t('obj.create')}</button></>}>
      {notice}
      <ObjectFields d={d} set={set} setD={setD} showKind={!initial} error={err} />
    </Drawer>
  );
}
