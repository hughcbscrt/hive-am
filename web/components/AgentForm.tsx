'use client';
import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { Field, FolderPicker, ModelField, PermissionField, ProviderPicker, Segmented, SkillPicker } from './ui';
import { useHive } from '@/lib/store';
import type { Agent, AgentType, Colony, InheritField, Permission, Provider, Role } from '@/lib/types';
import { PERMISSIONS, shortPath } from '@/lib/meta';

export interface AgentDraft {
  name: string; description: string; role: Role; provider: Provider; model: string;
  system_prompt: string; permission: Permission; cwd: string; skill_ids: string[]; worker_ids: string[]; type_id: string | null;
  colony_id: string | null; overrides: InheritField[];
}

export const draftFromType = (t?: AgentType): AgentDraft => ({
  name: '', description: t?.description ?? '', role: t?.role ?? 'worker', provider: t?.provider ?? 'claude', model: t?.model ?? '',
  system_prompt: t?.system_prompt ?? '', permission: t?.permission ?? 'acceptEdits', cwd: '', skill_ids: t?.skill_ids ?? [], worker_ids: [], type_id: t?.id ?? null, colony_id: null, overrides: [],
});
export const draftFromAgent = (a: Agent): AgentDraft => ({
  name: a.name, description: a.description, role: a.role, provider: a.provider, model: a.model, system_prompt: a.system_prompt,
  permission: a.permission, cwd: a.cwd, skill_ids: a.skill_ids, worker_ids: a.worker_ids, type_id: a.type_id,
  colony_id: a.colony_id, overrides: a.overrides,
});

/** True when this field currently follows the agent's colony. */
export const follows = (d: AgentDraft, colony: Colony | undefined, f: InheritField) => !!colony && colony.inherit[f] && !d.overrides.includes(f);

export function validate(d: AgentDraft, agents: Agent[], selfId?: string, colonies: Colony[] = []) {
  const e: Partial<Record<keyof AgentDraft, string>> = {};
  if (!d.name.trim()) e.name = 'Give the agent a name.';
  else if (agents.some((a) => a.id !== selfId && a.name.toLowerCase() === d.name.trim().toLowerCase())) e.name = 'Another agent already uses this name.';
  const col = colonies.find((c) => c.id === d.colony_id);
  if (!d.cwd.trim() && !(follows(d, col, 'cwd') && col?.cwd)) e.cwd = 'Choose the folder this agent works in.';
  return e;
}

/** One form for creating and editing — the same fields wherever an agent is configured. */
export function AgentForm({ draft, onChange, errors, selfId, showType = true, focusName = false }: {
  draft: AgentDraft; onChange: (d: AgentDraft) => void; errors: ReturnType<typeof validate>; selfId?: string; showType?: boolean; focusName?: boolean;
}) {
  const { skills, providers, agents, types, colonies } = useHive();
  const colony = colonies.find((c) => c.id === draft.colony_id);
  const inh = (f: InheritField) => follows(draft, colony, f);
  const toggle = (f: InheritField, on: boolean) => onChange({ ...draft, overrides: on ? draft.overrides.filter((x) => x !== f) : [...new Set([...draft.overrides, f])] });
  const set = <K extends keyof AgentDraft>(k: K, v: AgentDraft[K]) => onChange({ ...draft, [k]: v });
  const candidates = useMemo(() => agents.filter((a) => a.id !== selfId && a.role === 'worker'), [agents, selfId]);
  const type = types.find((t) => t.id === draft.type_id);

  return (
    <>
      <Field label="Name" error={errors.name} hint="Orchestrators address workers by this name, so keep it short and distinct.">
        <input className="input" value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. api-builder" autoFocus={focusName} />
      </Field>
      <Field label="What is it for?" hint="One line. Orchestrators read this to decide who gets which task.">
        <input className="input" value={draft.description} onChange={(e) => set('description', e.target.value)} placeholder="Implements backend endpoints and their tests" />
      </Field>
      <Field label="Role">
        <Segmented value={draft.role} onChange={(v) => set('role', v)} options={[{ id: 'worker', label: 'Worker' }, { id: 'orchestrator', label: 'Orchestrator' }]} />
        <span className="hint">{draft.role === 'orchestrator' ? 'Plans work and delegates it to the workers assigned to it.' : 'Does the work it is given — directly from you or from an orchestrator.'}</span>
      </Field>
      {showType && type && <p className="hint" style={{ margin: 0 }}>Based on the <b>{type.name}</b> type. Changes here only affect this agent.</p>}
      <Field label="Colony" hint="Agents in a colony can follow its folder, permissions, skills and shared context. Provider and model are always set per agent.">
        <select className="select" value={draft.colony_id ?? ''} onChange={(e) => onChange({ ...draft, colony_id: e.target.value || null, overrides: [] })}>
          <option value="">No colony</option>
          {colonies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Provider"><ProviderPicker value={draft.provider} onChange={(p) => onChange({ ...draft, provider: p, model: '' })} providers={providers} /></Field>
      <ModelField provider={draft.provider} value={draft.model} onChange={(v) => set('model', v)} />
      {colony && colony.inherit.permission && <InheritRow colony={colony} on={inh('permission')} onChange={(v) => toggle('permission', v)} label="Permissions" value={PERMISSIONS.find((p) => p.id === colony.permission)?.label ?? colony.permission} />}
      {!inh('permission') && <PermissionField value={draft.permission} onChange={(v) => set('permission', v)} />}
      {colony && colony.inherit.cwd && colony.cwd && <InheritRow colony={colony} on={inh('cwd')} onChange={(v) => toggle('cwd', v)} label="Working folder" value={shortPath(colony.cwd)} mono />}
      {!(inh('cwd') && colony?.cwd) && <FolderPicker value={draft.cwd} onChange={(v) => set('cwd', v)} error={errors.cwd} />}
      {colony && colony.inherit.prompt && colony.system_prompt.trim() && (
        <InheritRow colony={colony} on={inh('prompt')} onChange={(v) => toggle('prompt', v)} label="Shared context" value={`${colony.system_prompt.trim().slice(0, 90)}${colony.system_prompt.trim().length > 90 ? '…' : ''}`} note="Placed before this agent’s own prompt." />
      )}
      <Field label={inh('prompt') || colony?.system_prompt ? 'Agent’s own system prompt' : 'System prompt'} hint={`${draft.system_prompt.length.toLocaleString()} characters. Added to the CLI’s own instructions on every turn.`}>
        <textarea className="textarea mono" rows={9} value={draft.system_prompt} onChange={(e) => set('system_prompt', e.target.value)} placeholder="You are a careful backend engineer. Always run the tests before reporting back." spellCheck={false} />
      </Field>
      {colony && colony.inherit.skills && colony.skill_ids.length > 0 && (
        <InheritRow colony={colony} on={inh('skills')} onChange={(v) => toggle('skills', v)} label="Colony skills" value={colony.skill_ids.map((id) => skills.find((s) => s.id === id)?.name).filter(Boolean).join(', ')} note="Added on top of this agent’s own skills." />
      )}
      <Field label="Skills" hint="Appended to the system prompt in the order shown.">
        <SkillPicker skills={skills} value={draft.skill_ids} onChange={(v) => set('skill_ids', v)} />
      </Field>
      {draft.role === 'orchestrator' && (
        <Field label="Team" hint="Only these workers can receive tasks from this orchestrator.">
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
          ) : <p className="hint">No workers yet. Create a worker agent, then assign it here or on the Relations canvas.</p>}
        </Field>
      )}
    </>
  );
}

/** One inherited field: shows what the colony provides and lets this agent opt out. */
function InheritRow({ colony, on, onChange, label, value, note, mono }: { colony: Colony; on: boolean; onChange: (v: boolean) => void; label: string; value: string; note?: string; mono?: boolean }) {
  return (
    <label className={`inherit-row ${on ? 'on' : ''}`}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className="grow">
        <b>{label} <span className="muted" style={{ fontWeight: 500 }}>from</span> <i className="cdot" style={{ background: colony.color || 'var(--honey)' }} />{colony.name}</b>
        <span className={`inh-val ${mono ? 'mono' : ''}`}>{value || '—'}</span>
        {note && <span className="hint">{note}</span>}
      </span>
      <span className="inh-state">{on ? 'Following' : 'Own value'}</span>
    </label>
  );
}
