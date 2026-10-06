'use client';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, File, FileCode, FileImage, FileText, Folder, FolderOpen, GitBranch, ListChecks, RefreshCw, Search, Undo2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { fmtBytes, fmtDateTime, fmtNum } from '@/lib/format';
import { hunkRange, parseDiff, toSplit, type DiffLine, type ParsedDiff, type SplitRow } from '@/lib/diff';
import { buildTree, defaultExpanded, flatten, type Row, type TreeNode } from '@/lib/gitTree';
import type { Agent, GitChange, GitChangeStatus, GitDiffResult, GitFileResult } from '@/lib/types';
import type { useGit } from '@/lib/useGit';
import { CopyBtn } from './ToolCall';
import { isCodeFile, languageOf } from '@/lib/highlight';
import { useHighlighted } from '@/lib/useHighlighted';
import { useGitPrefs } from '@/lib/gitPrefs';
import { GitSettings } from './GitSettings';
import { CodeCell, CodeLine } from './Code';
import { VirtualLines } from './VirtualLines';
import { StatusLetter } from './StatusLetter';
import { ago } from '@/lib/meta';
import { dateLocale } from '@/lib/i18n';
import { Segmented } from './ui';
import { ConflictResolver } from './ConflictResolver';
import { ActionButtons, BranchMenu, CommitDialog, DiscardConfirm, HistoryList, NoticeBanner, useGitActions } from './GitActions';
import type { GitBlame, GitCommitDetail } from '@/lib/types';

const TREE_MAX_ROWS = 2000;   // the file tree is a list of buttons, not windowed: it shows this many and asks for a narrower filter
const IMAGE = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i;

function FileIcon({ name }: { name: string }) {
  if (IMAGE.test(name)) return <FileImage size={15} />;
  if (/\.(md|mdx|txt|rst)$/i.test(name)) return <FileText size={15} />;
  if (languageOf(name)) return <FileCode size={15} />;
  return <File size={15} />;
}

/* ------------------------------------------------------------------ preview */

/** `k` is the position of a changed (+/-) line among its block's changed lines: what "discard lines" sends to the server. */
type DiffRowData = { t: 'hunk'; idx: number; header: string; section: string; changed: number } | { t: 'line'; l: DiffLine; hunk: number; k?: number } | { t: 'pair'; r: SplitRow };

/** Flatten the hunks into one list of fixed-height rows (a header row per hunk), ready to be windowed. */
function buildRows(parsed: ParsedDiff, layout: 'unified' | 'split', path: string): DiffRowData[] {
  const rows: DiffRowData[] = [];
  const code = isCodeFile(path);   // in prose / data files git's hunk context is just some earlier line: it would look like diff content
  parsed.hunks.forEach((h, idx) => {
    rows.push({ t: 'hunk', idx, header: hunkRange(h.header), section: code ? h.section : '', changed: h.lines.filter((l) => l.kind !== 'ctx').length });
    let k = 0;
    if (layout === 'unified') for (const l of h.lines) rows.push({ t: 'line', l, hunk: idx, k: l.kind === 'ctx' ? undefined : k++ });
    else for (const r of toSplit(h.lines)) rows.push({ t: 'pair', r });
  });
  return rows;
}

interface Picking { hunk: number; picked: Set<number> }
interface DiffActions { canPick: boolean; discardHunk: (index: number, header: string) => void; startPicking: (hunk: number) => void; stopPicking: () => void; pickAll: (hunk: number, count: number) => void; discardPicked: (hunk: number, header: string) => void }

const DiffRow = memo(function DiffRow({ row, path, ws, actions, picking, onPick }: { row: DiffRowData; path: string; ws: boolean; actions?: DiffActions; picking?: Picking | null; onPick?: (k: number) => void }) {
  const { t } = useI18n();
  if (row.t === 'hunk') {
    // A separator, not content: the two gutters hold "⋯" and the label stays put while the code scrolls sideways.
    return (
      <div className="vl-row hunk">
        <div className="vl-ln" style={{ left: 0 }}>⋯</div><div className="vl-ln" style={{ left: 'calc(6ch + 16px)' }}>⋯</div>
        <div className="vl-hl"><span className="rng mono">{row.header}</span>{row.section && <span className="hs" title={row.section}>{row.section}</span>}
          {actions && picking?.hunk === row.idx ? (<>
            <button type="button" className="hk-btn on" onClick={() => actions.pickAll(row.idx, row.changed)}>{t('git.discard.lines.all')}</button>
            <button type="button" className="hk-btn danger on" disabled={!picking.picked.size} onClick={() => actions.discardPicked(row.idx, row.header)}><Undo2 size={12} />{t('git.discard.lines.go', { count: picking.picked.size })}</button>
            <button type="button" className="hk-btn on" onClick={actions.stopPicking}>{t('common.cancel')}</button>
          </>) : actions && (<>
            {row.changed > 0 && actions.canPick && <button type="button" className="hk-btn" title={t('git.discard.lines.hint')} onClick={() => actions.startPicking(row.idx)}><ListChecks size={12} />{t('git.discard.lines')}</button>}
            <button type="button" className="hk-btn" title={t('git.discard.hunk.hint')} onClick={() => actions.discardHunk(row.idx, row.header)}><Undo2 size={12} />{t('git.discard.hunk')}</button>
          </>)}</div>
      </div>
    );
  }
  if (row.t === 'line') {
    const l = row.l;
    return (
      <div className={`vl-row ${l.kind} ${onPick && row.k !== undefined && picking?.picked.has(row.k) ? 'picked' : ''}`} onClick={onPick && row.k !== undefined ? () => onPick(row.k!) : undefined}>
        <div className="vl-ln" style={{ left: 0 }}>{l.oldNo ?? ''}</div><div className="vl-ln" style={{ left: 'calc(6ch + 16px)' }}>{l.newNo ?? ''}</div>
        <div className="vl-sg">{onPick && row.k !== undefined ? <input type="checkbox" checked={!!picking?.picked.has(row.k)} onChange={() => undefined} aria-label={t('git.discard.lines.pick')} /> : l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}</div>
        <div className="vl-cd"><CodeLine text={l.text} path={path} ws={ws} /></div>
      </div>
    );
  }
  const { left, right } = row.r;
  return (
    <div className="vl-row split">
      <div className={`vl-ln ${left?.kind ?? 'void'}`} style={{ left: 0 }}>{left?.oldNo ?? ''}</div>
      <div className={`vl-cd ${left?.kind ?? 'void'}`} title={left && left.text.length > 60 ? left.text : undefined}>{left ? <CodeLine text={left.text} path={path} ws={ws} /> : null}</div>
      <div className={`vl-ln ${right?.kind ?? 'void'}`}>{right?.newNo ?? ''}</div>
      <div className={`vl-cd ${right?.kind ?? 'void'}`} title={right && right.text.length > 60 ? right.text : undefined}>{right ? <CodeLine text={right.text} path={path} ws={ws} /> : null}</div>
    </div>
  );
});

/** A diff, windowed like the file view: only the rows on screen exist, so a huge diff costs the same as a small one. */
function DiffView({ parsed, layout, path, cutOff = false, onDiscardHunk, onDiscardLines }: { parsed: ParsedDiff; layout: 'unified' | 'split'; path: string; cutOff?: boolean; onDiscardHunk?: (index: number, header: string) => void; onDiscardLines?: (index: number, header: string, lines: number[]) => void }) {
  const { whitespace: ws } = useGitPrefs();
  const rows = useMemo(() => buildRows(parsed, layout, path), [parsed, layout, path]);
  const widest = useMemo(() => parsed.hunks.reduce((m, h) => h.lines.reduce((mm, l) => Math.max(mm, l.text.length), m), 0), [parsed]);
  // Unified: two gutters + sign + code, scrolling sideways for long lines. Split: always two equal halves of the screen;
  // a line longer than its half is cut with “…” (full text on hover) — the unified view shows it whole.
  const width = layout === 'unified' ? `calc(12ch + 32px + 18px + ${widest}ch + 24px)` : undefined;
  // Picking individual lines is a mode of one block at a time (unified view only).
  const [picking, setPicking] = useState<Picking | null>(null);
  useEffect(() => { setPicking(null); }, [parsed, layout]);
  const toggle = (k: number) => setPicking((p) => { if (!p) return p; const n = new Set(p.picked); if (n.has(k)) n.delete(k); else n.add(k); return { ...p, picked: n }; });
  const actions: DiffActions | undefined = onDiscardHunk ? {
    canPick: layout === 'unified' && !!onDiscardLines,
    discardHunk: onDiscardHunk,
    startPicking: (hunk) => setPicking({ hunk, picked: new Set() }),
    stopPicking: () => setPicking(null),
    pickAll: (hunk, count) => setPicking({ hunk, picked: new Set(Array.from({ length: count }, (_, i) => i)) }),
    discardPicked: (hunk, header) => { if (picking && onDiscardLines) { const lines = [...picking.picked].sort((a, b) => a - b); setPicking(null); onDiscardLines(hunk, header, lines); } },
  } : undefined;
  return (
    <div className={`vf is-${layout}`} style={{ ['--vl-left' as never]: '0px' }}>
      {parsed.meta.length > 0 && <div className="gx-meta">{parsed.meta.join(' · ')}</div>}
      <div className="vf-main">
        <VirtualLines count={rows.length} width={width} render={(i) => { const r = rows[i]; const mine = r.t === 'line' && picking?.hunk === r.hunk; return <DiffRow key={i} row={r} path={path} ws={ws} actions={r.t === 'hunk' && !(cutOff && r.idx === parsed.hunks.length - 1) ? actions : undefined} picking={r.t === 'hunk' || mine ? picking : undefined} onPick={mine ? toggle : undefined} />; }} />
      </div>
    </div>
  );
}

const GUTTER_CH = 6;           // line-number column, in characters
const BLAME_PX = 210;          // blame column width

/** The file, line by line. Only the rows on screen are in the DOM (see VirtualLines), so size does not matter. */
function FileView({ f, agent, blame: blameOn, onOpenCommit }: { f: GitFileResult; agent: Agent; blame: boolean; onOpenCommit: (sha: string) => void }) {
  const { t } = useI18n();
  const { whitespace: ws } = useGitPrefs();
  const [blame, setBlame] = useState<GitBlame | null>(null);
  const [blameErr, setBlameErr] = useState<string | null>(null);
  const lines = useHighlighted(f.content, f.path);
  const html = useMemo(() => (lines.length && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines), [lines]);
  const widest = useMemo(() => f.content.split('\n').reduce((m, l) => Math.max(m, l.length), 0), [f.content]);

  useEffect(() => {
    if (!blameOn || f.source !== 'worktree') { setBlame(null); setBlameErr(null); return; }
    let dead = false;
    api.get<GitBlame>(`/agents/${agent.id}/git/blame?path=${encodeURIComponent(f.path)}`).then((b) => { if (!dead) { setBlame(b); setBlameErr(null); } }).catch((e) => !dead && setBlameErr(e instanceof Error ? e.message : t('git.loadError')));
    return () => { dead = true; };
  }, [blameOn, agent.id, f.path, f.source]); // eslint-disable-line react-hooks/exhaustive-deps

  // Blame: label only the first line of each run of lines from the same commit, and tint alternate runs.
  const runs = useMemo(() => {
    if (!blame) return null;
    let g = -1; return blame.lines.map((sha, i) => { const first = sha !== blame.lines[i - 1]; if (first) g++; return { first, g: g % 2 }; });
  }, [blame]);

  if (f.binary) return <p className="gx-note">{t('git.file.binary')}</p>;
  if (html.length === 0) return <p className="gx-note">{t('git.file.empty')}</p>;
  const left = blame ? BLAME_PX : 0;
  return (
    <div className="vf">
      {f.source === 'head' && <div className="gx-banner">{t('git.file.deleted')}</div>}
      {f.truncated && <div className="gx-banner">{t('git.file.truncated')}</div>}
      {blameErr && <div className="gx-banner">{blameErr}</div>}
      {blame?.truncated && <div className="gx-banner">{t('git.blame.truncated', { count: blame.lines.length })}</div>}
      <div className="vf-main" style={{ ['--vl-left' as never]: `${left}px` }}>
        <VirtualLines count={html.length} width={`calc(${left}px + ${GUTTER_CH}ch + ${widest}ch + 40px)`} render={(i) => {
          const sha = blame?.lines[i]; const c = sha ? blame!.commits[sha] : undefined; const run = runs?.[i];
          return (
            <div key={i} className={`vl-row ${run ? `bl-g${run.g}` : ''}`}>
              {blame && (
                <div className={`vl-bl ${run?.first ? 'first' : ''}`}>
                  {run?.first && c && (c.uncommitted ? <span className="muted">{t('git.blame.uncommitted')}</span>
                    : <button type="button" className="bl-btn" title={`${c.summary}\n${c.author} · ${fmtDateTime(c.time)}`} onClick={() => onOpenCommit(sha!)}><span className="mono sha">{c.short}</span><span className="who">{c.author}</span><span className="when">{ago(c.time)}</span></button>)}
                </div>
              )}
              <div className="vl-ln">{i + 1}</div>
              <div className="vl-cd"><CodeCell html={html[i]} ws={ws} /></div>
            </div>
          );
        }} />
      </div>
    </div>
  );
}

function Preview({ agent, path, change, stamp, onOpenCommit, onDiscard, onDiscardHunk, onDiscardLines }: { agent: Agent; path: string; change?: GitChange; stamp: number; onOpenCommit: (sha: string) => void; onDiscard: (c: GitChange) => void; onDiscardHunk: (path: string, index: number, header: string) => void; onDiscardLines: (path: string, index: number, header: string, lines: number[]) => void }) {
  const { t } = useI18n();
  const [blameOn, setBlameOn] = useState(false);
  // Text changes open on their diff; images (and unchanged files) open on the file itself.
  const wantDiff = !!change && !IMAGE.test(path);
  const [view, setView] = useState<'diff' | 'file'>(wantDiff ? 'diff' : 'file');
  const [layout, setLayout] = useState<'unified' | 'split'>('unified');
  const [diff, setDiff] = useState<GitDiffResult | null>(null);
  const [file, setFile] = useState<GitFileResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const isImage = IMAGE.test(path);

  // A different file: pick the most useful tab for it. A file that stops/starts being changed: adjust too.
  useEffect(() => { setView(wantDiff ? 'diff' : 'file'); setImgFailed(false); }, [path, wantDiff]);

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
  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash + 1) : ''; const name = path.slice(slash + 1);

  return (
    <section className="gx-preview" aria-label={path}>
      <header className="gx-phead">
        <div className="gx-ptitle">
          <span className="gx-path mono" title={path}><span className="dir">{dir}</span><b>{name}</b></span>
          {change && <span className={`gx-chip st-${change.status}`}>{t(`git.status.${change.status}`)}</span>}
          {change?.staged && <span className="gx-chip soft">{t('git.staged')}</span>}
          {change?.unstaged && change.status !== 'untracked' && <span className="gx-chip soft">{t('git.unstaged')}</span>}
          {change && (change.additions !== null || change.deletions !== null) && <span className="gx-counts"><i className="add">+{change.additions ?? 0}</i><i className="del">−{change.deletions ?? 0}</i></span>}
          {file && !change && <span className="muted small">{fmtBytes(file.size)}</span>}
        </div>
        <div className="gx-ptools">
          {change && <Segmented value={view} onChange={setView} options={[{ id: 'diff', label: t('git.view.diff') }, { id: 'file', label: t('git.view.file') }]} />}
          {view === 'diff' && change && <Segmented value={layout} onChange={setLayout} options={[{ id: 'unified', label: t('git.layout.unified') }, { id: 'split', label: t('git.layout.split') }]} />}
          {!isImage && change?.status !== 'deleted' && change?.status !== 'untracked' && change?.status !== 'conflict' && (() => {
            const on = blameOn && view === 'file';
            return <button type="button" className={`btn sm ${on ? 'primary' : ''}`} aria-pressed={on} title={t('git.blame.hint')} onClick={() => { if (view !== 'file') { setView('file'); setBlameOn(true); } else setBlameOn((x) => !x); }}>{t('git.blame')}</button>;
          })()}
          {change && change.status !== 'conflict' && <button type="button" className="btn sm" title={t('git.discard.hint')} onClick={() => onDiscard(change)}><Undo2 size={14} />{t('git.discard')}</button>}
          <CopyBtn text={path} label={t('git.copyPath')} />
        </div>
      </header>
      {change?.oldPath && <div className="gx-banner">{t('git.renamedFrom', { path: change.oldPath })}</div>}
      <div className="gx-body">
        {err ? <p className="gx-note err">{err}</p> : busy && !parsed && !file ? <p className="gx-note">{t('git.loading')}</p> : view === 'diff' && change ? (
          parsed ? (
            parsed.binary ? <p className="gx-note">{t('git.diff.binary')}</p>
              : parsed.hunks.length === 0 ? <p className="gx-note">{t('git.diff.empty')}</p>
              : (<>{diff?.truncated && <div className="gx-banner">{t('git.diff.truncated')}</div>}<DiffView parsed={parsed} layout={layout} path={path} cutOff={!!diff?.truncated} onDiscardHunk={change?.status === 'modified' ? (i, h) => onDiscardHunk(path, i, h) : undefined} onDiscardLines={change?.status === 'modified' ? (i, h, lines) => onDiscardLines(path, i, h, lines) : undefined} /></>)
          ) : null
        ) : isImage && !imgFailed && change?.status !== 'deleted' ? (
          <div className="gx-image"><img src={`/api/agents/${agent.id}/git/raw?path=${encodeURIComponent(path)}&v=${stamp}`} alt={name} onError={() => setImgFailed(true)} /></div>
        ) : file && file.path === path ? <FileView f={file} agent={agent} blame={blameOn} onOpenCommit={onOpenCommit} /> : isImage && imgFailed ? <p className="gx-note">{t('git.file.binary')}</p> : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ explorer */

export function GitExplorer({ agent, git }: { agent: Agent; git: ReturnType<typeof useGit> }) {
  const { t } = useI18n();
  const { status, tree, loading, error, refresh } = git;
  const [sel, setSel] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [mode, setMode] = useState<'files' | 'history'>('files');
  const [commitSel, setCommitSel] = useState<string | null>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const actions = useGitActions(agent, () => refresh());
  const [discardAsk, setDiscardAsk] = useState<{ files: string[]; all: boolean; go: () => Promise<boolean> } | null>(null);
  const prefs = useGitPrefs();
  const seenDirs = useRef<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  const repo = status && status.isRepo ? status : null;
  const files = tree && tree.isRepo ? tree.files : null;
  const root = useMemo(() => (repo && files ? buildTree(files, repo.changes) : null), [repo, files]);
  const changeOf = useMemo(() => new Map((repo?.changes ?? []).map((c) => [c.path, c])), [repo]);
  const totals = useMemo(() => (repo?.changes ?? []).reduce((a, c) => ({ add: a.add + (c.additions ?? 0), del: a.del + (c.deletions ?? 0) }), { add: 0, del: 0 }), [repo]);

  // Open the branches that lead to changes — including ones that appear while the agent works.
  useEffect(() => {
    if (!root) return;
    const want = new Set<string>();
    const walk = (n: TreeNode) => { for (const c of n.children) if (c.type === 'dir') { if (!seenDirs.current.has(c.path) && (c.changed > 0 || seenDirs.current.size === 0 && (files?.length ?? 0) <= 40)) want.add(c.path); walk(c); } };
    walk(root);
    const record = (n: TreeNode) => { for (const c of n.children) if (c.type === 'dir') { seenDirs.current.add(c.path); record(c); } };
    record(root);
    if (want.size) setExpanded((e) => new Set([...e, ...want]));
  }, [root]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (root && sel === null && repo?.changes.length) setSel((repo.changes.find((c) => c.status === 'conflict') ?? repo.changes[0]).path); }, [root]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows: Row[] = useMemo(() => (root ? flatten(root, expanded, { query, onlyChanged }) : []), [root, expanded, query, onlyChanged]);
  const shown = rows.slice(0, TREE_MAX_ROWS);

  const toggle = (p: string) => setExpanded((e) => { const n = new Set(e); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const onKey = (e: React.KeyboardEvent) => {
    const btns = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[Math.min(btns.length - 1, i + 1)]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); btns[Math.max(0, i - 1)]?.focus(); }
    else if (i >= 0 && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      const el = btns[i]; if (el.dataset.dir !== '1') return;
      const open = el.getAttribute('aria-expanded') === 'true';
      if ((e.key === 'ArrowRight' && !open) || (e.key === 'ArrowLeft' && open)) { e.preventDefault(); toggle(el.dataset.path!); }
    }
  };

  /* ---- states without a tree ---- */
  if (error && !status) return <div className="gx"><div className="gx-empty"><h3>{t('git.error.title')}</h3><p>{error}</p><button className="btn" onClick={() => void refresh()}>{t('git.refresh')}</button></div></div>;
  if (!status) return <div className="gx"><div className="gx-empty"><p>{t('git.loading')}</p></div></div>;
  if (!status.isRepo) {
    return (
      <div className="gx"><div className="gx-empty">
        <Folder size={26} className="muted" />
        <h3>{status.reason === 'not-repo' ? t('git.notRepo.title') : status.reason === 'no-git' ? t('git.noGit.title') : t('git.error.title')}</h3>
        <p>{status.reason === 'not-repo' ? t('git.notRepo.body', { path: status.cwd.replace(/^\/home\/[^/]+/, '~') }) : status.reason === 'no-git' ? t('git.noGit.body') : status.message}</p>
        <button className="btn" onClick={() => void refresh()}><RefreshCw size={14} />{t('git.refresh')}</button>
      </div></div>
    );
  }

  const selChange = sel ? changeOf.get(sel) : undefined;

  // Discarding goes straight through, except when it would delete files that are in no commit: that asks first.
  const doomed = (cs: GitChange[]) => cs.filter((c) => c.status === 'untracked' || (c.status === 'added' && !c.oldPath)).map((c) => c.path);
  const askOrRun = (files: string[], all: boolean, go: () => Promise<boolean>) => { if (files.length) setDiscardAsk({ files, all, go }); else void go(); };
  const discardFile = (c: GitChange) => askOrRun(doomed([c]), false, async () => {
    const ok = await actions.run('discard', t('git.done.discard'), 'discard', { path: c.path, oldPath: c.oldPath });
    if (ok && doomed([c]).length) setSel(null);
    return ok;
  });
  const discardAll = () => askOrRun(doomed(status.changes), true, async () => { const ok = await actions.run('discard-all', t('git.done.discard'), 'discard-all'); if (ok) setSel(null); return ok; });
  const discardHunk = (path: string, index: number, header: string) => void actions.run('discard-hunk', t('git.done.discard'), 'discard-hunk', { path, index, header });
  const discardLines = (path: string, index: number, header: string, lines: number[]) => void actions.run('discard-lines', t('git.done.discard'), 'discard-lines', { path, index, header, lines });
  const upd = new Date(status.generatedAt).toLocaleTimeString(dateLocale());

  return (
    <div className="gx" data-gx-theme={prefs.theme} style={{ ['--g-tab' as never]: prefs.tabSize }}>
      <div className="gx-bar">
        {/* The branch and last commit can be long: the chip stays compact and opens the full details below. */}
        <button type="button" className="gx-branch" aria-expanded={infoOpen} aria-controls="gx-info" title={t('git.info.toggle')} onClick={() => setInfoOpen((o) => !o)}>
          <GitBranch size={14} />
          <span className="bn">{status.branch ?? (status.head ? `${t('git.detached')} ${status.head.sha}` : t('git.noCommitsBranch'))}</span>
          {status.head && <span className="sha">{status.head.sha}</span>}
          {status.upstream && (status.upstream.ahead > 0 || status.upstream.behind > 0) && <span className="ab" title={t('git.upstream')}>{status.upstream.ahead > 0 && `↑${status.upstream.ahead}`}{status.upstream.ahead > 0 && status.upstream.behind > 0 && ' '}{status.upstream.behind > 0 && `↓${status.upstream.behind}`}</span>}
          {infoOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span className="grow" />
        <span className="gx-sum">{status.changes.length === 0 ? <span className="muted">{t('git.clean')}</span> : <><b>{t('git.summary', { count: status.changes.length })}</b> <i className="add">+{fmtNum(totals.add)}</i> <i className="del">−{fmtNum(totals.del)}</i></>}</span>
        <BranchMenu agent={agent} a={actions} current={status.branch} />
        <ActionButtons a={actions} ahead={status.upstream?.ahead ?? 0} behind={status.upstream?.behind ?? 0} detached={!status.branch} changeCount={status.changes.length} onCommit={() => setCommitOpen(true)} />
        <button className="btn ghost icon sm" disabled={!!actions.busy || status.changes.length === 0 || !!status.state} onClick={discardAll} aria-label={t('git.discard.all')} title={status.state ? t('git.discard.all.blocked') : t('git.discard.all')}><Undo2 size={15} /></button>
        <GitSettings />
        <button className="btn ghost icon sm" onClick={() => void refresh()} aria-label={t('git.refresh')} title={`${t('git.refresh')} · ${t('git.updated', { time: upd })}`}><RefreshCw size={15} className={loading ? 'spin' : ''} /></button>
      </div>
      {infoOpen && (
        <dl id="gx-info" className="gx-info">
          <div><dt>{t('git.info.branch')}</dt><dd className="mono">{status.branch ?? (status.head ? `${t('git.detached')} ${status.head.sha}` : t('git.noCommitsBranch'))}{status.branch && <CopyBtn text={status.branch} label={t('git.info.copyBranch')} />}</dd></div>
          <div><dt>{t('git.info.upstreamLabel')}</dt><dd>{!status.upstream ? <span className="muted">{t('git.info.noUpstream')}</span> : status.upstream.ahead === 0 && status.upstream.behind === 0 ? t('git.info.inSync') : t('git.info.upstreamStatus', { ahead: status.upstream.ahead, behind: status.upstream.behind })}</dd></div>
          {status.head ? (<>
            <div><dt>{t('git.info.commit')}</dt><dd className="mono">{status.head.sha}<CopyBtn text={status.head.sha} label={t('git.info.copySha')} /></dd></div>
            <div><dt>{t('git.info.message')}</dt><dd className="msg">{status.head.subject || <span className="muted">—</span>}</dd></div>
            <div><dt>{t('git.info.author')}</dt><dd>{status.head.author}</dd></div>
            <div><dt>{t('git.info.when')}</dt><dd>{fmtDateTime(status.head.when)} <span className="muted">· {ago(Date.parse(status.head.when))}</span></dd></div>
          </>) : <div><dt>{t('git.info.commit')}</dt><dd className="muted">{t('git.noCommits')}</dd></div>}
        </dl>
      )}
      {agent.status === 'running' && <div className="gx-warn">{t('git.warn.running', { name: agent.name })}</div>}
      {status.state && (() => {
        const left = status.changes.filter((c) => c.status === 'conflict');
        return (
          <div className="gx-state" role="status">
            <b>{status.state === 'merge' ? t('git.state.merge') : t('git.state.rebase')}</b>
            <span className="grow">{left.length > 0 ? t('git.state.conflicts', { count: left.length }) : t('git.state.ready')}</span>
            {left.length === 0 && (status.state === 'merge'
              ? <button className="btn primary sm" disabled={!!actions.busy} onClick={() => setCommitOpen(true)}>{t('git.state.finishMerge')}</button>
              : <button className="btn primary sm" disabled={!!actions.busy} onClick={() => void actions.run('continue', t('git.done.rebaseContinue'), 'rebase-continue')}>{t('git.state.continueRebase')}</button>)}
            <button className="btn sm danger" disabled={!!actions.busy} onClick={() => void actions.run('abort', t('git.done.mergeAbort'), 'merge-abort')}>{status.state === 'merge' ? t('git.state.abortMerge') : t('git.state.abortRebase')}</button>
          </div>
        );
      })()}
      <NoticeBanner a={actions} />
      {status.scope && <div className="gx-scope">{t('git.scope', { path: status.scope })}</div>}

      <div className="gx-main">
        <aside className="gx-tree" aria-label={t('git.filesLabel')}>
          <div className="gx-tabs"><Segmented value={mode} onChange={setMode} options={[{ id: 'files', label: t('git.tab.files') }, { id: 'history', label: t('git.tab.history') }]} /></div>
          {mode === 'history' ? <HistoryList agent={agent} head={status.head?.sha} sel={commitSel} onSelect={setCommitSel} /> : (<>
          <div className="gx-filter">
            <div className="search"><Search size={14} /><input className="input" placeholder={t('git.filterPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('git.filterPlaceholder')} /></div>
            <Segmented value={onlyChanged ? 'changed' : 'all'} onChange={(v) => setOnlyChanged(v === 'changed')} options={[{ id: 'all', label: t('git.filter.all') }, { id: 'changed', label: `${t('git.filter.changed')}${status.changes.length ? ` · ${status.changes.length}` : ''}` }]} />
          </div>
          <div className="gx-list" ref={listRef} onKeyDown={onKey} role="tree">
            {!root ? <p className="gx-note">{t('git.loading')}</p> : shown.length === 0 ? (
              <p className="gx-note">{query ? t('git.noMatch', { query }) : onlyChanged ? t('git.clean') : t('git.noFiles')}</p>
            ) : shown.map(({ node, depth }) => {
              const isDir = node.type === 'dir'; const open = isDir && (query || onlyChanged || expanded.has(node.path));
              const c = node.change;
              return (
                <button key={node.path} data-row data-dir={isDir ? '1' : '0'} data-path={node.path} type="button" role="treeitem" aria-level={depth + 1} aria-expanded={isDir ? !!open : undefined} aria-selected={!isDir && sel === node.path}
                  className={`gx-row ${isDir ? 'dir' : 'file'} ${c ? `changed st-${c.status}` : ''} ${!isDir && sel === node.path ? 'sel' : ''} ${isDir && node.changed ? 'has-changes' : ''}`}
                  style={{ paddingLeft: 8 + depth * 14 }} title={node.path}
                  onClick={() => (isDir ? toggle(node.path) : setSel(node.path))}>
                  <span className="chev">{isDir ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}</span>
                  <span className="ico">{isDir ? (open ? <FolderOpen size={15} /> : <Folder size={15} />) : <FileIcon name={node.name} />}</span>
                  <span className="nm">{node.name}</span>
                  {isDir && node.changed > 0 && <span className="dirdot" title={t('git.dirChanged', { count: node.changed })}>{node.changed}</span>}
                  {c && (<span className="meta">
                    {(c.additions !== null || c.deletions !== null) && <span className="gx-counts sm"><i className="add">+{c.additions ?? 0}</i><i className="del">−{c.deletions ?? 0}</i></span>}
                    <StatusLetter status={c.status} titled />
                  </span>)}
                </button>
              );
            })}
            {rows.length > shown.length && <p className="gx-note">{t('git.rowsCapped', { count: shown.length })}</p>}
            {tree?.isRepo && tree.truncated && <p className="gx-note">{t('git.treeTruncated', { count: tree.files.length })}</p>}
          </div>
          </>)}
        </aside>

        {mode === 'history' ? (commitSel ? <CommitPreview key={commitSel} agent={agent} sha={commitSel} /> : <div className="gx-preview"><div className="gx-empty"><p>{t('git.hist.select')}</p></div></div>)
          : sel && selChange?.status === 'conflict' ? <ConflictResolver key={sel} agent={agent} path={sel} state={status.state} a={actions} onResolved={() => { void refresh(); }} />
          : sel ? <Preview key={sel} agent={agent} path={sel} change={selChange} stamp={status.generatedAt} onOpenCommit={(sha) => { setCommitSel(sha); setMode('history'); }} onDiscard={discardFile} onDiscardHunk={discardHunk} onDiscardLines={discardLines} /> : <div className="gx-preview"><div className="gx-empty"><p>{t('git.select')}</p></div></div>}
      </div>
      {discardAsk && <DiscardConfirm files={discardAsk.files} all={discardAsk.all} busy={!!actions.busy} onClose={() => setDiscardAsk(null)} onConfirm={async () => { const go = discardAsk.go; setDiscardAsk(null); await go(); }} />}
      {commitOpen && <CommitDialog changes={status.changes} a={actions} initialMessage={status.mergeMsg} onClose={() => setCommitOpen(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ commit preview (history) */

function CommitPreview({ agent, sha }: { agent: Agent; sha: string }) {
  const { t } = useI18n();
  const [d, setD] = useState<GitCommitDetail | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<GitDiffResult | null>(null);
  const [layout, setLayout] = useState<'unified' | 'split'>('unified');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let dead = false; setD(null); setFile(null); setDiff(null); setErr(null);
    api.get<GitCommitDetail>(`/agents/${agent.id}/git/commit?sha=${sha}`).then((x) => { if (dead) return; setD(x); setFile(x.files[0]?.path ?? null); }).catch((e) => !dead && setErr(e instanceof Error ? e.message : t('git.loadError')));
    return () => { dead = true; };
  }, [agent.id, sha]); // eslint-disable-line react-hooks/exhaustive-deps

  const f = d?.files.find((x) => x.path === file);
  useEffect(() => {
    if (!f) { setDiff(null); return; }
    let dead = false; setDiff(null);
    api.get<GitDiffResult>(`/agents/${agent.id}/git/commit-diff?sha=${sha}&path=${encodeURIComponent(f.path)}${f.oldPath ? `&old=${encodeURIComponent(f.oldPath)}` : ''}`).then((x) => !dead && setDiff(x)).catch((e) => !dead && setErr(e instanceof Error ? e.message : t('git.loadError')));
    return () => { dead = true; };
  }, [agent.id, sha, f?.path, f?.oldPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = useMemo(() => (diff && f && diff.path === f.path ? parseDiff(diff.diff) : null), [diff, f]);
  if (err) return <section className="gx-preview"><p className="gx-note err">{err}</p></section>;
  if (!d) return <section className="gx-preview"><p className="gx-note">{t('git.loading')}</p></section>;
  const [subject, ...rest] = d.message.split('\n');
  const body = rest.join('\n').trim();
  return (
    <section className="gx-preview gx-commitview" aria-label={subject}>
      <header className="gx-chead">
        <h3>{subject}</h3>
        {body && <pre className="gx-cbody">{body}</pre>}
        <div className="muted small row gap-s wrap"><span className="mono">{d.sha.slice(0, 10)}</span><CopyBtn text={d.sha} label={t('git.info.copySha')} /><span>· {d.author} · {fmtDateTime(d.date)}</span>
          <span>· {t('git.hist.files', { count: d.files.length })}</span></div>
      </header>
      {d.files.length === 0 ? <p className="gx-note">{t('git.hist.noFiles')}</p> : (
        <div className="gx-cfilelist" role="listbox">
          {d.files.map((x) => (
            <button key={x.path} role="option" aria-selected={file === x.path} className={`gx-cfile ${file === x.path ? 'sel' : ''}`} onClick={() => setFile(x.path)} title={x.oldPath ? `${x.oldPath} → ${x.path}` : x.path}>
              <StatusLetter status={x.status} /><span className="mono nm">{x.path}</span>
              {(x.additions !== null || x.deletions !== null) && <span className="gx-counts sm"><i className="add">+{x.additions ?? 0}</i><i className="del">−{x.deletions ?? 0}</i></span>}
            </button>
          ))}
        </div>
      )}
      {f && (<>
        <div className="gx-ptools" style={{ padding: '6px 14px' }}><Segmented value={layout} onChange={setLayout} options={[{ id: 'unified', label: t('git.layout.unified') }, { id: 'split', label: t('git.layout.split') }]} /></div>
        <div className="gx-body">
          {!parsed ? <p className="gx-note">{t('git.loading')}</p> : parsed.binary ? <p className="gx-note">{t('git.diff.binary')}</p> : parsed.hunks.length === 0 ? <p className="gx-note">{t('git.diff.empty')}</p>
            : (<>{diff?.truncated && <div className="gx-banner">{t('git.diff.truncated')}</div>}<DiffView parsed={parsed} layout={layout} path={f!.path} /></>)}
        </div>
      </>)}
    </section>
  );
}
