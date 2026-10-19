'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog, Drawer, Hex, useToast } from '@/components/ui';
import { AgentForm, draftFromType, validate, type AgentDraft } from './AgentForm';
import { useHiveData } from '@/lib/store';
import { useUnsavedGuard } from '@/lib/hooks/useUnsavedGuard';
import { api } from '@/lib/api';
import { PROVIDERS } from '@/lib/meta';
import { useI18n } from '@/lib/i18n/index';
import type { Agent } from '@/lib/types';

/** The skill that gives an agent the tools to look after objects (seeded by the server). */
export const OBJECTS_SKILL_ID = 'default-objects';
/** The skill that gives an agent the tools to look inside the database resources of its colony and run SQL. */
export const DATABASES_SKILL_ID = 'default-databases';

/** Step 1: start from a type (or blank). Step 2: fill in the details. */
/** `manager`: an agent that looks after the objects of a colony (it starts with the "Colony resources" skill, and edit permission so it can start and stop them). */
export function NewAgentDrawer({ onClose, onCreated, presetTypeId, presetColonyId, presetObjectId, manager = false }: { onClose: () => void; onCreated?: (id: string) => void; presetTypeId?: string; presetColonyId?: string; presetObjectId?: string; manager?: boolean }) {
  const { t } = useI18n();
  const { types, agents, refresh, colonies, objects } = useHiveData();
  const toast = useToast();
  const router = useRouter();
  const [step, setStep] = useState<'type' | 'form'>(presetTypeId || manager ? 'form' : 'type');
  const [draft, setDraft] = useState<AgentDraft>(() => {
    const base = { ...draftFromType(types.find((ty) => ty.id === presetTypeId)), colony_id: presetColonyId ?? null, object_ids: presetObjectId ? [presetObjectId] : [] };
    const skill = objects.find((o) => o.id === presetObjectId)?.kind === 'database' ? DATABASES_SKILL_ID : OBJECTS_SKILL_ID;
    return manager ? { ...base, description: t(skill === DATABASES_SKILL_ID ? 'obj.manager.description.db' : 'obj.manager.description'), permission: 'acceptEdits', skill_ids: [...new Set([...base.skill_ids, skill])], skill_loads: { ...base.skill_loads, [skill]: 'always' } } : base;
  });
  // What the form starts with: picking a type fills it in, and that is not an edit of the person's own.
  const [initial, setInitial] = useState(() => JSON.stringify(draft));
  const begin = (d: AgentDraft) => { setDraft(d); setInitial(JSON.stringify(d)); setStep('form'); };
  const done = useRef(false);
  const dirty = JSON.stringify(draft) !== initial;
  useUnsavedGuard(dirty && !done.current);
  const [askClose, setAskClose] = useState(false);
  const close = () => { if (!dirty || done.current) onClose(); else setAskClose(true); };
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const errors = validate(draft, agents, undefined, colonies);

  const create = async () => {
    setShow(true);
    if (Object.keys(errors).length) return;
    setBusy(true);
    try {
      const { object_ids, ...body } = draft;
      const a = await api.post<Agent>('/agents', body);
      if (object_ids.length) await api.put(`/agents/${a.id}/resources`, { object_ids }).catch((e) => toast(e instanceof Error ? e.message : '', 'err'));
      await refresh(['agents', 'colonies', 'objects']);
      toast(t('newAgent.created', { name: a.name }));
      done.current = true; onCreated?.(a.id); onClose(); router.push(`/agents/${a.id}`);
    } catch (e) { toast(e instanceof Error ? e.message : t('newAgent.failed'), 'err'); setBusy(false); }
  };

  if (step === 'type') {
    return (
      <Drawer key="type" title={t('newAgent.title')} subtitle={t('newAgent.pickType')} onClose={onClose}>
        <div className="col gap-m">
          {types.map((ty) => (
            <button key={ty.id} className="card card-pad row gap-l cx-typecard" onClick={() => { begin({ ...draftFromType(ty), colony_id: presetColonyId ?? null, object_ids: presetObjectId ? [presetObjectId] : [] }); }}>
              <Hex color={PROVIDERS[ty.provider].color} queen={ty.role === 'orchestrator'} label={ty.name.slice(0, 2).toUpperCase()} />
              <div className="grow"><b className="cx-pick-title">{ty.name}</b><div className="muted small">{ty.description || t('newAgent.typeFallback', { role: t(`role.${ty.role}`), provider: PROVIDERS[ty.provider].label })}</div></div>
              <span className="chip">{PROVIDERS[ty.provider].short}</span>
            </button>
          ))}
          <button className="card card-pad row gap-l cx-typecard blank" onClick={() => { begin({ ...draftFromType(), colony_id: presetColonyId ?? null, object_ids: presetObjectId ? [presetObjectId] : [] }); }}>
            <Hex color="var(--muted)" label="+" /><div className="grow"><b className="cx-pick-title">{t('newAgent.blank')}</b><div className="muted small">{t('newAgent.blankHint')}</div></div>
          </button>
        </div>
      </Drawer>
    );
  }
  return (
    <>
    <Drawer key="form" title={t('newAgent.title')} subtitle={manager ? t('obj.manager.subtitle') : draft.type_id ? t('newAgent.fromType', { name: types.find((ty) => ty.id === draft.type_id)?.name ?? '' }) : t('newAgent.blank')} onClose={close}
      footer={<>{!presetTypeId && !manager && <button className="btn ghost" onClick={() => setStep('type')}>{t('common.back')}</button>}<button className="btn primary" disabled={busy} onClick={create}>{busy ? t('newAgent.creating') : t('newAgent.create')}</button></>}>
      <AgentForm draft={draft} onChange={setDraft} errors={show ? errors : {}} focusName />
    </Drawer>
    {askClose && <ConfirmDialog danger title={t('fa.unsaved.title')} body={t('fa.unsaved.body')} confirmLabel={t('fa.unsaved.discard')} cancelLabel={t('fa.unsaved.keep')} onClose={() => setAskClose(false)} onConfirm={onClose} />}
    </>
  );
}
