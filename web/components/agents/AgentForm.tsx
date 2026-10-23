'use client';
import { useMemo, useState } from 'react';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { useI18n, translate as tr, type MessageKey } from '@/lib/i18n/index';
import { fmtNum } from '@/lib/format';
import { EffortField, Field, FolderPicker, ModelField, PermissionField, ProviderPicker, Segmented, SkillPicker } from '@/components/ui';
import { useHiveData } from '@/lib/store';
import { MemberPick } from './MemberPick';
import type { Agent, AgentType, Colony, InheritField, Permission, Provider, Role, SkillLoad } from '@/lib/types';
import { NO_VALUE, defaultModel, permissionLabel, shortPath } from '@/lib/meta';
import { PickSearch } from '@/components/PickSearch';
import { CheckRow } from '@/components/Primitives';
import { MANAGEABLE } from '@/components/objects/ManagerField';

export interface AgentDraft {
  name: string; description: string; role: Role; provider: Provider; model: string; effort: string;
  system_prompt: string; permission: Permission; cwd: string; skill_ids: string[]; skill_loads: Record<string, SkillLoad>; worker_ids: string[]; type_id: string | null;
  colony_id: string | null; overrides: InheritField[];
  /** Claude only: the agent may drive the person's Chrome. */
  browser: boolean;
  /** The resources (servers, containers, clusters) this agent looks after: kept here, saved apart from the agent. */
  object_ids: string[];
}

export const draftFromType = (t?: AgentType): AgentDraft => ({
  name: '', description: t?.description ?? '', role: t?.role ?? 'worker', provider: t?.provider ?? 'claude', model: t ? t.model || defaultModel(t.provider) : '', effort: t?.effort ?? '',
  system_prompt: t?.system_prompt ?? '', permission: t?.permission ?? 'acceptEdits', cwd: '', skill_ids: t?.skill_ids ?? [], skill_loads: t?.skill_loads ?? {}, worker_ids: [], type_id: t?.id ?? null, colony_id: null, overrides: [], browser: false, object_ids: [],
});
/** Editing a type: its stored values with its name. The type's id stays with the caller, not in the draft. */
export const draftFromTypeRecord = (t?: AgentType): AgentDraft => ({ ...draftFromType(t), name: t?.name ?? '', type_id: null });
export const draftFromAgent = (a: Agent, objectIds: string[] = []): AgentDraft => ({
  name: a.name, description: a.description, role: a.role, provider: a.provider, model: a.model, effort: a.effort ?? '', system_prompt: a.system_prompt,
  permission: a.permission, cwd: a.cwd, skill_ids: a.skill_ids, skill_loads: a.skill_loads, worker_ids: a.worker_ids, type_id: a.type_id,
  colony_id: a.colony_id, overrides: a.overrides, browser: a.browser, object_ids: objectIds,
});

/** What an agent type stores: the only fields its create and update requests carry. */
export const TYPE_FIELDS = ['name', 'description', 'role', 'provider', 'model', 'effort', 'system_prompt', 'permission', 'skill_ids', 'skill_loads'] as const satisfies readonly (keyof AgentDraft)[];
export type TypePayload = Pick<AgentDraft, (typeof TYPE_FIELDS)[number]>;
export const typePayload = (d: AgentDraft): TypePayload => Object.fromEntries(TYPE_FIELDS.map((k) => [k, d[k]])) as TypePayload;

/** True when this field currently follows the agent's colony. */
export const follows = (d: AgentDraft, colony: Colony | undefined, f: InheritField) => !!colony && colony.inherit[f] && !d.overrides.includes(f);

export function validate(d: AgentDraft, agents: Agent[], selfId?: string, colonies: Colony[] = []) {
  const e: Partial<Record<keyof AgentDraft, string>> = {};
  if (!d.name.trim()) e.name = tr('form.err.name');
  else if (agents.some((a) => a.id !== selfId && a.name.toLowerCase() === d.name.trim().toLowerCase())) e.name = tr('form.err.nameTaken');
  const col = colonies.find((c) => c.id === d.colony_id);
  if (!d.cwd.trim() && !(follows(d, col, 'cwd') && col?.cwd)) e.cwd = tr('form.err.folder');
  return e;
}

type FormMode = 'agent' | 'type';

/** The words that differ between the two modes; `undefined` where that mode shows nothing. */
const TEXTS: Record<FormMode, {
  namePlaceholder: MessageKey; nameHint?: MessageKey; purpose: MessageKey; purposeHint: MessageKey; purposePlaceholder?: MessageKey;
  roleHint?: Record<Role, MessageKey>; promptCount: MessageKey; promptPlaceholder?: MessageKey; promptHeight: number; promptView?: 'write'; skillsHint?: MessageKey;
}> = {
  agent: {
    namePlaceholder: 'form.name.placeholder', nameHint: 'form.name.hint', purpose: 'form.purpose', purposeHint: 'form.purpose.hint', purposePlaceholder: 'form.purpose.placeholder',
    roleHint: { orchestrator: 'form.role.orchestratorHint', worker: 'form.role.workerHint' }, promptCount: 'form.promptHint', promptPlaceholder: 'form.prompt.placeholder', promptHeight: 220, promptView: 'write', skillsHint: 'form.skills.hint',
  },
  type: { namePlaceholder: 'types.name.placeholder', purpose: 'types.description', purposeHint: 'types.description.hint', promptCount: 'types.chars', promptHeight: 260 },
};

/**
 * One form for creating and editing: the same fields wherever an agent or an agent type is configured.
 * `mode="type"` is the agent types screen. Rule: a field a type does not store (see TYPE_FIELDS) goes under `!isType`.
 */
export function AgentForm({ draft, onChange, errors, selfId, showType = true, focusName = false, mode = 'agent' }: {
  draft: AgentDraft; onChange: (d: AgentDraft) => void; errors: ReturnType<typeof validate>; selfId?: string; showType?: boolean; focusName?: boolean; mode?: FormMode;
}) {
  const { t } = useI18n();
  const { skills, providers, agents, types, colonies, connections, objects } = useHiveData();
  const resources = useMemo(() => objects.filter((o) => MANAGEABLE.includes(o.kind)).map((o) => ({ id: o.id, label: o.name, hint: o.manager_id && o.manager_id !== selfId ? t('form.resources.taken', { name: agents.find((a) => a.id === o.manager_id)?.name ?? '' }) : colonies.find((c) => c.id === o.colony_id)?.name ?? t('common.noColony') })), [objects, agents, colonies, selfId, t]);
  const linked = useMemo(() => connections.filter((c) => c.agent_id === selfId && c.enabled), [connections, selfId]);
  const colony = colonies.find((c) => c.id === draft.colony_id);
  const inh = (f: InheritField) => follows(draft, colony, f);
  const toggle = (f: InheritField, on: boolean) => onChange({ ...draft, overrides: on ? draft.overrides.filter((x) => x !== f) : [...new Set([...draft.overrides, f])] });
  const set = <K extends keyof AgentDraft>(k: K, v: AgentDraft[K]) => onChange({ ...draft, [k]: v });
  const candidates = useMemo(() => agents.filter((a) => a.id !== selfId && a.role === 'worker'), [agents, selfId]);
  const type = types.find((ty) => ty.id === draft.type_id);
  const isType = mode === 'type';
  const tx = TEXTS[mode];
  const opt = (k?: MessageKey) => (k ? t(k) : undefined);

  return (
    <>
      <Field label={t('form.name')} error={errors.name} hint={opt(tx.nameHint)}>
        <input className="input" value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder={t(tx.namePlaceholder)} data-autofocus={focusName ? '' : undefined} />
      </Field>
      <Field label={t(tx.purpose)} hint={t(tx.purposeHint)}>
        <input className="input" value={draft.description} onChange={(e) => set('description', e.target.value)} placeholder={opt(tx.purposePlaceholder)} />
      </Field>
      <Field label={t('form.role')}>
        <Segmented value={draft.role} onChange={(v) => set('role', v)} options={[{ id: 'worker', label: t('role.worker') }, { id: 'orchestrator', label: t('role.orchestrator') }]} />
        {tx.roleHint && <span className="hint">{t(tx.roleHint[draft.role])}</span>}
      </Field>
      {!isType && showType && type && <p className="hint m0">{t('form.basedOn', { name: type.name })}</p>}
      {!isType && (
        <Field label={t('form.colony')} hint={t('form.colony.hint')}>
          <select className="select" value={draft.colony_id ?? ''} onChange={(e) => onChange({ ...draft, colony_id: e.target.value || null, overrides: [] })}>
            <option value="">{t('common.noColony')}</option>
            {colonies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      )}
      <Field label={t('form.provider')}><ProviderPicker value={draft.provider} onChange={(p) => onChange({ ...draft, provider: p, model: defaultModel(p), effort: '', browser: p === 'claude' && draft.browser })} providers={providers} /></Field>
      <ModelField provider={draft.provider} value={draft.model} onChange={(v) => set('model', v)} />
      <EffortField provider={draft.provider} model={draft.model} value={draft.effort} onChange={(v) => set('effort', v)} />
      {!isType && draft.provider === 'claude' && <CheckRow checked={draft.browser} onChange={(v) => set('browser', v)} label={t('form.browser')} hint={t('form.browser.hint')} />}
      {colony && colony.inherit.permission && <InheritRow colony={colony} on={inh('permission')} onChange={(v) => toggle('permission', v)} label={t('inherit.permissions')} value={permissionLabel(colony.permission)} />}
      {!inh('permission') && <PermissionField value={draft.permission} onChange={(v) => set('permission', v)} locked={linked.length ? ['plan'] : []} />}
      {!isType && linked.length > 0 && <p className="hint m0"><b>{t('form.connections')}:</b> {t('form.connections.hint', { names: linked.map((c) => c.name).join(', ') })}</p>}
      {colony && colony.inherit.cwd && colony.cwd && <InheritRow colony={colony} on={inh('cwd')} onChange={(v) => toggle('cwd', v)} label={t('field.folder')} value={shortPath(colony.cwd)} mono />}
      {!isType && !(inh('cwd') && colony?.cwd) && <FolderPicker value={draft.cwd} onChange={(v) => set('cwd', v)} error={errors.cwd} />}
      {colony && colony.inherit.prompt && colony.system_prompt.trim() && (
        <InheritRow colony={colony} on={inh('prompt')} onChange={(v) => toggle('prompt', v)} label={t('inherit.context')} value={`${colony.system_prompt.trim().slice(0, 90)}${colony.system_prompt.trim().length > 90 ? '…' : ''}`} note={t('inherit.context.note')} />
      )}
      <Field label={inh('prompt') || colony?.system_prompt ? t('form.ownPrompt') : t('form.systemPrompt')} hint={t(tx.promptCount, { count: draft.system_prompt.length, n: fmtNum(draft.system_prompt.length) })}>
        <MarkdownEditor value={draft.system_prompt} onChange={(v) => set('system_prompt', v)} placeholder={opt(tx.promptPlaceholder)} defaultView={tx.promptView} minHeight={tx.promptHeight} />
      </Field>
      {colony && colony.inherit.skills && colony.skill_ids.length > 0 && (
        <InheritRow colony={colony} on={inh('skills')} onChange={(v) => toggle('skills', v)} label={t('inherit.skills')} value={colony.skill_ids.map((id) => skills.find((s) => s.id === id)?.name).filter(Boolean).join(', ')} note={t('inherit.skills.note')} />
      )}
      <Field label={t('form.skills')} hint={opt(tx.skillsHint)}>
        <SkillPicker skills={skills} value={draft.skill_ids} loads={draft.skill_loads} onChange={(ids, loads) => onChange({ ...draft, skill_ids: ids, skill_loads: loads })} />
      </Field>
      {!isType && resources.length > 0 && (
        <Field label={t('form.resources')} hint={t('form.resources.hint')}>
          <PickSearch multi options={resources} value={draft.object_ids} onChange={(ids) => onChange({ ...draft, object_ids: ids })} placeholder={t('form.resources.placeholder')} empty={t('form.resources.empty')} ariaLabel={t('form.resources')} />
        </Field>
      )}
      {!isType && draft.role === 'orchestrator' && (
        <Field label={t('form.team')} hint={t('form.team.hint')}>
          {candidates.length ? (
            <MemberPick items={candidates.map((w) => ({ id: w.id, name: w.name, note: w.description || w.provider }))} value={draft.worker_ids} onChange={(ids) => set('worker_ids', ids)} />
          ) : <p className="hint">{t('form.team.empty')}</p>}
        </Field>
      )}
    </>
  );
}

/** One inherited field: shows what the colony provides and lets this agent opt out. */
function InheritRow({ colony, on, onChange, label, value, note, mono }: { colony: Colony; on: boolean; onChange: (v: boolean) => void; label: string; value: string; note?: string; mono?: boolean }) {
  const { t } = useI18n();
  return (
    <label className={`inherit-row ${on ? 'on' : ''}`}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className="grow">
        <b>{label} <span className="muted fw-500">{t('inherit.from')}</span> <i className="cdot" style={{ background: colony.color || 'var(--honey)' }} />{colony.name}</b>
        <span className={`inh-val ${mono ? 'mono' : ''}`}>{value || NO_VALUE}</span>
        {note && <span className="hint">{note}</span>}
      </span>
      <span className="inh-state">{on ? t('inherit.following') : t('inherit.own')}</span>
    </label>
  );
}
