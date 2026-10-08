'use client';
import { useState } from 'react';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { Plus, Trash2 } from 'lucide-react';
import { useHive } from '@/lib/store';
import { api } from '@/lib/api';
import { PROVIDERS } from '@/lib/meta';
import type { AgentType, Permission, Provider, Role, SkillLoad } from '@/lib/types';
import { Drawer, Field, Hex, ModelField, Modal, PermissionField, ProviderPicker, RoleChip, Segmented, SkillPicker, useToast } from '@/components/ui';
import { NewAgentDrawer } from '@/components/agents/NewAgentDrawer';
import { useI18n } from '@/lib/i18n';
import { fmtNum } from '@/lib/format';

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
        <button className="btn primary" onClick={() => { setDraft(blank); setErr(''); }}><Plus size={16} />{t('types.new')}</button>
      </div>
      {ready && !types.length ? (
        <div className="empty"><h3>{t('types.empty.title')}</h3><p>{t('types.empty.body')}</p><button className="btn primary" onClick={() => setDraft(blank)}><Plus size={16} />{t('types.empty.create')}</button></div>
      ) : (
        <div className="typegrid">
          {types.map((ty) => {
            const n = agents.filter((a) => a.type_id === ty.id).length;
            return (
              <div key={ty.id} className="card typecard">
                <div className="row gap-l"><Hex color={PROVIDERS[ty.provider].color} queen={ty.role === 'orchestrator'} label={ty.name.slice(0, 2).toUpperCase()} /><div className="grow"><h3 style={{ fontSize: 19 }}>{ty.name}</h3><div className="row gap-s" style={{ marginTop: 4 }}><RoleChip role={ty.role} /></div></div></div>
                <p className="muted small" style={{ margin: 0, minHeight: 40 }}>{ty.description || t('types.noDescription')}</p>
                <div className="row gap-s wrap"><span className="chip">{PROVIDERS[ty.provider].label}</span><span className="chip">{ty.model || t('types.defaultModel')}</span><span className="chip">{t('types.skillsCount', { count: ty.skill_ids.length })}</span></div>
                <div className="row" style={{ marginTop: 4 }}>
                  <span className="muted small grow">{t('types.usedBy', { count: n })}</span>
                  <button className="btn sm" onClick={() => { setDraft({ ...ty }); setErr(''); }}>{t('common.edit')}</button>
                  <button className="btn sm primary" onClick={() => setSpawn(ty.id)}>{t('newAgent.create')}</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {draft && (
        <Drawer title={draft.id ? t('types.editTitle', { name: draft.name || t('types.typeWord') }) : t('types.newTitle')} subtitle={t('types.drawerSubtitle')} onClose={() => setDraft(null)}
          footer={<>{draft.id && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => setDel(types.find((ty) => ty.id === draft.id) ?? null)}><Trash2 size={15} />{t('common.delete')}</button>}<button className="btn ghost" onClick={() => setDraft(null)}>{t('common.cancel')}</button><button className="btn primary" onClick={save}>{draft.id ? t('types.save') : t('types.create')}</button></>}>
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
        <Modal title={t('types.deleteTitle', { name: del.name })} onClose={() => setDel(null)}>
          <p style={{ margin: 0 }} className="muted">{t('types.deleteBody')}</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn ghost" onClick={() => setDel(null)}>{t('types.keep')}</button>
            <button className="btn danger" onClick={async () => { await api.del(`/types/${del.id}`); await refresh(['types', 'agents']); setDel(null); setDraft(null); toast(t('types.deleted')); }}>{t('types.delete')}</button></div>
        </Modal>
      )}
      {spawn && <NewAgentDrawer presetTypeId={spawn} onClose={() => setSpawn(null)} />}
    </div>
  );
}
