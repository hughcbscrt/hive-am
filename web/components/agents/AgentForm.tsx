'use client';
import { useMemo, useState } from 'react';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { Check } from 'lucide-react';
import { useI18n, translate as tr } from '@/lib/i18n/index';
import { fmtNum } from '@/lib/format';
import { Field, FolderPicker, ModelField, PermissionField, ProviderPicker, Segmented, SkillPicker } from '@/components/ui';
import { useHive } from '@/lib/store';
import type { Agent, AgentType, Colony, InheritField, Permission, Provider, Role, SkillLoad } from '@/lib/types';
import { permissionLabel, shortPath } from '@/lib/meta';

export interface AgentDraft {
  name: string; description: string; role: Role; provider: Provider; model: string;
  system_prompt: string; permission: Permission; cwd: string; skill_ids: string[]; skill_loads: Record<string, SkillLoad>; worker_ids: string[]; type_id: string | null;
  colony_id: string | null; overrides: InheritField[];
}

export const draftFromType = (t?: AgentType): AgentDraft => ({
  name: '', description: t?.description ?? '', role: t?.role ?? 'worker', provider: t?.provider ?? 'claude', model: t?.model ?? '',
  system_prompt: t?.system_prompt ?? '', permission: t?.permission ?? 'acceptEdits', cwd: '', skill_ids: t?.skill_ids ?? [], skill_loads: t?.skill_loads ?? {}, worker_ids: [], type_id: t?.id ?? null, colony_id: null, overrides: [],
});
export const draftFromAgent = (a: Agent): AgentDraft => ({
  name: a.name, description: a.description, role: a.role, provider: a.provider, model: a.model, system_prompt: a.system_prompt,
  permission: a.permission, cwd: a.cwd, skill_ids: a.skill_ids, skill_loads: a.skill_loads, worker_ids: a.worker_ids, type_id: a.type_id,
  colony_id: a.colony_id, overrides: a.overrides,
});

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

/** One form for creating and editing — the same fields wherever an agent is configured. */
export function AgentForm({ draft, onChange, errors, selfId, showType = true, focusName = false }: {
  draft: AgentDraft; onChange: (d: AgentDraft) => void; errors: ReturnType<typeof validate>; selfId?: string; showType?: boolean; focusName?: boolean;
}) {
  const { t } = useI18n();
  const { skills, providers, agents, types, colonies, connections } = useHive();
  const linked = useMemo(() => connections.filter((c) => c.agent_id === selfId && c.enabled), [connections, selfId]);
  const colony = colonies.find((c) => c.id === draft.colony_id);
  const inh = (f: InheritField) => follows(draft, colony, f);
  const toggle = (f: InheritField, on: boolean) => onChange({ ...draft, overrides: on ? draft.overrides.filter((x) => x !== f) : [...new Set([...draft.overrides, f])] });
  const set = <K extends keyof AgentDraft>(k: K, v: AgentDraft[K]) => onChange({ ...draft, [k]: v });
  const candidates = useMemo(() => agents.filter((a) => a.id !== selfId && a.role === 'worker'), [agents, selfId]);
  const type = types.find((ty) => ty.id === draft.type_id);

  return (
    <>
      <Field label={t('form.name')} error={errors.name} hint={t('form.name.hint')}>
        <input className="input" value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder={t('form.name.placeholder')} autoFocus={focusName} />
      </Field>
      <Field label={t('form.purpose')} hint={t('form.purpose.hint')}>
        <input className="input" value={draft.description} onChange={(e) => set('description', e.target.value)} placeholder={t('form.purpose.placeholder')} />
      </Field>
      <Field label={t('form.role')}>
        <Segmented value={draft.role} onChange={(v) => set('role', v)} options={[{ id: 'worker', label: t('role.worker') }, { id: 'orchestrator', label: t('role.orchestrator') }]} />
        <span className="hint">{draft.role === 'orchestrator' ? t('form.role.orchestratorHint') : t('form.role.workerHint')}</span>
      </Field>
      {showType && type && <p className="hint" style={{ margin: 0 }}>{t('form.basedOn', { name: type.name })}</p>}
      <Field label={t('form.colony')} hint={t('form.colony.hint')}>
        <select className="select" value={draft.colony_id ?? ''} onChange={(e) => onChange({ ...draft, colony_id: e.target.value || null, overrides: [] })}>
          <option value="">{t('common.noColony')}</option>
          {colonies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label={t('form.provider')}><ProviderPicker value={draft.provider} onChange={(p) => onChange({ ...draft, provider: p, model: '' })} providers={providers} /></Field>
      <ModelField provider={draft.provider} value={draft.model} onChange={(v) => set('model', v)} />
      {colony && colony.inherit.permission && <InheritRow colony={colony} on={inh('permission')} onChange={(v) => toggle('permission', v)} label={t('inherit.permissions')} value={permissionLabel(colony.permission)} />}
      {!inh('permission') && <PermissionField value={draft.permission} onChange={(v) => set('permission', v)} locked={linked.length ? ['plan'] : []} />}
      {linked.length > 0 && <p className="hint" style={{ margin: 0 }}><b>{t('form.connections')}:</b> {t('form.connections.hint', { names: linked.map((c) => c.name).join(', ') })}</p>}
      {colony && colony.inherit.cwd && colony.cwd && <InheritRow colony={colony} on={inh('cwd')} onChange={(v) => toggle('cwd', v)} label={t('field.folder')} value={shortPath(colony.cwd)} mono />}
      {!(inh('cwd') && colony?.cwd) && <FolderPicker value={draft.cwd} onChange={(v) => set('cwd', v)} error={errors.cwd} />}
      {colony && colony.inherit.prompt && colony.system_prompt.trim() && (
        <InheritRow colony={colony} on={inh('prompt')} onChange={(v) => toggle('prompt', v)} label={t('inherit.context')} value={`${colony.system_prompt.trim().slice(0, 90)}${colony.system_prompt.trim().length > 90 ? '…' : ''}`} note={t('inherit.context.note')} />
      )}
      <Field label={inh('prompt') || colony?.system_prompt ? t('form.ownPrompt') : t('form.systemPrompt')} hint={t('form.promptHint', { count: draft.system_prompt.length, n: fmtNum(draft.system_prompt.length) })}>
        <MarkdownEditor value={draft.system_prompt} onChange={(v) => set('system_prompt', v)} placeholder={t('form.prompt.placeholder')} defaultView="write" minHeight={220} />
      </Field>
      {colony && colony.inherit.skills && colony.skill_ids.length > 0 && (
        <InheritRow colony={colony} on={inh('skills')} onChange={(v) => toggle('skills', v)} label={t('inherit.skills')} value={colony.skill_ids.map((id) => skills.find((s) => s.id === id)?.name).filter(Boolean).join(', ')} note={t('inherit.skills.note')} />
      )}
      <Field label={t('form.skills')} hint={t('form.skills.hint')}>
        <SkillPicker skills={skills} value={draft.skill_ids} loads={draft.skill_loads} onChange={(ids, loads) => onChange({ ...draft, skill_ids: ids, skill_loads: loads })} />
      </Field>
      {draft.role === 'orchestrator' && (
        <Field label={t('form.team')} hint={t('form.team.hint')}>
          {candidates.length ? (
            <div className="skillpick">
              {candidates.map((w) => {
                const on = draft.worker_ids.includes(w.id);
                return (
                  <button key={w.id} type="button" className="skillrow" aria-pressed={on} onClick={() => set('worker_ids', on ? draft.worker_ids.filter((x) => x !== w.id) : [...draft.worker_ids, w.id])}>
                    <span className="check">{on && <Check size={13} strokeWidth={3} />}</span><span><b style={{ fontWeight: 600 }}>{w.name}</b><span className="hint" style={{ display: 'block' }}>{w.description || w.provider}</span></span>
                  </button>
                );
              })}
            </div>
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
        <b>{label} <span className="muted" style={{ fontWeight: 500 }}>{t('inherit.from')}</span> <i className="cdot" style={{ background: colony.color || 'var(--honey)' }} />{colony.name}</b>
        <span className={`inh-val ${mono ? 'mono' : ''}`}>{value || '—'}</span>
        {note && <span className="hint">{note}</span>}
      </span>
      <span className="inh-state">{on ? t('inherit.following') : t('inherit.own')}</span>
    </label>
  );
}
