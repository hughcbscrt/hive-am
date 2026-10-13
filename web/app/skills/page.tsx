'use client';
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useHive } from '@/lib/store';
import { api } from '@/lib/api';
import { ConfirmDialog, EmptyState, Field, SearchInput, useToast } from '@/components/ui';
import { useUnsavedGuard } from '@/lib/hooks/useUnsavedGuard';
import { useI18n } from '@/lib/i18n';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { estTokens, fmtTok } from '@/lib/tokens';

export default function Skills() {
  const { t } = useI18n();
  const { skills, refresh, ready } = useHive();
  const toast = useToast();
  const [sel, setSel] = useState<string | 'new' | null>(null);
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState({ name: '', description: '', content: '' });
  const [usage, setUsage] = useState<Record<string, { agents: number; types: number }>>({});
  const [err, setErr] = useState('');
  const [del, setDel] = useState(false);
  const [pendingSel, setPendingSel] = useState<string | 'new' | null | undefined>(undefined); // a switch waiting for the answer about unsaved changes

  useEffect(() => { api.get<typeof usage>('/skills/usage').then(setUsage).catch(() => undefined); }, [skills]);
  useEffect(() => { if (sel === null && skills.length) setSel(skills[0].id); }, [skills, sel]);
  useEffect(() => {
    if (sel === 'new') setDraft({ name: '', description: '', content: '' });
    else { const s = skills.find((x) => x.id === sel); if (s) setDraft({ name: s.name, description: s.description, content: s.content }); }
    setErr('');
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => skills.filter((s) => !q || `${s.name} ${s.description}`.toLowerCase().includes(q.toLowerCase())), [skills, q]);
  const current = skills.find((s) => s.id === sel);
  const dirty = sel === 'new' ? !!(draft.name || draft.content) : !!current && (current.name !== draft.name || current.description !== draft.description || current.content !== draft.content);

  useUnsavedGuard(dirty);
  const loadDraft = (id: string | 'new' | null) => {
    if (id === 'new') setDraft({ name: '', description: '', content: '' });
    else { const s = skills.find((x) => x.id === id); if (s) setDraft({ name: s.name, description: s.description, content: s.content }); }
    setErr('');
  };
  // Changing skill (or starting a new one) would silently drop the edits: ask first.
  const choose = (id: string | 'new' | null) => { if (id === sel) return; if (dirty) setPendingSel(id); else setSel(id); };

  const save = async () => {
    if (!draft.name.trim()) { setErr(t('skills.err.name')); return; }
    try {
      if (sel === 'new') { const s = await api.post<{ id: string }>('/skills', draft); await refresh(['skills']); setSel(s.id); toast(t('skills.created')); }
      else { await api.patch(`/skills/${sel}`, draft); await refresh(['skills']); toast(t('skills.saved')); }
      setErr('');
    } catch (e) { setErr(e instanceof Error ? e.message : t('edit.saveFailed')); }
  };

  return (
    <div className="page full">
      {ready && !skills.length && sel !== 'new' ? (
        <div className="m-xl"><EmptyState title={t('skills.empty.title')} body={t('skills.empty.body')} action={<button className="btn primary" onClick={() => setSel('new')}><Plus size={16} />{t('skills.empty.create')}</button>} /></div>
      ) : (
        <div className="sk-ws">
          <aside className="switcher" aria-label={t('nav.skills')}>
            <div className="switcher-head">
              <div className="row"><b className="fa-title grow">{t('nav.skills')}</b>
                <button className="btn ghost icon sm" onClick={() => choose('new')} aria-label={t('skills.new')} title={t('skills.new')}><Plus size={16} /></button></div>
              <SearchInput value={q} onChange={setQ} placeholder={t('skills.search')} label={t('skills.search')} />
            </div>
            <div className="switcher-list">
              {sel === 'new' && <button className="sk-item" aria-current="true"><b>{t('skills.new')}</b><span className="muted small">{t('skills.unsaved')}</span></button>}
              {list.map((s) => (
                <button key={s.id} className="sk-item" aria-current={sel === s.id} onClick={() => choose(s.id)}>
                  <b>{s.name}</b><span className="sk-desc">{s.description || t('common.noDescription')}</span>
                  <span className="sk-meta">{t('skills.nAgents', { count: usage[s.id]?.agents ?? 0 })} · {t('skills.nTypes', { count: usage[s.id]?.types ?? 0 })} · ~{fmtTok(estTokens(s.content))} tokens</span>
                </button>
              ))}
              {!list.length && sel !== 'new' && <p className="muted small pad-m">{t('skills.noMatch', { query: q })}</p>}
            </div>
          </aside>
          {sel ? (
            <section className="sk-main">
              <header className="sk-head">
                <div className="sk-fields">
                  <Field label={t('form.name')} error={err}><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t('skills.name.placeholder')} /></Field>
                  <Field label={t('types.description')} hint={t('skills.description.hint')}><input className="input" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
                </div>
                <div className="sk-actions">
                  {current && <button className="btn danger" onClick={() => setDel(true)}><Trash2 size={15} />{t('common.delete')}</button>}
                  {dirty && <button className="btn ghost" onClick={() => { if (sel === 'new') setSel(skills[0]?.id ?? null); else loadDraft(sel); }}>{t('common.discard')}</button>}
                  <button className="btn primary" disabled={!dirty} onClick={save}>{sel === 'new' ? t('skills.create') : t('skills.save')}</button>
                </div>
              </header>
              <div className="sk-editor">
                <label className="label">{t('skills.instructions')}</label>
                <MarkdownEditor fill value={draft.content} onChange={(content) => setDraft({ ...draft, content })} placeholder={t('skills.content.placeholder')} />
              </div>
            </section>
          ) : <section className="sk-main sk-none"><p className="muted">{t('skills.subtitle')}</p></section>}
        </div>
      )}
      {del && current && (
        <ConfirmDialog danger title={t('skills.deleteTitle', { name: current.name })} body={t('skills.deleteBody', { agents: t('skills.nAgents', { count: usage[current.id]?.agents ?? 0 }), types: t('skills.nTypes', { count: usage[current.id]?.types ?? 0 }) })}
          cancelLabel={t('skills.keep')} confirmLabel={t('skills.delete')} onClose={() => setDel(false)}
          onConfirm={async () => { await api.del(`/skills/${current.id}`); await refresh(['skills', 'agents', 'types']); setSel(null); toast(t('skills.deleted')); }} />
      )}
      {pendingSel !== undefined && (
        <ConfirmDialog danger title={t('fa.unsaved.title')} body={t('fa.unsaved.body')} confirmLabel={t('fa.unsaved.discard')} cancelLabel={t('fa.unsaved.keep')} onClose={() => setPendingSel(undefined)}
          onConfirm={() => { setSel(pendingSel); setPendingSel(undefined); }} />
      )}
    </div>
  );
}
