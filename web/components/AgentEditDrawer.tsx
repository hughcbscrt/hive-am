'use client';
import { useState } from 'react';
import { Drawer, useToast } from './ui';
import { AgentForm, draftFromAgent, validate, type AgentDraft } from './AgentForm';
import { useHive } from '@/lib/store';
import { api } from '@/lib/api';
import type { Agent } from '@/lib/types';

/** Edit an agent without leaving the page you're on. Same form as the agent workspace. */
export function AgentEditDrawer({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const { agents, colonies, refresh } = useHive();
  const toast = useToast();
  const [draft, setDraft] = useState<AgentDraft>(() => draftFromAgent(agent));
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const errors = validate(draft, agents, agent.id, colonies);
  const dirty = JSON.stringify(draftFromAgent(agent)) !== JSON.stringify(draft);

  const save = async () => {
    setShow(true);
    if (Object.keys(errors).length) { toast('Fix the highlighted fields first', 'err'); return; }
    setSaving(true);
    try {
      const { type_id: _t, ...patch } = draft; void _t;
      await api.patch(`/agents/${agent.id}`, patch);
      await refresh(['agents', 'colonies']);
      toast(`${draft.name.trim()} saved`); onClose();
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not save', 'err'); setSaving(false); }
  };

  return (
    <Drawer title={`${agent.name} settings`} subtitle={agent.status === 'running' ? 'This agent is working — changes apply from its next turn.' : 'Changes apply from its next message.'} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button></>}>
      <AgentForm draft={draft} onChange={setDraft} errors={show ? errors : {}} selfId={agent.id} />
    </Drawer>
  );
}
