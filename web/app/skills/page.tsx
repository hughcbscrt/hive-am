'use client';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Plus, Search, Trash2 } from 'lucide-react';
import { useHive } from '@/lib/store';
import { api } from '@/lib/api';
import { Field, Modal, Segmented, useToast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { fmtNum } from '@/lib/format';

export default function Skills() {
  const { t } = useI18n();
  const { skills, refresh, ready } = useHive();
  const toast = useToast();
  const [sel, setSel] = useState<string | 'new' | null>(null);
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState({ name: '', description: '', content: '' });
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [usage, setUsage] = useState<Record<string, { agents: number; types: number }>>({});
  const [err, setErr] = useState('');
  const [del, setDel] = useState(false);

  useEffect(() => { api.get<typeof usage>('/skills/usage').then(setUsage).catch(() => undefined); }, [skills]);
  useEffect(() => { if (sel === null && skills.length) setSel(skills[0].id); }, [skills, sel]);
  useEffect(() => {
    if (sel === 'new') setDraft({ name: '', description: '', content: '' });
    else { const s = skills.find((x) => x.id === sel); if (s) setDraft({ name: s.name, description: s.description, content: s.content }); }
    setErr(''); setMode('write');
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
    <div className="page">
      <div className="page-head">
        <div><h1>{t('nav.skills')}</h1><p>{t('skills.subtitle')}</p></div>
        <button className="btn primary" onClick={() => setSel('new')}><Plus size={16} />{t('skills.new')}</button>
      </div>
      {ready && !skills.length && sel !== 'new' ? (
        <div className="empty"><h3>{t('skills.empty.title')}</h3><p>{t('skills.empty.body')}</p><button className="btn primary" onClick={() => setSel('new')}><Plus size={16} />{t('skills.empty.create')}</button></div>
      ) : (
        <div className="split">
          <div className="card listcard">
            <div style={{ padding: 12, borderBottom: '1px solid var(--line)' }}><div className="search"><Search size={16} /><input className="input" placeholder={t('skills.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('skills.search')} /></div></div>
            {sel === 'new' && <button className="listitem" aria-current="true"><b>{t('skills.new')}</b><span className="muted small">{t('skills.unsaved')}</span></button>}
            {list.map((s) => (
              <button key={s.id} className="listitem" aria-current={sel === s.id} onClick={() => setSel(s.id)}>
                <b>{s.name}</b><span className="muted small" style={{ display: 'block' }}>{s.description || t('common.noDescription')}</span>
                <span className="muted" style={{ fontSize: 12 }}>{t('skills.nAgents', { count: usage[s.id]?.agents ?? 0 })} · {t('skills.nTypes', { count: usage[s.id]?.types ?? 0 })}</span>
              </button>
            ))}
            {!list.length && sel !== 'new' && <p className="muted small" style={{ padding: 16 }}>{t('skills.noMatch', { query: q })}</p>}
          </div>
          {sel && (
            <div className="card card-pad col" style={{ gap: 16 }}>
              <Field label={t('form.name')} error={err}><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t('skills.name.placeholder')} /></Field>
              <Field label={t('types.description')} hint={t('skills.description.hint')}><input className="input" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
              <div className="field">
                <div className="row"><label className="label grow">{t('skills.instructions')}</label><Segmented value={mode} onChange={setMode} options={[{ id: 'write', label: t('skills.write') }, { id: 'preview', label: t('skills.preview') }]} /></div>
                {mode === 'write'
                  ? <textarea className="textarea mono" rows={16} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} placeholder={t('skills.content.placeholder')} spellCheck={false} />
                  : <div className="md card-pad" style={{ border: '1px solid var(--line)', borderRadius: 10, minHeight: 280, background: 'var(--surface-2)' }}><ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.content || t('skills.previewEmpty')}</ReactMarkdown></div>}
                <span className="hint">{t('skills.chars', { count: draft.content.length, n: fmtNum(draft.content.length) })}</span>
              </div>
              <div className="row">
                {current && <button className="btn danger" onClick={() => setDel(true)}><Trash2 size={15} />{t('common.delete')}</button>}
                <span className="grow" />
                {dirty && <button className="btn ghost" onClick={() => setSel(sel === 'new' ? (skills[0]?.id ?? null) : sel)}>{t('common.discard')}</button>}
                <button className="btn primary" disabled={!dirty} onClick={save}>{sel === 'new' ? t('skills.create') : t('skills.save')}</button>
              </div>
            </div>
          )}
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
