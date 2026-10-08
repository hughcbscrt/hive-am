'use client';
import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useToast } from '@/components/ui';
import { draftFromAgent, validate, type AgentDraft } from './AgentForm';
import { DeleteAgentModal } from './DeleteAgentModal';
import { useHive } from '@/lib/store';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import type { Agent } from '@/lib/types';

/**
 * One place for editing an agent's settings, shared by the agent workspace sidebar and the colony drawer
 * so both validate, save, discard, delete and word things the same way.
 */
export function useAgentSettings(agent: Agent | undefined, opts: { onSaved?: () => void; onDeleted?: () => void } = {}) {
  const { t } = useI18n();
  const { agents, colonies, refresh } = useHive();
  const toast = useToast();
  const base = useMemo(() => (agent ? JSON.stringify(draftFromAgent(agent)) : ''), [agent]);
  const [draft, setDraft] = useState<AgentDraft | null>(() => (agent ? draftFromAgent(agent) : null));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Follow the saved agent (another agent selected, or the server changed it).
  useEffect(() => { setDraft(agent ? draftFromAgent(agent) : null); }, [base]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = draft && agent ? validate(draft, agents, agent.id, colonies) : {};
  const dirty = !!draft && JSON.stringify(draft) !== base;

  const save = async () => {
    if (!draft || !agent) return;
    if (Object.keys(errors).length) { toast(t('edit.fixFields'), 'err'); return; }
    setSaving(true);
    try {
      const { type_id: _t, ...patch } = draft; void _t;
      await api.patch(`/agents/${agent.id}`, patch);
      await refresh(['agents', 'colonies']);
      toast(t('edit.saved', { name: draft.name.trim() }));
      opts.onSaved?.();
    } catch (e) { toast(e instanceof Error ? e.message : t('edit.saveFailed'), 'err'); }
    setSaving(false);
  };
  const discard = () => { if (agent) setDraft(draftFromAgent(agent)); };

  /** Delete (left), then Discard and Save. Same buttons, same order, same labels everywhere. */
  const actions = (o: { size?: 'sm'; onCancel?: () => void } = {}) => (
    <>
      <button className={`btn danger ${o.size ?? ''}`} style={{ marginRight: 'auto' }} onClick={() => setConfirmDelete(true)}><Trash2 size={o.size ? 14 : 15} />{t('agent.delete')}</button>
      {o.onCancel
        ? <button className={`btn ghost ${o.size ?? ''}`} onClick={o.onCancel}>{t('common.cancel')}</button>
        : <button className={`btn ghost ${o.size ?? ''}`} disabled={!dirty} onClick={discard}>{t('common.discard')}</button>}
      <button className={`btn primary ${o.size ?? ''}`} disabled={!dirty || saving} onClick={save}>{saving ? t('common.saving') : t('common.saveChanges')}</button>
    </>
  );
  const deleteModal = confirmDelete && agent ? <DeleteAgentModal agent={agent} onClose={() => setConfirmDelete(false)} onDeleted={opts.onDeleted} /> : null;

  return { draft, setDraft, errors, dirty, saving, save, discard, actions, deleteModal };
}
