'use client';
import { useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useHive } from '@/lib/store';
import { api } from '@/lib/api';
import { PROVIDERS } from '@/lib/meta';
import type { AgentType } from '@/lib/types';
import { ConfirmDialog, Drawer, EmptyState, Hex, RoleChip, useToast } from '@/components/ui';
import { AgentForm, draftFromTypeRecord, typePayload, type AgentDraft } from '@/components/agents/AgentForm';
import { NewAgentDrawer } from '@/components/agents/NewAgentDrawer';
import { useI18n } from '@/lib/i18n';
import { useUnsavedGuard } from '@/lib/hooks/useUnsavedGuard';
import { HomeCrumb } from '@/components/HomeCrumb';

export default function Types() {
  const { t } = useI18n();
  const { types, agents, refresh, ready } = useHive();
  const toast = useToast();
  const [draft, setDraft] = useState<AgentDraft | null>(null);
  const [editId, setEditId] = useState<string | null>(null); // the type being edited; null for a new one
  const [err, setErr] = useState('');
  const [del, setDel] = useState<AgentType | null>(null);
  const [spawn, setSpawn] = useState<string | null>(null);
  const [asking, setAsking] = useState(false); // closing the drawer with edits
  // What the drawer opened with, to know whether anything changed.
  const origin = useRef('');
  const openDraft = (d: AgentDraft, id: string | null = null) => { origin.current = JSON.stringify(d); setDraft(d); setEditId(id); setErr(''); };
  const dirty = !!draft && JSON.stringify(draft) !== origin.current;
  useUnsavedGuard(dirty);
  const closeDraft = () => { if (dirty) setAsking(true); else setDraft(null); };

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) { setErr(t('types.err.name')); return; }
    try {
      if (editId) await api.patch(`/types/${editId}`, typePayload(draft)); else await api.post('/types', typePayload(draft));
      await refresh(['types']); toast(editId ? t('types.updated') : t('types.created')); setDraft(null); setErr('');
    } catch (e) { setErr(e instanceof Error ? e.message : t('edit.saveFailed')); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><HomeCrumb /><h1>{t('nav.types')}</h1><p>{t('types.subtitle')}</p></div>
        <button className="btn primary" onClick={() => openDraft(draftFromTypeRecord())}><Plus size={16} />{t('types.new')}</button>
      </div>
      {ready && !types.length ? (
        <EmptyState title={t('types.empty.title')} body={t('types.empty.body')} action={<button className="btn primary" onClick={() => openDraft(draftFromTypeRecord())}><Plus size={16} />{t('types.empty.create')}</button>} />
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
                  <button className="btn sm" onClick={() => openDraft(draftFromTypeRecord(ty), ty.id)}>{t('common.edit')}</button>
                  <button className="btn sm primary" onClick={() => setSpawn(ty.id)}>{t('newAgent.create')}</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {draft && (
        <Drawer title={editId ? t('types.editTitle', { name: draft.name || t('types.typeWord') }) : t('types.newTitle')} subtitle={t('types.drawerSubtitle')} onClose={closeDraft}
          footer={<>{editId && <button className="btn danger push-r" onClick={() => setDel(types.find((ty) => ty.id === editId) ?? null)}><Trash2 size={15} />{t('common.delete')}</button>}<button className="btn ghost" onClick={closeDraft}>{t('common.cancel')}</button><button className="btn primary" onClick={save}>{editId ? t('types.save') : t('types.create')}</button></>}>
          <AgentForm mode="type" draft={draft} onChange={setDraft} errors={{ name: err }} focusName />
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
