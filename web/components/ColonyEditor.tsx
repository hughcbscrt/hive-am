'use client';
import { useMemo, useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { Drawer, Field, FolderPicker, Modal, PermissionField, SkillPicker, useToast } from './ui';
import { useHive } from '@/lib/store';
import { api } from '@/lib/api';
import { PERMISSIONS, shortPath } from '@/lib/meta';
import type { Colony, InheritField, InheritFlags, Permission } from '@/lib/types';

export const COLONY_COLORS = ['#2f8f5b', '#d4663f', '#2f5bea', '#7a4de0', '#c0399a', '#0f8f9e', '#9a7400', '#c2412d'];

interface Draft { name: string; color: string; cwd: string; permission: Permission; system_prompt: string; skill_ids: string[]; agent_ids: string[]; inherit: InheritFlags }

const FIELD_ROWS: { id: InheritField; label: string; hint: string }[] = [
  { id: 'cwd', label: 'Working folder', hint: 'Agents run in the colony’s folder.' },
  { id: 'permission', label: 'Permissions', hint: 'Agents get the colony’s access level.' },
  { id: 'skills', label: 'Skills', hint: 'Colony skills are added to each agent’s own.' },
  { id: 'prompt', label: 'Shared context', hint: 'The colony prompt goes before each agent’s own prompt.' },
];

export function ColonyEditor({ colony, onClose }: { colony?: Colony; onClose: () => void }) {
  const { agents, skills, colonies, refresh } = useHive();
  const toast = useToast();
  const [d, setD] = useState<Draft>(() => colony ? {
    name: colony.name, color: colony.color, cwd: colony.cwd, permission: colony.permission, system_prompt: colony.system_prompt,
    skill_ids: colony.skill_ids, agent_ids: colony.agent_ids, inherit: colony.inherit,
  } : {
    name: '', color: COLONY_COLORS[colonies.length % COLONY_COLORS.length], cwd: '', permission: 'acceptEdits', system_prompt: '', skill_ids: [], agent_ids: [],
    inherit: { cwd: true, permission: true, skills: true, prompt: true },
  });
  const [err, setErr] = useState('');
  const [asking, setAsking] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const requestSave = () => {
    if (!d.name.trim()) { setErr('Give the colony a name.'); return; }
    if (colonies.some((c) => c.id !== colony?.id && c.name.toLowerCase() === d.name.trim().toLowerCase())) { setErr('Another colony already uses this name.'); return; }
    setErr(''); setAsking(true);
  };

  const save = async (inherit: InheritFlags) => {
    setBusy(true);
    try {
      const body = { ...d, name: d.name.trim(), inherit };
      if (colony) await api.patch(`/colonies/${colony.id}`, body); else await api.post('/colonies', body);
      await refresh(['agents', 'colonies']);
      toast(colony ? 'Colony saved' : 'Colony created'); onClose();
    } catch (e) { setAsking(false); setErr(e instanceof Error ? e.message : 'Could not save'); setBusy(false); }
  };

  return (
    <>
      <Drawer title={colony ? `Edit ${colony.name}` : 'New colony'} subtitle="A group of agents drawn together on the comb, sharing defaults." onClose={onClose}
        footer={<>{colony && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => setConfirmDel(true)}><Trash2 size={15} />Delete</button>}<button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={requestSave}>{colony ? 'Save colony' : 'Create colony'}</button></>}>
        <Field label="Name" error={err}><input className="input" value={d.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Billing backend" autoFocus /></Field>
        <Field label="Color"><div className="swatches">{COLONY_COLORS.map((c) => <button key={c} type="button" className="swatch" style={{ '--c': c } as any} aria-pressed={d.color === c} aria-label={`Color ${c}`} onClick={() => set('color', c)} />)}</div></Field>
        <FolderPicker value={d.cwd} onChange={(v) => set('cwd', v)} />
        <PermissionField value={d.permission} onChange={(v) => set('permission', v)} />
        <Field label="Shared context" hint="Instructions every member sees before its own prompt.">
          <textarea className="textarea mono" rows={6} value={d.system_prompt} onChange={(e) => set('system_prompt', e.target.value)} placeholder="All services use PostgreSQL 16. Never touch the migrations folder without asking." spellCheck={false} />
        </Field>
        <Field label="Skills"><SkillPicker skills={skills} value={d.skill_ids} onChange={(v) => set('skill_ids', v)} /></Field>
        <Field label="Members" hint="An agent belongs to one colony. Picking one that’s elsewhere moves it here.">
          {agents.length === 0 ? <p className="hint">No agents yet. Create some, then add them here.</p> : (
            <div className="skillpick">
              {agents.map((a) => {
                const on = d.agent_ids.includes(a.id); const other = a.colony_id && a.colony_id !== colony?.id ? colonies.find((c) => c.id === a.colony_id) : null;
                return (
                  <button key={a.id} type="button" className="skillrow" aria-pressed={on} onClick={() => set('agent_ids', on ? d.agent_ids.filter((x) => x !== a.id) : [...d.agent_ids, a.id])}>
                    <span className="check">{on && <Check size={13} strokeWidth={3} />}</span>
                    <span><b style={{ fontWeight: 600 }}>{a.name}</b><span className="hint" style={{ display: 'block' }}>{other ? `Currently in ${other.name}` : a.description || (a.role === 'orchestrator' ? 'Orchestrator' : 'Worker')}</span></span>
                  </button>
                );
              })}
            </div>
          )}
        </Field>
      </Drawer>

      {asking && (
        <InheritAsk draft={d} colony={colony} members={agents.filter((a) => d.agent_ids.includes(a.id))} busy={busy} onBack={() => setAsking(false)} onConfirm={save} />
      )}
      {confirmDel && colony && (
        <Modal title={`Delete ${colony.name}?`} onClose={() => setConfirmDel(false)}>
          <p style={{ margin: 0 }} className="muted">Its {colony.agent_ids.length} agents stay, but they stop following the colony’s folder, permissions, skills and context. Folders they inherited become their own only if you set them.</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn ghost" onClick={() => setConfirmDel(false)}>Keep colony</button>
            <button className="btn danger" onClick={async () => { await api.del(`/colonies/${colony.id}`); await refresh(['agents', 'colonies']); toast('Colony deleted'); onClose(); }}>Delete colony</button></div>
        </Modal>
      )}
    </>
  );
}

/** Asked on every save: what do this colony’s agents follow by default? */
function InheritAsk({ draft, colony, members, busy, onBack, onConfirm }: { draft: Draft; colony?: Colony; members: { id: string; name: string; overrides: InheritField[]; colony_id: string | null; effective: { cwd: string } }[]; busy: boolean; onBack: () => void; onConfirm: (f: InheritFlags) => void }) {
  const hasValue: Record<InheritField, boolean> = { cwd: !!draft.cwd, permission: true, skills: draft.skill_ids.length > 0, prompt: !!draft.system_prompt.trim() };
  const [flags, setFlags] = useState<InheritFlags>(() => ({
    cwd: (colony ? colony.inherit.cwd : true) && hasValue.cwd, permission: colony ? colony.inherit.permission : true,
    skills: (colony ? colony.inherit.skills : true) && hasValue.skills, prompt: (colony ? colony.inherit.prompt : true) && hasValue.prompt,
  }));
  const folderChanges = useMemo(() => flags.cwd && draft.cwd && members.filter((m) => !m.overrides.includes('cwd') && m.effective.cwd !== draft.cwd).length, [flags.cwd, draft.cwd, members]);
  return (
    <Modal title="What should its agents inherit?" onClose={onBack}>
      <p style={{ margin: 0 }} className="muted small">Members follow these by default. Any agent can still opt out for itself.</p>
      <div className="col" style={{ gap: 8 }}>
        {FIELD_ROWS.map((r) => (
          <label key={r.id} className={`checkrow ${hasValue[r.id] ? '' : 'off'}`}>
            <input type="checkbox" disabled={!hasValue[r.id]} checked={flags[r.id]} onChange={(e) => setFlags((f) => ({ ...f, [r.id]: e.target.checked }))} />
            <span><b>{r.label}{r.id === 'cwd' && draft.cwd ? <span className="muted mono" style={{ fontWeight: 400 }}> · {shortPath(draft.cwd)}</span> : null}{r.id === 'permission' ? <span className="muted" style={{ fontWeight: 400 }}> · {PERMISSIONS.find((p) => p.id === draft.permission)?.label}</span> : null}</b>
              <span className="hint">{hasValue[r.id] ? r.hint : `Nothing set yet — add ${r.id === 'cwd' ? 'a folder' : r.id === 'skills' ? 'skills' : 'shared context'} to share it.`}</span></span>
          </label>
        ))}
      </div>
      {folderChanges ? <div className="banner honey small">{folderChanges} {folderChanges === 1 ? 'agent moves' : 'agents move'} to this folder and starts a new conversation. Earlier ones stay in its Sessions tab.</div> : null}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onBack}>Back</button>
        <button className="btn primary" disabled={busy} onClick={() => onConfirm(flags)}>{busy ? 'Saving…' : colony ? 'Save colony' : 'Create colony'}</button>
      </div>
    </Modal>
  );
}
