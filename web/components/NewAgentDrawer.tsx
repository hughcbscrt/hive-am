'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer, Hex, useToast } from './ui';
import { AgentForm, draftFromType, validate, type AgentDraft } from './AgentForm';
import { useHive } from '@/lib/store';
import { api } from '@/lib/api';
import { PROVIDERS } from '@/lib/meta';
import { useI18n } from '@/lib/i18n';
import type { Agent } from '@/lib/types';

/** Step 1: start from a type (or blank). Step 2: fill in the details. */
export function NewAgentDrawer({ onClose, onCreated, presetTypeId, presetColonyId }: { onClose: () => void; onCreated?: (id: string) => void; presetTypeId?: string; presetColonyId?: string }) {
  const { t } = useI18n();
  const { types, agents, refresh, colonies } = useHive();
  const toast = useToast();
  const router = useRouter();
  const [step, setStep] = useState<'type' | 'form'>(presetTypeId ? 'form' : 'type');
  const [draft, setDraft] = useState<AgentDraft>({ ...draftFromType(types.find((ty) => ty.id === presetTypeId)), colony_id: presetColonyId ?? null });
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
      toast(t('newAgent.created', { name: a.name }));
      onCreated?.(a.id); onClose(); router.push(`/agents/${a.id}`);
    } catch (e) { toast(e instanceof Error ? e.message : t('newAgent.failed'), 'err'); setBusy(false); }
  };

  if (step === 'type') {
    return (
      <Drawer title={t('newAgent.title')} subtitle={t('newAgent.pickType')} onClose={onClose}>
        <div className="col" style={{ gap: 10 }}>
          {types.map((ty) => (
            <button key={ty.id} className="card card-pad row gap-l" style={{ textAlign: 'left' }} onClick={() => { setDraft({ ...draftFromType(ty), colony_id: presetColonyId ?? null }); setStep('form'); }}>
              <Hex color={PROVIDERS[ty.provider].color} queen={ty.role === 'orchestrator'} label={ty.name.slice(0, 2).toUpperCase()} />
              <div className="grow"><b style={{ fontFamily: 'var(--font-display)', fontSize: 16 }}>{ty.name}</b><div className="muted small">{ty.description || t('newAgent.typeFallback', { role: t(`role.${ty.role}`), provider: PROVIDERS[ty.provider].label })}</div></div>
              <span className="chip">{PROVIDERS[ty.provider].short}</span>
            </button>
          ))}
          <button className="card card-pad row gap-l" style={{ textAlign: 'left', borderStyle: 'dashed' }} onClick={() => { setDraft({ ...draftFromType(), colony_id: presetColonyId ?? null }); setStep('form'); }}>
            <Hex color="var(--muted)" label="+" /><div className="grow"><b style={{ fontFamily: 'var(--font-display)', fontSize: 16 }}>{t('newAgent.blank')}</b><div className="muted small">{t('newAgent.blankHint')}</div></div>
          </button>
        </div>
      </Drawer>
    );
  }
  return (
    <Drawer title={t('newAgent.title')} subtitle={draft.type_id ? t('newAgent.fromType', { name: types.find((ty) => ty.id === draft.type_id)?.name ?? '' }) : t('newAgent.blank')} onClose={onClose}
      footer={<>{!presetTypeId && <button className="btn ghost" onClick={() => setStep('type')}>{t('common.back')}</button>}<button className="btn primary" disabled={busy} onClick={create}>{busy ? t('newAgent.creating') : t('newAgent.create')}</button></>}>
      <AgentForm draft={draft} onChange={setDraft} errors={show ? errors : {}} focusName />
    </Drawer>
  );
}
