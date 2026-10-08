'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useHive } from '@/lib/store';
import { useI18n } from '@/lib/i18n/index';
import { ago } from '@/lib/meta';
import type { Agent, NotebookInfo } from '@/lib/types';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { Modal, useToast } from '@/components/ui';

/** The agent's notebook: what it has chosen to remember. The user can read it, correct it, or wipe it. */
export function NotebookPanel({ agent }: { agent: Agent }) {
  const { t } = useI18n();
  const { refresh } = useHive();
  const toast = useToast();
  const [info, setInfo] = useState<NotebookInfo | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [wipe, setWipe] = useState(false);
  const base = useRef('');           // what the server last had; the text is dirty when it differs
  const dirty = !!info && text !== base.current;
  const dirtyRef = useRef(false); dirtyRef.current = dirty;

  const load = useCallback(async (force = false) => {
    try {
      const n = await api.get<NotebookInfo>(`/agents/${agent.id}/notebook`);
      setInfo((cur) => (cur && cur.version === n.version && cur.enabled === n.enabled ? cur : n));
      if (force || !dirtyRef.current) { base.current = n.content; setText(n.content); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [agent.id]);

  useEffect(() => { setInfo(null); setError(''); void load(true); }, [agent.id, load]);
  // The agent writes while it works: follow it (unless the user is typing).
  useEffect(() => { const id = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 4000); return () => clearInterval(id); }, [load]);

  const save = async (content = text) => {
    if (!info) return;
    setSaving(true); setError('');
    try {
      const n = await api.put<{ content: string; version: number; size: number; max: number; updated_at: number; updated_by: string }>(`/agents/${agent.id}/notebook`, { content, version: info.version });
      setInfo({ ...info, ...n }); base.current = n.content; setText(n.content);
      toast(t('notebook.saved'));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setSaving(false);
  };
  const addSkill = async () => {
    try { await api.patch(`/agents/${agent.id}`, { skill_ids: [...new Set([...agent.skill_ids, info!.skill_id])] }); await refresh(['agents']); await load(true); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  if (!info) return <div className="pane"><p className="hint">{error || t('git.loading')}</p></div>;
  const used = text.length, over = used > info.max, nearly = used > info.max * 0.8;
  return (
    <>
      <div className="pane">
        <p className="hint" style={{ margin: 0 }}>{t('notebook.intro')}</p>
        {!info.enabled && (
          <div className="banner honey"><AlertTriangle size={16} /><div className="grow">{t('notebook.off')}</div><button className="btn sm" onClick={addSkill}>{t('notebook.on')}</button></div>
        )}
        {error && <div className="banner err"><AlertTriangle size={16} /><div className="grow">{error}</div><button className="btn sm" onClick={() => { setError(''); void load(true); }}><RefreshCw size={13} />{t('notebook.reload')}</button></div>}
        <div className="row small muted" style={{ justifyContent: 'space-between' }}>
          <span><BookOpen size={12} style={{ verticalAlign: '-1px' }} /> {info.updated_at ? t('notebook.updated', { who: t(info.updated_by === 'user' ? 'notebook.by.you' : 'notebook.by.agent'), when: ago(info.updated_at) }) : t('notebook.never')}</span>
          <span style={{ color: over ? 'var(--danger, #c0392b)' : nearly ? 'var(--honey)' : undefined }}>{used.toLocaleString()} / {info.max.toLocaleString()}</span>
        </div>
        <MarkdownEditor value={text} onChange={setText} placeholder={t('notebook.placeholder')} defaultView="write" minHeight={320} />
      </div>
      <div className="savebar col">
        <span className="muted small">{dirty ? t('agent.unsavedChanges') : t('agent.allSaved')}</span>
        <div className="row">
          <button className="btn danger sm" style={{ marginRight: 'auto' }} disabled={!text.trim() || saving} onClick={() => setWipe(true)}><Trash2 size={14} />{t('notebook.clear')}</button>
          {dirty && <button className="btn ghost sm" onClick={() => setText(base.current)}>{t('common.discard')}</button>}
          <button className="btn primary sm" disabled={!dirty || saving || over} onClick={() => void save()}>{t('notebook.save')}</button>
        </div>
      </div>
      {wipe && (
        <Modal title={t('notebook.clear.title')} onClose={() => setWipe(false)}>
          <p style={{ margin: 0 }} className="muted">{t('notebook.clear.confirm')}</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={() => setWipe(false)}>{t('common.cancel')}</button>
            <button className="btn danger" onClick={() => { setWipe(false); void save(''); }}>{t('notebook.clear')}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
