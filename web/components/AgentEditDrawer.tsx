'use client';
import { useState } from 'react';
import { Drawer, useToast } from './ui';
import { AgentForm, draftFromAgent, validate, type AgentDraft } from './AgentForm';
import { useHive } from '@/lib/store';
import { api } from '@/lib/api';
import type { Agent } from '@/lib/types';
import { useI18n } from '@/lib/i18n';

/** Edit an agent without leaving the page you're on. Same form as the agent workspace. */
export function AgentEditDrawer({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const { t } = useI18n();
  const { agents, colonies, refresh } = useHive();
  const toast = useToast();
  const [draft, setDraft] = useState<AgentDraft>(() => draftFromAgent(agent));
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const errors = validate(draft, agents, agent.id, colonies);
  const dirty = JSON.stringify(draftFromAgent(agent)) !== JSON.stringify(draft);

  const save = async () => {
    setShow(true);
    if (Object.keys(errors).length) { toast(t('edit.fixFields'), 'err'); return; }
    setSaving(true);
    try {
      const { type_id: _t, ...patch } = draft; void _t;
      await api.patch(`/agents/${agent.id}`, patch);
      await refresh(['agents', 'colonies']);
      toast(t('edit.saved', { name: draft.name.trim() })); onClose();
    } catch (e) { toast(e instanceof Error ? e.message : t('edit.saveFailed'), 'err'); setSaving(false); }
  };

  return (
    <Drawer title={t('edit.title', { name: agent.name })} subtitle={agent.status === 'running' ? t('edit.subtitleRunning') : t('edit.subtitleIdle')} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={!dirty || saving} onClick={save}>{saving ? t('common.saving') : t('common.saveChanges')}</button></>}>
      <AgentForm draft={draft} onChange={setDraft} errors={show ? errors : {}} selfId={agent.id} />
    </Drawer>
  );
}
