'use client';
import { useRef, useState } from 'react';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { Plus, Trash2 } from 'lucide-react';
import { useHive } from '@/lib/store';
import { api } from '@/lib/api';
import { PROVIDERS } from '@/lib/meta';
import type { AgentType, Permission, Provider, Role, SkillLoad } from '@/lib/types';
import { ConfirmDialog, Drawer, EmptyState, Field, Hex, ModelField, PermissionField, ProviderPicker, RoleChip, Segmented, SkillPicker, useToast } from '@/components/ui';
import { NewAgentDrawer } from '@/components/agents/NewAgentDrawer';
import { useI18n } from '@/lib/i18n';
import { fmtNum } from '@/lib/format';
import { useUnsavedGuard } from '@/lib/hooks/useUnsavedGuard';

interface Draft { id?: string; name: string; description: string; role: Role; provider: Provider; model: string; system_prompt: string; permission: Permission; skill_ids: string[]; skill_loads: Record<string, SkillLoad> }
const blank: Draft = { name: '', description: '', role: 'worker', provider: 'claude', model: '', system_prompt: '', permission: 'acceptEdits', skill_ids: [], skill_loads: {} };

export default function Types() {
  const { t } = useI18n();
  const { types, agents, skills, providers, refresh, ready } = useHive();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState('');
  const [del, setDel] = useState<AgentType | null>(null);
  const [spawn, setSpawn] = useState<string | null>(null);
  const [asking, setAsking] = useState(false); // closing the drawer with edits
  // What the drawer opened with, to know whether anything changed.
  const origin = useRef('');
  const openDraft = (d: Draft) => { origin.current = JSON.stringify(d); setDraft(d); setErr(''); };
  const dirty = !!draft && JSON.stringify(draft) !== origin.current;
  useUnsavedGuard(dirty);
  const closeDraft = () => { if (dirty) setAsking(true); else setDraft(null); };

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) { setErr(t('types.err.name')); return; }
    try {
      if (draft.id) await api.patch(`/types/${draft.id}`, draft); else await api.post('/types', draft);
      await refresh(['types']); toast(draft.id ? t('types.updated') : t('types.created')); setDraft(null); setErr('');
    } catch (e) { setErr(e instanceof Error ? e.message : t('edit.saveFailed')); }
  };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => d && { ...d, [k]: v });

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{t('nav.types')}</h1><p>{t('types.subtitle')}</p></div>
        <button className="btn primary" onClick={() => openDraft(blank)}><Plus size={16} />{t('types.new')}</button>
      </div>
      {ready && !types.length ? (
        <EmptyState title={t('types.empty.title')} body={t('types.empty.body')} action={<button className="btn primary" onClick={() => openDraft(blank)}><Plus size={16} />{t('types.empty.create')}</button>} />
      ) : (
        <div className="typegrid">
          {types.map((ty) => {
            const n = agents.filter((a) => a.type_id === ty.id).length;
            return (
              <div key={ty.id} className="card typecard">
                <div className="row gap-l"><Hex color={PROVIDERS[ty.provider].color} queen={ty.role === 'orchestrator'} label={ty.name.slice(0, 2).toUpperCase()} /><div className="grow"><h3 className="fa-card-title">{ty.name}</h3><div className="row gap-s mt-xs"><RoleChip role={ty.role} /></div></div></div>
                <p className="muted small m0 fa-desc">{ty.description || t('types.noDescription')}</p>
                <div className="row gap-s wrap"><span className="chip">{PROVIDERS[ty.provider].label}</span><span className="chip">{ty.model || t('types.defaultModel')}</span><span className="chip">{t('types.skillsCount', { count: ty.skill_ids.length })}</span></div>
                <div className="row mt-xs">
                  <span className="muted small grow">{t('types.usedBy', { count: n })}</span>
                  <button className="btn sm" onClick={() => openDraft({ ...ty })}>{t('common.edit')}</button>
                  <button className="btn sm primary" onClick={() => setSpawn(ty.id)}>{t('newAgent.create')}</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {draft && (
        <Drawer title={draft.id ? t('types.editTitle', { name: draft.name || t('types.typeWord') }) : t('types.newTitle')} subtitle={t('types.drawerSubtitle')} onClose={closeDraft}
          footer={<>{draft.id && <button className="btn danger push-r" onClick={() => setDel(types.find((ty) => ty.id === draft.id) ?? null)}><Trash2 size={15} />{t('common.delete')}</button>}<button className="btn ghost" onClick={closeDraft}>{t('common.cancel')}</button><button className="btn primary" onClick={save}>{draft.id ? t('types.save') : t('types.create')}</button></>}>
          <Field label={t('form.name')} error={err}><input className="input" value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder={t('types.name.placeholder')} autoFocus /></Field>
          <Field label={t('types.description')} hint={t('types.description.hint')}><input className="input" value={draft.description} onChange={(e) => set('description', e.target.value)} /></Field>
          <Field label={t('form.role')}><Segmented value={draft.role} onChange={(v) => set('role', v)} options={[{ id: 'worker', label: t('role.worker') }, { id: 'orchestrator', label: t('role.orchestrator') }]} /></Field>
          <Field label={t('form.provider')}><ProviderPicker value={draft.provider} onChange={(p) => setDraft({ ...draft, provider: p, model: '' })} providers={providers} /></Field>
          <ModelField provider={draft.provider} value={draft.model} onChange={(v) => set('model', v)} />
          <PermissionField value={draft.permission} onChange={(v) => set('permission', v)} />
          <Field label={t('form.systemPrompt')} hint={t('types.chars', { count: draft.system_prompt.length, n: fmtNum(draft.system_prompt.length) })}><MarkdownEditor value={draft.system_prompt} onChange={(v) => set('system_prompt', v)} minHeight={260} /></Field>
          <Field label={t('form.skills')}><SkillPicker skills={skills} value={draft.skill_ids} loads={draft.skill_loads} onChange={(ids, loads) => setDraft({ ...draft, skill_ids: ids, skill_loads: loads })} /></Field>
        </Drawer>
      )}
      {del && (
        <ConfirmDialog danger title={t('types.deleteTitle', { name: del.name })} body={t('types.deleteBody')} cancelLabel={t('types.keep')} confirmLabel={t('types.delete')} onClose={() => setDel(null)}
          onConfirm={async () => { await api.del(`/types/${del.id}`); await refresh(['types', 'agents']); setDraft(null); toast(t('types.deleted')); }} />
      )}
      {asking && <ConfirmDialog danger title={t('fa.unsaved.title')} body={t('fa.unsaved.body')} confirmLabel={t('fa.unsaved.discard')} cancelLabel={t('fa.unsaved.keep')} onClose={() => setAsking(false)} onConfirm={() => setDraft(null)} />}
      {spawn && <NewAgentDrawer presetTypeId={spawn} onClose={() => setSpawn(null)} />}
    </div>
  );
}
