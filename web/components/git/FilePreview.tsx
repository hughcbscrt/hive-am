'use client';
import { useEffect, useMemo, useState } from 'react';
import { History, Undo2, UserSearch } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { fmtBytes } from '@/lib/format';
import { changeMarks, parseDiff } from '@/lib/git/diff';
import { IMAGE_RE as IMAGE, MARKDOWN_RE as MARKDOWN } from '@/lib/git/kinds';
import type { Agent, GitChange, GitDiffResult, GitFileResult, GitRefs } from '@/lib/types';
import { Segmented } from '@/components/ui';
import { CopyBtn } from '@/components/chat/ToolCall';
import { RefPicker } from './RefPicker';
import { RefFile } from './RefFile';
import { DiffView } from './DiffView';
import { FileView } from './FileView';

/** One file open in the explorer: its diff, its content (highlighted, blamed, rendered Markdown or the picture) and the toolbar. */
export function FilePreview({ agent, path, ignored = false, change, stamp, refs, focusLine, onHistory, onOpenCommit, onDiscard, onDiscardHunk, onDiscardLines }: { agent: Agent; path: string; ignored?: boolean; change?: GitChange; stamp: number; refs: GitRefs | null; focusLine?: { line: number; key: number }; onHistory: (path: string) => void; onOpenCommit: (sha: string) => void; onDiscard: (c: GitChange) => void; onDiscardHunk: (path: string, index: number, header: string) => void; onDiscardLines: (path: string, index: number, header: string, lines: number[]) => void }) {
  const { t } = useI18n();
  const [blameOn, setBlameOn] = useState(false);
  // Text changes open on their diff; images (and unchanged files) open on the file itself.
  const wantDiff = !!change && !IMAGE.test(path);
  const isMd = MARKDOWN.test(path);
  // Markdown opens rendered unless it has changes (then the diff comes first); the File tab shows the source.
  const firstView = focusLine ? 'file' : wantDiff ? 'diff' : isMd ? 'preview' : 'file';
  const [view, setView] = useState<'diff' | 'file' | 'preview'>(firstView);
  const [layout, setLayout] = useState<'unified' | 'split'>('unified');
  const [diff, setDiff] = useState<GitDiffResult | null>(null);
  const [file, setFile] = useState<GitFileResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const isImage = IMAGE.test(path);
  // "View at…": the same file as it was at another branch, tag or commit (read-only).
  const [atRef, setAtRef] = useState<string | null>(null);
  useEffect(() => { setAtRef(null); }, [path]);

  // A different file: pick the most useful tab for it. A file that stops/starts being changed: adjust too.
  useEffect(() => { setView(firstView); setImgFailed(false); }, [path, wantDiff]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let dead = false; setErr(null);
    const q = `path=${encodeURIComponent(path)}`;
    setBusy(true);
    const job = view === 'diff' && change
      ? api.get<GitDiffResult>(`/agents/${agent.id}/git/diff?${q}${change.oldPath ? `&old=${encodeURIComponent(change.oldPath)}` : ''}`).then((d) => !dead && setDiff(d))
      : isImage ? Promise.resolve()
      : api.get<GitFileResult>(`/agents/${agent.id}/git/file?${q}`).then((f) => !dead && setFile(f));
    job.catch((e) => !dead && setErr(e instanceof Error ? e.message : t('git.loadError'))).finally(() => !dead && setBusy(false));
    return () => { dead = true; };
  }, [agent.id, path, view, change?.status, change?.oldPath, stamp]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = useMemo(() => (diff && diff.path === path ? parseDiff(diff.diff) : null), [diff, path]);

  // The File view marks what changed since the last commit. New files are all added; for the rest, read the diff.
  const [markDiff, setMarkDiff] = useState<GitDiffResult | null>(null);
  const wholeNew = change?.status === 'untracked' || (change?.status === 'added' && !change.oldPath);
  useEffect(() => {
    setMarkDiff(null);
    if (view !== 'file' || !change || isImage || wholeNew || change.status === 'deleted' || change.status === 'conflict') return;
    let dead = false;
    api.get<GitDiffResult>(`/agents/${agent.id}/git/diff?path=${encodeURIComponent(path)}${change.oldPath ? `&old=${encodeURIComponent(change.oldPath)}` : ''}`).then((d) => !dead && setMarkDiff(d)).catch(() => undefined);
    return () => { dead = true; };
  }, [agent.id, path, view, change?.status, change?.oldPath, stamp]); // eslint-disable-line react-hooks/exhaustive-deps
  const markParsed = useMemo(() => (markDiff && markDiff.path === path ? parseDiff(markDiff.diff) : null), [markDiff, path]);
  const marks = useMemo(() => (markParsed ? changeMarks(markParsed) : null), [markParsed]);
  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash + 1) : ''; const name = path.slice(slash + 1);

  return (
    <section className="gx-preview" aria-label={path}>
      <header className="gx-phead">
        <div className="gx-ptitle">
          <span className="gx-path mono" title={path}><span className="dir">{dir}</span><b>{name}</b></span>
          {ignored && <span className="gx-chip soft" title={t('git.ignored.hint')}>{t('git.ignored.chip')}</span>}
          {change && <span className={`gx-chip st-${change.status}`}>{t(`git.status.${change.status}`)}</span>}
          {change?.staged && <span className="gx-chip soft">{t('git.staged')}</span>}
          {change?.unstaged && change.status !== 'untracked' && <span className="gx-chip soft">{t('git.unstaged')}</span>}
          {change && (change.additions !== null || change.deletions !== null) && <span className="gx-counts"><i className="add">+{change.additions ?? 0}</i><i className="del">−{change.deletions ?? 0}</i></span>}
          {file && !change && <span className="muted small">{fmtBytes(file.size)}</span>}
        </div>
        <div className="gx-ptr">
            {change?.status !== 'untracked' && !ignored && <button type="button" className="btn ghost icon sm" title={t('git.file.history')} aria-label={t('git.file.history')} onClick={() => onHistory(path)}><History size={15} /></button>}
            {change?.status !== 'untracked' && !ignored && <RefPicker refs={refs} value={atRef ?? ''} onChange={setAtRef} compact label={t('git.file.viewAt')} extra={[{ value: '', label: t('git.file.viewAt') }]} />}
            {!isImage && !ignored && !atRef && change?.status !== 'deleted' && change?.status !== 'untracked' && change?.status !== 'conflict' && (() => {
              const on = blameOn && view === 'file';
              return <button type="button" className={`btn ghost icon sm ${on ? 'on' : ''}`} aria-pressed={on} aria-label={t('git.blame')} title={`${t('git.blame')}: ${t('git.blame.hint')}`} onClick={() => { if (view !== 'file') { setView('file'); setBlameOn(true); } else setBlameOn((x) => !x); }}><UserSearch size={15} /></button>;
            })()}
            <CopyBtn text={path} label={t('git.copyPath')} compact />
            {change && change.status !== 'conflict' && <button type="button" className="btn sm" title={t('git.discard.hint')} onClick={() => onDiscard(change)}><Undo2 size={14} />{t('git.discard')}</button>}
          </div>
        <div className="gx-ptools">
          <div className="gx-ptl">
            {(change || isMd) && <Segmented value={view} onChange={setView} options={[...(change ? [{ id: 'diff' as const, label: t('git.view.diff') }] : []), ...(isMd ? [{ id: 'preview' as const, label: t('git.view.preview') }] : []), { id: 'file' as const, label: t(isMd ? 'git.view.source' : 'git.view.file') }]} />}
            {view === 'diff' && change && <Segmented value={layout} onChange={setLayout} options={[{ id: 'unified', label: t('git.layout.unified') }, { id: 'split', label: t('git.layout.split') }]} />}
          </div>
        </div>
      </header>
      {change?.oldPath && <div className="gx-banner">{t('git.renamedFrom', { path: change.oldPath })}</div>}
      {atRef && <div className="gx-banner row gap-s"><span className="grow">{t('git.file.atRef', { ref: atRef })}</span><button className="btn sm" onClick={() => setAtRef(null)}>{t('git.file.backToCurrent')}</button></div>}
      {atRef ? <RefFile agent={agent} gitRef={atRef} path={change?.oldPath && atRef ? change.oldPath : path} toolbar={false} /> : <div className="gx-body">
        {err ? <p className="gx-note err">{err}</p> : busy && !parsed && !file ? <p className="gx-note">{t('git.loading')}</p> : view === 'diff' && change ? (
          parsed ? (
            parsed.binary ? <p className="gx-note">{t('git.diff.binary')}</p>
              : parsed.hunks.length === 0 ? <p className="gx-note">{t('git.diff.empty')}</p>
              : (<>{diff?.truncated && <div className="gx-banner">{t('git.diff.truncated')}</div>}<DiffView parsed={parsed} layout={layout} path={path} cutOff={!!diff?.truncated} onDiscardHunk={change?.status === 'modified' ? (i, h) => onDiscardHunk(path, i, h) : undefined} onDiscardLines={change?.status === 'modified' ? (i, h, lines) => onDiscardLines(path, i, h, lines) : undefined} /></>)
          ) : null
        ) : isImage && !imgFailed && change?.status !== 'deleted' ? (
          <div className="gx-image"><img src={`/api/agents/${agent.id}/git/raw?path=${encodeURIComponent(path)}&v=${stamp}`} alt={name} onError={() => setImgFailed(true)} /></div>
        ) : view === 'preview' && file && file.path === path ? (
          <div className="gx-md md">{file.truncated && <div className="gx-banner">{t('git.diff.truncated')}</div>}<ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (p) => <a {...p} target="_blank" rel="noreferrer" /> }}>{file.content}</ReactMarkdown></div>
        ) : file && file.path === path ? <FileView f={file} agent={agent} blame={blameOn} onOpenCommit={onOpenCommit} marks={marks} allNew={wholeNew} focusLine={focusLine} /> : isImage && imgFailed ? <p className="gx-note">{t('git.file.binary')}</p> : null}
      </div>}
    </section>
  );
}
