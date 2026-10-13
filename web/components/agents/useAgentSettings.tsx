'use client';
import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useToast } from '@/components/ui';
import { draftFromAgent, validate, type AgentDraft } from './AgentForm';
import { DeleteAgentModal } from './DeleteAgentModal';
import { useHiveData } from '@/lib/store';
import { useUnsavedGuard } from '@/lib/hooks/useUnsavedGuard';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import type { Agent } from '@/lib/types';

/**
 * One place for editing an agent's settings, shared by the agent workspace sidebar and the colony drawer
 * so both validate, save, discard, delete and word things the same way.
 */
export function useAgentSettings(agent: Agent | undefined, opts: { onSaved?: () => void; onDeleted?: () => void } = {}) {
  const { t } = useI18n();
  const { agents, colonies, objects, refresh } = useHiveData();
  const toast = useToast();
  // The resources it looks after come from the resources themselves (each one has its manager).
  const managed = useMemo(() => (agent ? objects.filter((o) => o.manager_id === agent.id).map((o) => o.id).sort() : []), [objects, agent?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = useMemo(() => (agent ? JSON.stringify(draftFromAgent(agent, managed)) : ''), [agent, managed]);
  const [draft, setDraft] = useState<AgentDraft | null>(() => (agent ? draftFromAgent(agent, managed) : null));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Follow the saved agent (another agent selected, or the server changed it).
  useEffect(() => { setDraft(agent ? draftFromAgent(agent, managed) : null); }, [base]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = draft && agent ? validate(draft, agents, agent.id, colonies) : {};
  const dirty = !!draft && JSON.stringify(draft) !== base;
  useUnsavedGuard(dirty);

  const save = async () => {
    if (!draft || !agent) return;
    if (Object.keys(errors).length) { toast(t('edit.fixFields'), 'err'); return; }
    setSaving(true);
    try {
      const { type_id: _t, object_ids, ...patch } = draft; void _t;
      await api.patch(`/agents/${agent.id}`, patch);
      if (JSON.stringify([...object_ids].sort()) !== JSON.stringify(managed)) await api.put(`/agents/${agent.id}/resources`, { object_ids });
      await refresh(['agents', 'colonies', 'objects']);
      toast(t('edit.saved', { name: draft.name.trim() }));
      opts.onSaved?.();
    } catch (e) { toast(e instanceof Error ? e.message : t('edit.saveFailed'), 'err'); }
    setSaving(false);
  };
  const discard = () => { if (agent) setDraft(draftFromAgent(agent, managed)); };

  /** Delete (left), then Discard and Save. Same buttons, same order, same labels everywhere. */
  const actions = (o: { size?: 'sm'; onCancel?: () => void } = {}) => (
    <>
      <button className={`btn danger push-r ${o.size ?? ''}`} onClick={() => setConfirmDelete(true)}><Trash2 size={o.size ? 14 : 15} />{t('agent.delete')}</button>
      {o.onCancel
        ? <button className={`btn ghost ${o.size ?? ''}`} onClick={o.onCancel}>{t('common.cancel')}</button>
        : <button className={`btn ghost ${o.size ?? ''}`} disabled={!dirty} onClick={discard}>{t('common.discard')}</button>}
      <button className={`btn primary ${o.size ?? ''}`} disabled={!dirty || saving} onClick={save}>{saving ? t('common.saving') : t('common.saveChanges')}</button>
    </>
  );
  const deleteModal = confirmDelete && agent ? <DeleteAgentModal agent={agent} onClose={() => setConfirmDelete(false)} onDeleted={opts.onDeleted} /> : null;

  return { draft, setDraft, errors, dirty, saving, save, discard, actions, deleteModal };
}
