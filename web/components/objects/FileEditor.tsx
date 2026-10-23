'use client';
import { useEffect, useState } from 'react';
import { Copy, Loader2, RefreshCcw, RotateCcw, Save } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { copyNameFor, folderOf, type SavedFile, type SourceFile, type SourceKind } from '@/lib/dockerFiles';
import { fmtBytes } from '@/lib/format';
import { useGitPrefs } from '@/lib/git/gitPrefs';
import { useI18n } from '@/lib/i18n/index';
import { useUnsavedGuard } from '@/lib/hooks/useUnsavedGuard';
import { CodeEditor } from '@/components/git/CodeEditor';
import { GitSettings } from '@/components/git/GitSettings';
import { Banner, CheckRow, ConfirmDialog, Field, Modal, useToast } from '@/components/ui';

/** Files whose overwrite was confirmed with "do not ask again": only for the next saves of that same file, until the page reloads. */
const noAsk = new Set<string>();

/**
 * A compose file or a Dockerfile in the code editor: **Save** writes over it (after a confirmation that names the file), **Save as copy**
 * writes next to it, **Discard** goes back to what was read. The server refuses a save if the file changed on disk since it was read (409):
 * then reload it, or overwrite it after another confirmation. `onRecreate` (compose) is offered when services still run the old definition.
 */
export function FileEditor({ kind, load, save, copy, repointOption = false, startWithCopy = false, onCopied, onRecreate, onDirty }: {
  kind: SourceKind;
  load: () => Promise<SourceFile>;
  save: (content: string, etag: string) => Promise<SavedFile>;
  copy: (p: { name: string; content: string; overwrite: boolean; repoint: boolean }) => Promise<SavedFile>;
  /** Compose: the copy can become the resource's file (on by default). */
  repointOption?: boolean;
  /** Opens "Save as copy" as soon as the file is read. */
  startWithCopy?: boolean;
  onCopied?: (r: SavedFile, repointed: boolean) => void;
  onRecreate?: () => void;
  onDirty?: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const prefs = useGitPrefs();
  const [file, setFile] = useState<SourceFile | null>(null);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<'save' | 'overwrite' | null>(null);
  const [skip, setSkip] = useState(false);
  const [stale, setStale] = useState(false);
  const [after, setAfter] = useState<SavedFile | null>(null);
  const [copying, setCopying] = useState(startWithCopy);
  const dirty = !!file && draft !== file.content;
  useUnsavedGuard(dirty);
  useEffect(() => { onDirty?.(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = async () => {
    setErr(''); setStale(false);
    try { const f = await load(); setFile(f); setDraft(f.content); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { void reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const write = async (etag: string) => {
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const r = await save(draft, etag);
      setFile({ ...file, content: draft, etag: r.etag, bytes: r.bytes }); setStale(false); setAfter(r);
      toast(t('fe.saved', { name: file.path }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setStale(true); else setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };
  const askSave = () => { if (!dirty || busy) return; if (file && noAsk.has(file.path)) void write(file.etag); else { setSkip(false); setAsking('save'); } };
  // Overwrite after a conflict: what is on disk now is replaced by the text in the editor.
  const overwrite = async () => { const now = await load(); await write(now.etag); };

  if (err && !file) return <div className="fe-fail"><Banner kind="err" action={<button type="button" className="btn sm" onClick={() => void reload()}><RefreshCcw size={14} />{t('fe.stale.reload')}</button>}>{err}</Banner></div>;
  if (!file) return <p className="gx-note">{t('git.loading')}</p>;
  return (
    <div className="fe gx" data-gx-theme={prefs.theme} style={{ ['--g-tab' as never]: prefs.tabSize }}>
      <div className="fe-bar">
        <span className="fe-path" title={file.path}>{file.path}</span>
        <span className="muted small fe-size">{fmtBytes(file.bytes)}{dirty ? ` · ${t('fe.dirty')}` : ''}</span>
        <div className="fe-acts">
          <GitSettings compact />
          <button type="button" className="btn ghost sm" disabled={!dirty || busy} onClick={() => setDraft(file.content)}><RotateCcw size={14} />{t('common.discard')}</button>
          <button type="button" className="btn sm" disabled={busy} onClick={() => setCopying(true)}><Copy size={14} />{t('fe.copy')}</button>
          <button type="button" className="btn primary sm" disabled={!dirty || busy} aria-busy={busy} onClick={askSave}>{busy ? <Loader2 size={14} className="spin" aria-hidden /> : <Save size={14} />}{t('fe.save')}</button>
        </div>
      </div>
      <p className="fe-note muted small">{t(`fe.note.${kind}`)}</p>
      {(stale || err || after) && (
        <div className="fe-msgs">
          {stale && (
            <Banner kind="warn" action={<div className="row gap-s wrap">
              <button type="button" className="btn sm" onClick={() => void reload()}><RefreshCcw size={14} />{t('fe.stale.reload')}</button>
              <button type="button" className="btn danger sm" onClick={() => setAsking('overwrite')}>{t('fe.stale.overwrite')}</button>
            </div>}>{t('fe.stale')}</Banner>
          )}
          {err && <Banner kind="err" onDismiss={() => setErr('')}>{err}</Banner>}
          {after?.check && !after.check.ok && <Banner kind="err" onDismiss={() => setAfter({ ...after, check: undefined })}>{t('fe.invalid')}{after.check.error && <pre className="fe-out">{after.check.error}</pre>}</Banner>}
          {after?.running && onRecreate && (
            <Banner kind="warn" onDismiss={() => setAfter({ ...after, running: false })} action={<button type="button" className="btn sm" onClick={onRecreate}><RefreshCcw size={14} />{t('obj.act.recreate')}</button>}>{t('fe.running')}</Banner>
          )}
        </div>
      )}
      <div className="fe-body">
        <CodeEditor value={draft} onChange={setDraft} path={kind === 'compose' ? 'docker-compose.yml' : 'Dockerfile'} label={t(`fe.label.${kind}`)}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); askSave(); } }} />
      </div>
      {asking === 'save' && (
        <ConfirmDialog title={t('fe.confirm.title')} body={t('fe.confirm.body', { path: file.path })} confirmLabel={t('fe.save')} danger
          onConfirm={async () => { if (skip) noAsk.add(file.path); await write(file.etag); }} onClose={() => setAsking(null)}>
          <CheckRow compact checked={skip} onChange={setSkip} label={t('fe.confirm.skip')} />
        </ConfirmDialog>
      )}
      {asking === 'overwrite' && (
        <ConfirmDialog title={t('fe.confirm.title')} body={t('fe.stale.confirm', { path: file.path })} confirmLabel={t('fe.stale.overwrite')} danger
          onConfirm={overwrite} onClose={() => setAsking(null)} />
      )}
      {copying && <CopyDialog kind={kind} path={file.path} content={draft} repointOption={repointOption} copy={copy} onClose={() => setCopying(false)}
        onDone={(r, repointed) => { setCopying(false); toast(t('fe.copied', { name: r.path })); onCopied?.(r, repointed); }} />}
    </div>
  );
}

/** "Save as copy": the name (next to the original), and for compose whether the resource uses it. A name that exists is replaced only after a confirmation. */
function CopyDialog({ kind, path, content, repointOption, copy, onClose, onDone }: {
  kind: SourceKind; path: string; content: string; repointOption: boolean;
  copy: (p: { name: string; content: string; overwrite: boolean; repoint: boolean }) => Promise<SavedFile>;
  onClose: () => void; onDone: (r: SavedFile, repointed: boolean) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(() => copyNameFor(kind, path));
  const [repoint, setRepoint] = useState(repointOption);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [exists, setExists] = useState(false);
  const target = `${folderOf(path).replace(/\/$/, '')}/${name.trim()}`;
  const run = async (overwrite: boolean) => {
    setBusy(true); setErr('');
    try { const r = await copy({ name: name.trim(), content, overwrite, repoint: repointOption && repoint }); onDone(r, repointOption && repoint); }
    catch (e) {
      if (overwrite) throw e;                                                  // the confirmation shows it and stays open
      if (e instanceof ApiError && e.status === 409) setExists(true); else setErr(e instanceof Error ? e.message : String(e));
    }
    finally { setBusy(false); }
  };
  return (
    <>
      <Modal title={t('fe.copy.title')} onClose={() => { if (!busy) onClose(); }}>
        <div className="fe-copy">
          <Field label={t('fe.copy.name')} hint={t('fe.copy.hint', { folder: folderOf(path) })}>
            <input className="input mono" value={name} onChange={(e) => { setName(e.target.value); setExists(false); }} spellCheck={false} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim() && !busy) { e.preventDefault(); void run(false); } }} />
          </Field>
          {repointOption && <CheckRow checked={repoint} onChange={setRepoint} label={t('fe.copy.repoint')} hint={t('fe.copy.repoint.hint')} />}
          {err && <Banner kind="err">{err}</Banner>}
        </div>
        <div className="row confirm-actions">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn primary" disabled={busy || !name.trim()} aria-busy={busy} onClick={() => void run(false)}>{busy && <Loader2 size={14} className="spin" aria-hidden />}{t('fe.copy.go')}</button>
        </div>
      </Modal>
      {exists && (
        <ConfirmDialog title={t('fe.copy.exists.title')} body={t('fe.copy.exists.body', { path: target })} confirmLabel={t('fe.copy.exists.go')} danger
          onConfirm={() => run(true)} onClose={() => setExists(false)} />
      )}
    </>
  );
}
