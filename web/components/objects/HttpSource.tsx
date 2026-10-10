'use client';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Pencil, Play, Save, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import type { HttpFile, VarInfo } from '@/lib/types';
import { useToast } from '@/components/ui';
import { sourceLabel, SOURCE_TONE } from './VarsTable';

/**
 * The .http file as text, the way an editor shows it: a ▶ where each request starts (with how its last run went), `{{variables}}` marked
 * with their value and origin when you hover them, and an editor to change the file and save it. Saving rewrites the file on disk.
 */
export function HttpSource({ objectId, file, vars, onRun, status, onSaved }: {
  objectId: string; file: HttpFile; vars: VarInfo[]; onRun: (index: number) => void;
  /** How the last run of each request went, by request index. */
  status: Record<number, 'ok' | 'warn' | 'err' | ''>; onSaved: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [text, setText] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setText(null); setDraft(null); setErr(''); api.get<{ content: string }>(`/objects/${objectId}/http/file?file=${encodeURIComponent(file.relFile)}`).then((r) => setText(r.content)).catch((e) => setErr(e instanceof Error ? e.message : '')); }, [objectId, file.relFile]);
  const byName = useMemo(() => new Map(vars.map((v) => [v.name, v])), [vars]);
  const starts = useMemo(() => new Map(file.requests.map((r) => [r.line, r.index])), [file]);

  const save = async () => {
    if (draft === null) return;
    setBusy(true); setErr('');
    try { await api.put(`/objects/${objectId}/http/file`, { file: file.relFile, content: draft }); setText(draft); setDraft(null); toast(t('hw2.saved')); onSaved(); }
    catch (e) { setErr(e instanceof Error ? e.message : ''); } finally { setBusy(false); }
  };

  const tip = (name: string) => {
    const v = byName.get(name); if (!v) return '';
    const val = v.hidden ? t('iv.hidden') : v.source === 'missing' ? '—' : v.source === 'dynamic' ? t('iv.generated') : v.secret ? '••••••••' : v.value ?? '';
    return `${name} = ${val}\n${sourceLabel(t, v.source, v.from)}`;
  };
  const renderLine = (line: string) => {
    if (/^\s*(#|\/\/)/.test(line)) return <span className="hs-comment">{line}</span>;
    const parts = line.split(/(\{\{[^}]+\}\})/g);
    return <>{parts.map((p, i) => {
      if (!p.startsWith('{{')) return <Fragment key={i}>{p}</Fragment>;
      const name = p.slice(2, -2).trim(), v = byName.get(name);
      return <span key={i} className={`hs-var ${v ? SOURCE_TONE[v.source] : 'miss'}`} title={tip(name)}>{p}</span>;
    })}</>;
  };

  if (err && text === null) return <p className="gx-note err" style={{ padding: 16 }}>{err}</p>;
  if (text === null) return <p className="gx-note">{t('git.loading')}</p>;
  const lines = (draft ?? text).split('\n');
  return (
    <div className="hs">
      <div className="hs-bar">
        <span className="muted small grow">{draft !== null ? t('hw2.dirty') : t('hw2.fileHint')}</span>
        {draft === null ? <button className="btn sm" onClick={() => setDraft(text)}><Pencil size={14} />{t('hw2.edit')}</button> : (<>
          <button className="btn ghost sm" onClick={() => { setDraft(null); setErr(''); }}><X size={14} />{t('hw2.cancel')}</button>
          <button className="btn primary sm" disabled={busy || draft === text} onClick={() => void save()}><Save size={14} />{t('hw2.save')}</button></>)}
      </div>
      {err && <div className="gx-banner err">{err}</div>}
      {draft !== null ? (
        <textarea className="hs-edit mono" value={draft} spellCheck={false} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); void save(); } }} />
      ) : (
        <div className="hs-view mono">
          {lines.map((l, i) => {
            const idx = starts.get(i + 1), st = idx !== undefined ? status[idx] : undefined;
            return (
              <div key={i} className={`hs-line ${/^#{3,}/.test(l.trim()) ? 'sep' : ''}`}>
                <span className="hs-gutter">{idx !== undefined ? <button className={`hs-run ${st ?? ''}`} onClick={() => onRun(idx)} aria-label={t('hw2.runHere')} title={t('hw2.runHere')}><Play size={11} /></button> : null}</span>
                <span className="hs-no">{i + 1}</span><span className="hs-text">{renderLine(l) || ' '}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
