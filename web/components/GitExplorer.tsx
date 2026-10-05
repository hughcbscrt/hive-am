'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, File, FileCode, FileImage, FileText, Folder, FolderOpen, GitBranch, Lock, RefreshCw, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { fmtBytes, fmtNum } from '@/lib/format';
import { parseDiff, toSplit, type ParsedDiff } from '@/lib/diff';
import { buildTree, defaultExpanded, flatten, type Row, type TreeNode } from '@/lib/gitTree';
import type { Agent, GitChange, GitChangeStatus, GitDiffResult, GitFileResult } from '@/lib/types';
import type { useGit } from '@/lib/useGit';
import { CopyBtn } from './ToolCall';
import { Segmented } from './ui';

const LETTER: Record<GitChangeStatus, string> = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U', conflict: '!', typechange: 'T' };
const IMAGE = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i;
const CODE = /\.(tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|c|h|cpp|cs|rb|php|sh|css|scss|html|vue|svelte|sql|json|ya?ml|toml)$/i;
const MAX_ROWS = 2000;

function FileIcon({ name }: { name: string }) {
  if (IMAGE.test(name)) return <FileImage size={15} />;
  if (CODE.test(name)) return <FileCode size={15} />;
  if (/\.(md|mdx|txt|rst)$/i.test(name)) return <FileText size={15} />;
  return <File size={15} />;
}

/* ------------------------------------------------------------------ preview */

function DiffView({ parsed, layout }: { parsed: ParsedDiff; layout: 'unified' | 'split' }) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const total = parsed.hunks.reduce((n, h) => n + h.lines.length, 0);
  let budget = all ? Infinity : MAX_ROWS;
  const hunks = parsed.hunks.map((h) => { const lines = h.lines.slice(0, Math.max(0, budget)); budget -= lines.length; return { ...h, lines }; }).filter((h) => h.lines.length);
  return (
    <div className={`gx-diffwrap is-${layout}`}>
      {parsed.meta.length > 0 && <div className="gx-meta">{parsed.meta.join(' · ')}</div>}
      <table className={`difftable is-${layout}`}>
        <tbody>
          {hunks.map((h, hi) => (
            <HunkRows key={hi} h={h} layout={layout} />
          ))}
        </tbody>
      </table>
      {!all && total > MAX_ROWS && <button className="btn sm" style={{ margin: 12 }} onClick={() => setAll(true)}>{t('git.diff.showAll', { count: total, n: fmtNum(total) })}</button>}
    </div>
  );
}

function HunkRows({ h, layout }: { h: ParsedDiff['hunks'][number]; layout: 'unified' | 'split' }) {
  const head = (
    <tr className="hunk"><td colSpan={layout === 'split' ? 4 : 4}><span className="mono">{h.header.replace(/ ?@@ ?.*$/, '').replace(/^(@@ [^@]+@@).*$/, '$1')}</span>{h.section && <span className="hs"> {h.section}</span>}</td></tr>
  );
  if (layout === 'unified') {
    return (<>{head}{h.lines.map((l, i) => (
      <tr key={i} className={l.kind}><td className="ln">{l.oldNo ?? ''}</td><td className="ln">{l.newNo ?? ''}</td><td className="sg">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}</td><td className="cd">{l.text || ' '}</td></tr>
    ))}</>);
  }
  return (<>{head}{toSplit(h.lines).map((r, i) => (
    <tr key={i}>
      <td className={`ln ${r.left?.kind ?? 'void'}`}>{r.left?.oldNo ?? ''}</td><td className={`cd ${r.left?.kind ?? 'void'}`}>{r.left?.text ?? ''}</td>
      <td className={`ln ${r.right?.kind ?? 'void'}`}>{r.right?.newNo ?? ''}</td><td className={`cd ${r.right?.kind ?? 'void'}`}>{r.right?.text ?? ''}</td>
    </tr>
  ))}</>);
}

function FileView({ f }: { f: GitFileResult }) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const lines = useMemo(() => f.content.split('\n'), [f.content]);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (f.binary) return <p className="gx-note">{t('git.file.binary')}</p>;
  if (lines.length === 0) return <p className="gx-note">{t('git.file.empty')}</p>;
  const shown = all ? lines : lines.slice(0, MAX_ROWS);
  return (
    <div className="gx-diffwrap">
      {f.source === 'head' && <div className="gx-banner">{t('git.file.deleted')}</div>}
      {f.truncated && <div className="gx-banner">{t('git.file.truncated')}</div>}
      <table className="difftable is-file"><tbody>{shown.map((l, i) => <tr key={i}><td className="ln">{i + 1}</td><td className="cd">{l || ' '}</td></tr>)}</tbody></table>
      {!all && lines.length > MAX_ROWS && <button className="btn sm" style={{ margin: 12 }} onClick={() => setAll(true)}>{t('git.file.showAll', { count: lines.length, n: fmtNum(lines.length) })}</button>}
    </div>
  );
}

function Preview({ agent, path, change, stamp }: { agent: Agent; path: string; change?: GitChange; stamp: number }) {
  const { t } = useI18n();
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
          <CopyBtn text={path} label={t('git.copyPath')} />
        </div>
      </header>
      {change?.oldPath && <div className="gx-banner">{t('git.renamedFrom', { path: change.oldPath })}</div>}
      <div className="gx-body">
        {err ? <p className="gx-note err">{err}</p> : busy && !parsed && !file ? <p className="gx-note">{t('git.loading')}</p> : view === 'diff' && change ? (
          parsed ? (
            parsed.binary ? <p className="gx-note">{t('git.diff.binary')}</p>
              : parsed.hunks.length === 0 ? <p className="gx-note">{t('git.diff.empty')}</p>
              : (<>{diff?.truncated && <div className="gx-banner">{t('git.diff.truncated')}</div>}<DiffView parsed={parsed} layout={layout} /></>)
          ) : null
        ) : isImage && !imgFailed && change?.status !== 'deleted' ? (
          <div className="gx-image"><img src={`/api/agents/${agent.id}/git/raw?path=${encodeURIComponent(path)}&v=${stamp}`} alt={name} onError={() => setImgFailed(true)} /></div>
        ) : file && file.path === path ? <FileView f={file} /> : isImage && imgFailed ? <p className="gx-note">{t('git.file.binary')}</p> : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ explorer */

export function GitExplorer({ agent, git }: { agent: Agent; git: ReturnType<typeof useGit> }) {
  const { t, locale } = useI18n();
  const { status, tree, loading, error, refresh } = git;
  const [sel, setSel] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
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
  useEffect(() => { if (root && sel === null && repo?.changes.length) setSel(repo.changes[0].path); }, [root]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows: Row[] = useMemo(() => (root ? flatten(root, expanded, { query, onlyChanged }) : []), [root, expanded, query, onlyChanged]);
  const shown = rows.slice(0, MAX_ROWS);

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
  const upd = new Date(status.generatedAt).toLocaleTimeString(locale === 'es' ? 'es-MX' : 'en-US');

  return (
    <div className="gx">
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
        <span className="gx-lock" title={t('git.readOnlyHint')}><Lock size={12} />{t('git.readOnly')}</span>
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
            <div><dt>{t('git.info.when')}</dt><dd>{status.head.when}</dd></div>
          </>) : <div><dt>{t('git.info.commit')}</dt><dd className="muted">{t('git.noCommits')}</dd></div>}
        </dl>
      )}
      {status.scope && <div className="gx-scope">{t('git.scope', { path: status.scope })}</div>}

      <div className="gx-main">
        <aside className="gx-tree" aria-label={t('git.filesLabel')}>
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
                    <span className={`stl st-${c.status}`} title={t(`git.status.${c.status}`)}>{LETTER[c.status]}</span>
                  </span>)}
                </button>
              );
            })}
            {rows.length > shown.length && <p className="gx-note">{t('git.rowsCapped', { count: shown.length })}</p>}
            {tree?.isRepo && tree.truncated && <p className="gx-note">{t('git.treeTruncated', { count: tree.files.length })}</p>}
          </div>
        </aside>

        {sel ? <Preview key={sel} agent={agent} path={sel} change={selChange} stamp={status.generatedAt} /> : <div className="gx-preview"><div className="gx-empty"><p>{t('git.select')}</p></div></div>}
      </div>
    </div>
  );
}
