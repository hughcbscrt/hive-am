'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer, Hex, useToast } from './ui';
import { AgentForm, draftFromType, validate, type AgentDraft } from './AgentForm';
import { useHive } from '@/lib/store';
import { api } from '@/lib/api';
import { PROVIDERS } from '@/lib/meta';
import type { Agent } from '@/lib/types';

/** Step 1: start from a type (or blank). Step 2: fill in the details. */
export function NewAgentDrawer({ onClose, onCreated, presetTypeId, presetColonyId }: { onClose: () => void; onCreated?: (id: string) => void; presetTypeId?: string; presetColonyId?: string }) {
  const { types, agents, refresh, colonies } = useHive();
  const toast = useToast();
  const router = useRouter();
  const [step, setStep] = useState<'type' | 'form'>(presetTypeId ? 'form' : 'type');
  const [draft, setDraft] = useState<AgentDraft>({ ...draftFromType(types.find((t) => t.id === presetTypeId)), colony_id: presetColonyId ?? null });
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const errors = validate(draft, agents, undefined, colonies);

  const create = async () => {
    setShow(true);
    if (Object.keys(errors).length) return;
    setBusy(true);
    try {
      const a = await api.post<Agent>('/agents', draft);
      await refresh(['agents', 'colonies']);
      toast(`${a.name} created`);
      onCreated?.(a.id); onClose(); router.push(`/agents/${a.id}`);
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not create the agent', 'err'); setBusy(false); }
  };

  if (step === 'type') {
    return (
      <Drawer title="New agent" subtitle="Start from a type to prefill provider, model, prompt and skills." onClose={onClose}>
        <div className="col" style={{ gap: 10 }}>
          {types.map((t) => (
            <button key={t.id} className="card card-pad row gap-l" style={{ textAlign: 'left' }} onClick={() => { setDraft({ ...draftFromType(t), colony_id: presetColonyId ?? null }); setStep('form'); }}>
              <Hex color={PROVIDERS[t.provider].color} queen={t.role === 'orchestrator'} label={t.name.slice(0, 2).toUpperCase()} />
              <div className="grow"><b style={{ fontFamily: 'var(--font-display)', fontSize: 16 }}>{t.name}</b><div className="muted small">{t.description || `${t.role} on ${PROVIDERS[t.provider].label}`}</div></div>
              <span className="chip">{PROVIDERS[t.provider].short}</span>
            </button>
          ))}
          <button className="card card-pad row gap-l" style={{ textAlign: 'left', borderStyle: 'dashed' }} onClick={() => { setDraft({ ...draftFromType(), colony_id: presetColonyId ?? null }); setStep('form'); }}>
            <Hex color="var(--muted)" label="+" /><div className="grow"><b style={{ fontFamily: 'var(--font-display)', fontSize: 16 }}>Blank agent</b><div className="muted small">Configure everything yourself.</div></div>
          </button>
        </div>
      </Drawer>
    );
  }
  return (
    <Drawer title="New agent" subtitle={draft.type_id ? `From type “${types.find((t) => t.id === draft.type_id)?.name}”` : 'Blank agent'} onClose={onClose}
      footer={<>{!presetTypeId && <button className="btn ghost" onClick={() => setStep('type')}>Back</button>}<button className="btn primary" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create agent'}</button></>}>
      <AgentForm draft={draft} onChange={setDraft} errors={show ? errors : {}} focusName />
    </Drawer>
  );
}
