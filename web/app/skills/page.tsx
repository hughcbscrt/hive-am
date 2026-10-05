'use client';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Plus, Search, Trash2 } from 'lucide-react';
import { useHive } from '@/lib/store';
import { api } from '@/lib/api';
import { Field, Modal, Segmented, useToast } from '@/components/ui';

export default function Skills() {
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
    if (!draft.name.trim()) { setErr('Give the skill a name.'); return; }
    try {
      if (sel === 'new') { const s = await api.post<{ id: string }>('/skills', draft); await refresh(['skills']); setSel(s.id); toast('Skill created'); }
      else { await api.patch(`/skills/${sel}`, draft); await refresh(['skills']); toast('Skill saved'); }
      setErr('');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save'); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Skills</h1><p>Markdown instructions you attach to agents or types. They are appended to the system prompt, so write them as guidance the agent follows.</p></div>
        <button className="btn primary" onClick={() => setSel('new')}><Plus size={16} />New skill</button>
      </div>
      {ready && !skills.length && sel !== 'new' ? (
        <div className="empty"><h3>No skills yet</h3><p>A skill is a reusable block of instructions — a review checklist, a commit style, how to run your tests.</p><button className="btn primary" onClick={() => setSel('new')}><Plus size={16} />Write the first skill</button></div>
      ) : (
        <div className="split">
          <div className="card listcard">
            <div style={{ padding: 12, borderBottom: '1px solid var(--line)' }}><div className="search"><Search size={16} /><input className="input" placeholder="Search skills" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search skills" /></div></div>
            {sel === 'new' && <button className="listitem" aria-current="true"><b>New skill</b><span className="muted small">Unsaved</span></button>}
            {list.map((s) => (
              <button key={s.id} className="listitem" aria-current={sel === s.id} onClick={() => setSel(s.id)}>
                <b>{s.name}</b><span className="muted small" style={{ display: 'block' }}>{s.description || 'No description'}</span>
                <span className="muted" style={{ fontSize: 12 }}>{usage[s.id]?.agents ?? 0} agents · {usage[s.id]?.types ?? 0} types</span>
              </button>
            ))}
            {!list.length && sel !== 'new' && <p className="muted small" style={{ padding: 16 }}>No skills match “{q}”.</p>}
          </div>
          {sel && (
            <div className="card card-pad col" style={{ gap: 16 }}>
              <Field label="Name" error={err}><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. conventional-commits" /></Field>
              <Field label="Description" hint="One line, shown in pickers."><input className="input" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
              <div className="field">
                <div className="row"><label className="label grow">Instructions</label><Segmented value={mode} onChange={setMode} options={[{ id: 'write', label: 'Write' }, { id: 'preview', label: 'Preview' }]} /></div>
                {mode === 'write'
                  ? <textarea className="textarea mono" rows={16} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} placeholder={'When writing commits:\n- Use the imperative mood\n- Keep the subject under 72 characters'} spellCheck={false} />
                  : <div className="md card-pad" style={{ border: '1px solid var(--line)', borderRadius: 10, minHeight: 280, background: 'var(--surface-2)' }}><ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.content || '*Nothing to preview yet.*'}</ReactMarkdown></div>}
                <span className="hint">{draft.content.length.toLocaleString()} characters</span>
              </div>
              <div className="row">
                {current && <button className="btn danger" onClick={() => setDel(true)}><Trash2 size={15} />Delete</button>}
                <span className="grow" />
                {dirty && <button className="btn ghost" onClick={() => setSel(sel === 'new' ? (skills[0]?.id ?? null) : sel)}>Discard</button>}
                <button className="btn primary" disabled={!dirty} onClick={save}>{sel === 'new' ? 'Create skill' : 'Save skill'}</button>
              </div>
            </div>
          )}
        </div>
      )}
      {del && current && (
        <Modal title={`Delete ${current.name}?`} onClose={() => setDel(false)}>
          <p style={{ margin: 0 }} className="muted">It will be detached from {usage[current.id]?.agents ?? 0} agents and {usage[current.id]?.types ?? 0} types.</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn ghost" onClick={() => setDel(false)}>Keep skill</button>
            <button className="btn danger" onClick={async () => { await api.del(`/skills/${current.id}`); await refresh(['skills', 'agents', 'types']); setDel(false); setSel(null); toast('Skill deleted'); }}>Delete skill</button></div>
        </Modal>
      )}
    </div>
  );
}
