'use client';
import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import { useHive } from '@/lib/store';
import { api } from '@/lib/api';
import { Field, Modal, useToast } from '@/components/ui';
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
        <div className="empty" style={{ margin: 36 }}><h3>{t('skills.empty.title')}</h3><p>{t('skills.empty.body')}</p><button className="btn primary" onClick={() => setSel('new')}><Plus size={16} />{t('skills.empty.create')}</button></div>
      ) : (
        <div className="sk-ws">
          <aside className="switcher" aria-label={t('nav.skills')}>
            <div className="switcher-head">
              <div className="row"><b style={{ fontFamily: 'var(--font-display)', fontSize: 16 }} className="grow">{t('nav.skills')}</b>
                <button className="btn ghost icon sm" onClick={() => setSel('new')} aria-label={t('skills.new')} title={t('skills.new')}><Plus size={16} /></button></div>
              <div className="search"><Search size={15} /><input className="input" placeholder={t('skills.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('skills.search')} /></div>
            </div>
            <div className="switcher-list">
              {sel === 'new' && <button className="sk-item" aria-current="true"><b>{t('skills.new')}</b><span className="muted small">{t('skills.unsaved')}</span></button>}
              {list.map((s) => (
                <button key={s.id} className="sk-item" aria-current={sel === s.id} onClick={() => setSel(s.id)}>
                  <b>{s.name}</b><span className="sk-desc">{s.description || t('common.noDescription')}</span>
                  <span className="sk-meta">{t('skills.nAgents', { count: usage[s.id]?.agents ?? 0 })} · {t('skills.nTypes', { count: usage[s.id]?.types ?? 0 })} · ~{fmtTok(estTokens(s.content))} tokens</span>
                </button>
              ))}
              {!list.length && sel !== 'new' && <p className="muted small" style={{ padding: 16 }}>{t('skills.noMatch', { query: q })}</p>}
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
                  {dirty && <button className="btn ghost" onClick={() => setSel(sel === 'new' ? (skills[0]?.id ?? null) : sel)}>{t('common.discard')}</button>}
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
        <Modal title={t('skills.deleteTitle', { name: current.name })} onClose={() => setDel(false)}>
          <p style={{ margin: 0 }} className="muted">{t('skills.deleteBody', { agents: t('skills.nAgents', { count: usage[current.id]?.agents ?? 0 }), types: t('skills.nTypes', { count: usage[current.id]?.types ?? 0 }) })}</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn ghost" onClick={() => setDel(false)}>{t('skills.keep')}</button>
            <button className="btn danger" onClick={async () => { await api.del(`/skills/${current.id}`); await refresh(['skills', 'agents', 'types']); setDel(false); setSel(null); toast(t('skills.deleted')); }}>{t('skills.delete')}</button></div>
        </Modal>
      )}
    </div>
  );
}
