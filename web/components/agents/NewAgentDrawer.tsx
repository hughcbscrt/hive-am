'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer, Hex, useToast } from '@/components/ui';
import { AgentForm, draftFromType, validate, type AgentDraft } from './AgentForm';
import { useHive } from '@/lib/store';
import { api } from '@/lib/api';
import { PROVIDERS } from '@/lib/meta';
import { useI18n } from '@/lib/i18n/index';
import type { Agent } from '@/lib/types';

/** The skill that gives an agent the tools to look after objects (seeded by the server). */
export const OBJECTS_SKILL_ID = 'default-objects';

/** Step 1: start from a type (or blank). Step 2: fill in the details. */
/** `manager`: an agent that looks after the objects of a colony (it starts with the "Colony objects" skill, and edit permission so it can start and stop them). */
export function NewAgentDrawer({ onClose, onCreated, presetTypeId, presetColonyId, manager = false }: { onClose: () => void; onCreated?: (id: string) => void; presetTypeId?: string; presetColonyId?: string; manager?: boolean }) {
  const { t } = useI18n();
  const { types, agents, refresh, colonies } = useHive();
  const toast = useToast();
  const router = useRouter();
  const [step, setStep] = useState<'type' | 'form'>(presetTypeId || manager ? 'form' : 'type');
  const [draft, setDraft] = useState<AgentDraft>(() => {
    const base = { ...draftFromType(types.find((ty) => ty.id === presetTypeId)), colony_id: presetColonyId ?? null };
    return manager ? { ...base, description: t('obj.manager.description'), permission: 'acceptEdits', skill_ids: [...new Set([...base.skill_ids, OBJECTS_SKILL_ID])], skill_loads: { ...base.skill_loads, [OBJECTS_SKILL_ID]: 'always' } } : base;
  });
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
    <Drawer title={t('newAgent.title')} subtitle={manager ? t('obj.manager.subtitle') : draft.type_id ? t('newAgent.fromType', { name: types.find((ty) => ty.id === draft.type_id)?.name ?? '' }) : t('newAgent.blank')} onClose={onClose}
      footer={<>{!presetTypeId && !manager && <button className="btn ghost" onClick={() => setStep('type')}>{t('common.back')}</button>}<button className="btn primary" disabled={busy} onClick={create}>{busy ? t('newAgent.creating') : t('newAgent.create')}</button></>}>
      <AgentForm draft={draft} onChange={setDraft} errors={show ? errors : {}} focusName />
    </Drawer>
  );
}
