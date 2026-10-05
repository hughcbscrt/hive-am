'use client';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useHive } from '@/lib/store';
import { api } from '@/lib/api';
import { PROVIDERS } from '@/lib/meta';
import type { AgentType, Permission, Provider, Role } from '@/lib/types';
import { Drawer, Field, Hex, ModelField, Modal, PermissionField, ProviderPicker, RoleChip, Segmented, SkillPicker, useToast } from '@/components/ui';
import { NewAgentDrawer } from '@/components/NewAgentDrawer';

interface Draft { id?: string; name: string; description: string; role: Role; provider: Provider; model: string; system_prompt: string; permission: Permission; skill_ids: string[] }
const blank: Draft = { name: '', description: '', role: 'worker', provider: 'claude', model: '', system_prompt: '', permission: 'acceptEdits', skill_ids: [] };

export default function Types() {
  const { types, agents, skills, providers, refresh, ready } = useHive();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState('');
  const [del, setDel] = useState<AgentType | null>(null);
  const [spawn, setSpawn] = useState<string | null>(null);

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) { setErr('Give the type a name.'); return; }
    try {
      if (draft.id) await api.patch(`/types/${draft.id}`, draft); else await api.post('/types', draft);
      await refresh(['types']); toast(draft.id ? 'Type updated' : 'Type created'); setDraft(null); setErr('');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save'); }
  };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => d && { ...d, [k]: v });

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Agent types</h1><p>Reusable blueprints: provider, model, prompt, permissions and skills. Create an agent from a type in two clicks.</p></div>
        <button className="btn primary" onClick={() => { setDraft(blank); setErr(''); }}><Plus size={16} />New type</button>
      </div>
      {ready && !types.length ? (
        <div className="empty"><h3>No types yet</h3><p>Define a “Reviewer” or “Builder” once, then spin up as many agents from it as you need.</p><button className="btn primary" onClick={() => setDraft(blank)}><Plus size={16} />Create a type</button></div>
      ) : (
        <div className="typegrid">
          {types.map((t) => {
            const n = agents.filter((a) => a.type_id === t.id).length;
            return (
              <div key={t.id} className="card typecard">
                <div className="row gap-l"><Hex color={PROVIDERS[t.provider].color} queen={t.role === 'orchestrator'} label={t.name.slice(0, 2).toUpperCase()} /><div className="grow"><h3 style={{ fontSize: 19 }}>{t.name}</h3><div className="row gap-s" style={{ marginTop: 4 }}><RoleChip role={t.role} /></div></div></div>
                <p className="muted small" style={{ margin: 0, minHeight: 40 }}>{t.description || 'No description.'}</p>
                <div className="row gap-s wrap"><span className="chip">{PROVIDERS[t.provider].label}</span><span className="chip">{t.model || 'default model'}</span><span className="chip">{t.skill_ids.length} skills</span></div>
                <div className="row" style={{ marginTop: 4 }}>
                  <span className="muted small grow">{n} {n === 1 ? 'agent' : 'agents'} use this</span>
                  <button className="btn sm" onClick={() => { setDraft({ ...t }); setErr(''); }}>Edit</button>
                  <button className="btn sm primary" onClick={() => setSpawn(t.id)}>Create agent</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {draft && (
        <Drawer title={draft.id ? `Edit ${draft.name || 'type'}` : 'New agent type'} subtitle="Agents created from this type start with these values. Existing agents are not changed." onClose={() => setDraft(null)}
          footer={<>{draft.id && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => setDel(types.find((t) => t.id === draft.id) ?? null)}><Trash2 size={15} />Delete</button>}<button className="btn ghost" onClick={() => setDraft(null)}>Cancel</button><button className="btn primary" onClick={save}>{draft.id ? 'Save type' : 'Create type'}</button></>}>
          <Field label="Name" error={err}><input className="input" value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Reviewer" autoFocus /></Field>
          <Field label="Description" hint="Shown when picking a type."><input className="input" value={draft.description} onChange={(e) => set('description', e.target.value)} /></Field>
          <Field label="Role"><Segmented value={draft.role} onChange={(v) => set('role', v)} options={[{ id: 'worker', label: 'Worker' }, { id: 'orchestrator', label: 'Orchestrator' }]} /></Field>
          <Field label="Provider"><ProviderPicker value={draft.provider} onChange={(p) => setDraft({ ...draft, provider: p, model: '' })} providers={providers} /></Field>
          <ModelField provider={draft.provider} value={draft.model} onChange={(v) => set('model', v)} />
          <PermissionField value={draft.permission} onChange={(v) => set('permission', v)} />
          <Field label="System prompt" hint={`${draft.system_prompt.length.toLocaleString()} characters`}><textarea className="textarea mono" rows={9} value={draft.system_prompt} onChange={(e) => set('system_prompt', e.target.value)} spellCheck={false} /></Field>
          <Field label="Skills"><SkillPicker skills={skills} value={draft.skill_ids} onChange={(v) => set('skill_ids', v)} /></Field>
        </Drawer>
      )}
      {del && (
        <Modal title={`Delete ${del.name}?`} onClose={() => setDel(null)}>
          <p style={{ margin: 0 }} className="muted">Agents already created from it keep their settings and simply lose the link.</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn ghost" onClick={() => setDel(null)}>Keep type</button>
            <button className="btn danger" onClick={async () => { await api.del(`/types/${del.id}`); await refresh(['types', 'agents']); setDel(null); setDraft(null); toast('Type deleted'); }}>Delete type</button></div>
        </Modal>
      )}
      {spawn && <NewAgentDrawer presetTypeId={spawn} onClose={() => setSpawn(null)} />}
    </div>
  );
}
