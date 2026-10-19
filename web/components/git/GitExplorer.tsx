'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, File, Folder, GitBranch, ListFilter, RefreshCw, Search, TextSearch, Undo2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { fmtDateTime, fmtNum, fmtTime } from '@/lib/format';
import { buildTree, flatten, parentsOf, type Row, type TreeNode } from '@/lib/git/gitTree';
import { readStored, writeStored } from '@/lib/hooks/usePersistentState';
import type { Agent, GitChange, GitListing, GitTagInfo, GrepHit, StashItem, SwitchPlan } from '@/lib/types';
import type { useGit } from '@/lib/git/useGit';
import { CopyBtn } from '@/components/chat/ToolCall';
import { useGitPrefs } from '@/lib/git/gitPrefs';
import { GitSettings } from './GitSettings';
import { TagList, TagView } from './TagBrowser';
import { CommitPreview } from './ChangesPreview';
import { CompareList, CompareView, type CompareSel } from './Compare';
import { useRefs } from './RefPicker';
import { ago } from '@/lib/meta';
import { ConfirmDialog } from '@/components/ui';
import { ConflictResolver } from './ConflictResolver';
import { SwitchDialog } from './SwitchDialog';
import { SaveStashDialog, StashList, StashPreview } from './StashManager';
import { ActionButtons, NoticeBanner, useGitActions } from './GitActions';
import { BranchMenu } from './BranchMenu';
import { CommitDialog } from './CommitDialog';
import { HistoryList } from './HistoryList';
import { DiscardConfirm, type DiscardFile, type DiscardSummary } from './DiscardConfirm';
import { FilePreview } from './FilePreview';
import { FileTree } from './FileTree';
import { GitTabs, GIT_MODES, GIT_PANEL_ID, gitTabId, type GitMode } from './GitTabs';

/** Where the person was in an agent's explorer: the file, the folders that lead to it, and the tab with what it had selected. Every field is optional. */
interface Where { file?: string; dirs?: string[]; mode?: GitMode; hist?: string; commit?: string; cmp?: CompareSel; stash?: string; tag?: string }
const WHERE_MAX_DIRS = 200;
const TREE_MAX_ROWS = 2000;   // the file tree is a list of buttons, not windowed: it shows this many and asks for a narrower filter

/* ------------------------------------------------------------------ explorer */

export function GitExplorer({ agent, git }: { agent: Agent; git: ReturnType<typeof useGit> }) {
  const { t } = useI18n();
  const { status, tree, loading, error, refresh } = git;
  const [sel, setSel] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [mode, setMode] = useState<GitMode>('files');
  const [histPath, setHistPath] = useState<string | null>(null);       // history of one file
  const [cmp, setCmp] = useState<CompareSel>({ base: '', head: '' });
  // Search inside the files (not just names)
  const [byContent, setByContent] = useState(false);
  const [hits, setHits] = useState<{ q: string; hits: GrepHit[]; truncated: boolean } | null>(null);
  const [focusLine, setFocusLine] = useState<{ line: number; key: number } | undefined>();
  const filterRef = useRef<HTMLInputElement>(null);
  const [tagSel, setTagSel] = useState<GitTagInfo | null>(null);
  const [stashes, setStashes] = useState<StashItem[] | null>(null);
  const [stashSel, setStashSel] = useState<string | null>(null);
  const [saveStash, setSaveStash] = useState(false);
  const [switchPlan, setSwitchPlan] = useState<SwitchPlan | null>(null);
  const [cancelSmart, setCancelSmart] = useState(false);
  const [commitSel, setCommitSel] = useState<string | null>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const actions = useGitActions(agent, () => refresh());
  const [discardAsk, setDiscardAsk] = useState<{ files: string[]; all: boolean; summary?: DiscardSummary; file?: DiscardFile; go: () => Promise<boolean> } | null>(null);
  const prefs = useGitPrefs();
  const seenDirs = useRef<Set<string>>(new Set());

  const repo = status && status.isRepo ? status : null;
  const refs = useRefs(agent, repo?.head?.sha);
  const files = tree && tree.isRepo ? tree.files : null;
  const ignoredTop = tree && tree.isRepo ? tree.ignored : null;
  const [ignoredKids, setIgnoredKids] = useState<Record<string, { name: string; dir: boolean }[]>>({});
  useEffect(() => { setIgnoredKids({}); }, [agent.id, agent.effective.cwd]);
  const root = useMemo(() => (repo && files ? buildTree(files, repo.changes, prefs.showIgnored ? ignoredTop ?? [] : [], ignoredKids) : null), [repo, files, ignoredTop, ignoredKids, prefs.showIgnored]);
  // Is a path hidden by .gitignore? (it is, or sits inside, one of the ignored entries)
  const isIgnored = useMemo(() => { const tops = (ignoredTop ?? []).map((e) => e.replace(/\/$/, '')); return (p: string) => tops.some((t) => p === t || p.startsWith(`${t}/`)); }, [ignoredTop]);
  const changeOf = useMemo(() => new Map((repo?.changes ?? []).map((c) => [c.path, c])), [repo]);
  const totals = useMemo(() => (repo?.changes ?? []).reduce((a, c) => ({ add: a.add + (c.additions ?? 0), del: a.del + (c.deletions ?? 0) }), { add: 0, del: 0 }), [repo]);

  // Open the branches that lead to changes, including ones that appear while the agent works.
  useEffect(() => {
    if (!root) return;
    const want = new Set<string>();
    const walk = (n: TreeNode) => { for (const c of n.children) if (c.type === 'dir') { if (!seenDirs.current.has(c.path) && (c.changed > 0 || seenDirs.current.size === 0 && (files?.length ?? 0) <= 40)) want.add(c.path); walk(c); } };
    walk(root);
    const record = (n: TreeNode) => { for (const c of n.children) if (c.type === 'dir') { seenDirs.current.add(c.path); record(c); } };
    record(root);
    if (want.size) setExpanded((e) => new Set([...e, ...want]));
  }, [root]); // eslint-disable-line react-hooks/exhaustive-deps
  // Coming back, the explorer opens where the person was; the first conflict or change is only the fallback. One place decides, once per mount, and the record is written only after that
  // (`ready`), so a mount cannot save its own empty state over a good record.
  const whereKey = `hive-am.git.where.${agent.id}`;
  const [ready, setReady] = useState(false);
  const wantTag = useRef<string | null>(null);
  useEffect(() => {
    if (!root || ready) return;
    const w = readStored<Where>(whereKey, {});
    const exists = (p?: string): p is string => !!p && (!!files?.includes(p) || !!repo?.changes.some((c) => c.path === p));
    const file = exists(w.file) ? w.file : (repo?.changes.find((c) => c.status === 'conflict') ?? repo?.changes[0])?.path ?? null;
    if (file) setSel(file);
    const dirs = [...(Array.isArray(w.dirs) ? w.dirs.filter((d) => typeof d === 'string') : []), ...(exists(w.file) ? parentsOf(w.file) : [])];
    if (dirs.length) setExpanded((e) => new Set([...e, ...dirs]));
    if (w.mode && GIT_MODES.includes(w.mode)) setMode(w.mode);
    if (typeof w.hist === 'string') setHistPath(w.hist);
    if (typeof w.commit === 'string') setCommitSel(w.commit);
    if (w.cmp && typeof w.cmp.base === 'string' && typeof w.cmp.head === 'string') setCmp(w.cmp);
    if (typeof w.stash === 'string') setStashSel(w.stash);
    if (typeof w.tag === 'string') wantTag.current = w.tag;
    setReady(true);
  }, [root]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ready) return;
    writeStored(whereKey, {
      file: sel ?? undefined, dirs: [...expanded].slice(0, WHERE_MAX_DIRS), mode, hist: histPath ?? undefined, commit: commitSel ?? undefined,
      cmp: cmp.base || cmp.head ? cmp : undefined, stash: stashSel ?? undefined, tag: tagSel?.name ?? wantTag.current ?? undefined,
    } satisfies Where);
  }, [ready, whereKey, sel, expanded, mode, histPath, commitSel, cmp, stashSel, tagSel]);

  useEffect(() => {
    let dead = false;
    api.get<StashItem[]>(`/agents/${agent.id}/git/stashes`).then((l) => { if (!dead) { setStashes(l); setStashSel((s) => (s && l.some((x) => x.sha === s) ? s : l[0]?.sha ?? null)); } }).catch(() => undefined);
    return () => { dead = true; };
  }, [agent.id, repo?.generatedAt]);

  // Searching the content runs git once typing pauses; fewer than 2 characters search nothing.
  useEffect(() => {
    const q = query.trim();
    if (!byContent || q.length < 2) { setHits(null); return; }
    let dead = false;
    const id = setTimeout(() => api.get<{ hits: GrepHit[]; truncated: boolean }>(`/agents/${agent.id}/git/grep?q=${encodeURIComponent(q)}`).then((r) => !dead && setHits({ q, ...r })).catch(() => !dead && setHits({ q, hits: [], truncated: false })), 350);
    return () => { dead = true; clearTimeout(id); };
  }, [agent.id, byContent, query, repo?.generatedAt]);

  // `/` jumps to the filter; Alt+1…5 switch tabs.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null, typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); setMode('files'); setTimeout(() => filterRef.current?.focus(), 0); }
      else if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-5]$/.test(e.key)) { e.preventDefault(); setMode(GIT_MODES[Number(e.key) - 1]); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);

  const rows: Row[] = useMemo(() => (root ? flatten(root, expanded, { query, onlyChanged }) : []), [root, expanded, query, onlyChanged]);
  const shown = useMemo(() => rows.slice(0, TREE_MAX_ROWS), [rows]);

  const toggle = (p: string) => setExpanded((e) => { const n = new Set(e); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  /** Opening an ignored folder lists it first (one level; they can hold 100k files). */
  const kidsRef = useRef(ignoredKids); kidsRef.current = ignoredKids;
  const openDir = useCallback((node: TreeNode) => {
    toggle(node.path);
    if (node.ignored && node.lazy && !(node.path in kidsRef.current)) {
      api.get<GitListing>(`/agents/${agent.id}/git/ls?path=${encodeURIComponent(node.path)}`).then((l) => setIgnoredKids((k) => ({ ...k, [node.path]: l.entries }))).catch(() => setIgnoredKids((k) => ({ ...k, [node.path]: [] })));
    }
  }, [agent.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickFile = useCallback((p: string) => { setFocusLine(undefined); setSel(p); }, []);

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

  // Switching happens directly: git carries clean changes over and anything else goes through a stash and the conflict
  // resolver. The one question is when other agents are working in this repository.
  const doSwitch = (plan: SwitchPlan) => actions.run('switch', plan.carried ? t('git.done.switchCarried', { branch: plan.to, count: plan.carried }) : t('git.done.switch', { branch: plan.to }),
    plan.overlap.length || plan.collisions.length ? 'switch-smart' : 'switch', { branch: plan.to });
  const requestSwitch = async (branch: string) => {
    try {
      const plan = await api.get<SwitchPlan>(`/agents/${agent.id}/git/switch-plan?branch=${encodeURIComponent(branch)}`);
      if (plan.others.length || plan.selfRunning) setSwitchPlan(plan); else await doSwitch(plan);
    } catch (e) { actions.setNotice({ title: t('git.notice.failed', { action: t('git.done.switch', { branch }) }), text: e instanceof Error ? e.message : 'error', diverged: false }); }
  };

  // Discarding goes straight through, except when it would delete files that are in no commit: that asks first.
  const doomed = (cs: GitChange[]) => cs.filter((c) => c.status === 'untracked' || (c.status === 'added' && !c.oldPath)).map((c) => c.path);
  // Discarding a file always asks too: a new file is deleted, anything else goes back to the last commit.
  const discardFile = (c: GitChange) => setDiscardAsk({ files: doomed([c]), all: false, file: { path: c.path, status: c.status, oldPath: c.oldPath, add: c.additions ?? 0, del: c.deletions ?? 0 }, go: async () => {
    const ok = await actions.run('discard', t('git.done.discard'), 'discard', { path: c.path, oldPath: c.oldPath });
    if (ok && doomed([c]).length) setSel(null);
    return ok;
  } });
  // "Discard all" always asks: it is the one action that can throw away a lot of work in a single click.
  const discardAll = () => {
    const gone = doomed(status.changes);
    setDiscardAsk({ files: gone, all: true, summary: { restore: status.changes.length - gone.length, add: totals.add, del: totals.del },
      go: async () => { const ok = await actions.run('discard-all', t('git.done.discard'), 'discard-all'); if (ok) setSel(null); return ok; } });
  };
  const discardHunk = (path: string, index: number, header: string) => void actions.run('discard-hunk', t('git.done.discard'), 'discard-hunk', { path, index, header });
  const discardLines = (path: string, index: number, header: string, lines: number[]) => void actions.run('discard-lines', t('git.done.discard'), 'discard-lines', { path, index, header, lines });
  const upd = fmtTime(status.generatedAt);

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
        <span className="gx-sum">{status.changes.length === 0 ? <span className="muted">{t('git.clean')}</span> : <><span title={t('git.summary', { count: status.changes.length })} aria-label={t('git.summary', { count: status.changes.length })}><b>{status.changes.length}</b> <span className="muted">{t('git.files.short')}</span> <i className="add">+{fmtNum(totals.add)}</i> <i className="del">−{fmtNum(totals.del)}</i></span></>}</span>
        <BranchMenu agent={agent} a={actions} current={status.branch} onSwitch={(b) => void requestSwitch(b)} />
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
        const title = status.state === 'merge' ? t('git.state.merge') : status.state === 'rebase' ? t('git.state.rebase') : t('git.state.stash');
        return (
          <div className="gx-state" role="status">
            <b>{title}</b>
            <span className="grow">{status.state === 'stash' && status.stash && <>{t('git.state.stash.hint', { from: status.stash.from, to: status.stash.to })} · </>}{left.length > 0 ? t('git.state.conflicts', { count: left.length }) : t('git.state.ready')}</span>
            {left.length === 0 && (status.state === 'merge'
              ? <button className="btn primary sm" disabled={!!actions.busy} onClick={() => setCommitOpen(true)}>{t('git.state.finishMerge')}</button>
              : status.state === 'rebase'
                ? <button className="btn primary sm" disabled={!!actions.busy} onClick={() => void actions.run('continue', t('git.done.rebaseContinue'), 'rebase-continue')}>{t('git.state.continueRebase')}</button>
                : <button className="btn primary sm" disabled={!!actions.busy} onClick={() => void actions.run('smart', t('git.done.smartFinish'), 'smart-finish')}>{t('git.state.finishStash')}</button>)}
            {status.state === 'stash'
              ? <button className="btn sm danger" disabled={!!actions.busy} onClick={() => setCancelSmart(true)}>{t('git.state.cancelStash')}</button>
              : <button className="btn sm danger" disabled={!!actions.busy} onClick={() => void actions.run('abort', t('git.done.mergeAbort'), 'merge-abort')}>{status.state === 'merge' ? t('git.state.abortMerge') : t('git.state.abortRebase')}</button>}
          </div>
        );
      })()}
      <NoticeBanner a={actions} />
      {status.scope && <div className="gx-scope">{t('git.scope', { path: status.scope })}</div>}

      <div className="gx-main">
        <aside className="gx-tree" aria-label={t('git.filesLabel')}>
          <GitTabs mode={mode} onChange={setMode} stashCount={stashes?.length ?? 0} label={t('git.filesLabel')} />
          <div className="gx-sidepanel" id={GIT_PANEL_ID} role="tabpanel" aria-labelledby={gitTabId(mode)}>
          {mode === 'stashes' ? <StashList stashes={stashes} sel={stashSel} onSelect={setStashSel} onSave={() => setSaveStash(true)} canSave={status.changes.length > 0 && !status.state} />
            : mode === 'tags' ? <TagList agent={agent} sel={tagSel?.name ?? null} onSelect={setTagSel} onLoaded={(tags) => { const want = wantTag.current; wantTag.current = null; if (want && !tagSel) setTagSel(tags.find((x) => x.name === want) ?? null); }} />
            : mode === 'compare' ? <CompareList refs={refs} sel={cmp} onChange={setCmp} />
            : mode === 'history' ? <HistoryList agent={agent} head={status.head?.sha} sel={commitSel} onSelect={setCommitSel} refs={refs} path={histPath} onClearPath={() => setHistPath(null)} /> : (<>
          <div className="gx-filter">
            <div className="search"><Search size={14} /><input ref={filterRef} className="input" placeholder={byContent ? t('git.search.placeholder') : t('git.filterPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('git.filterPlaceholder')} /></div>
            <div className="seg icons" role="group" aria-label={t('git.search.name')}>
              <button type="button" aria-pressed={!byContent} title={t('git.search.name')} aria-label={t('git.search.name')} onClick={() => setByContent(false)}><File size={14} /></button>
              <button type="button" aria-pressed={byContent} title={t('git.search.content')} aria-label={t('git.search.content')} onClick={() => setByContent(true)}><TextSearch size={14} /></button>
            </div>
            {!byContent && <button type="button" className={`btn sm gx-onlych ${onlyChanged ? 'primary' : ''}`} aria-pressed={onlyChanged} title={t('git.filter.changed')} onClick={() => setOnlyChanged((x) => !x)}><ListFilter size={14} />{status.changes.length > 0 && <span className="ct">{status.changes.length}</span>}</button>}
          </div>
          {byContent ? (
            <div className="gx-list gx-hits">
              {query.trim().length < 2 ? <p className="gx-note">{t('git.search.min')}</p> : !hits || hits.q !== query.trim() ? <p className="gx-note">{t('git.search.searching')}</p> : hits.hits.length === 0 ? <p className="gx-note">{t('git.search.none', { query: hits.q })}</p> : (<>
                {hits.hits.map((h, i) => (
                  <button key={`${h.path}:${h.line}:${i}`} type="button" className={`gx-hit ${sel === h.path && focusLine?.line === h.line ? 'sel' : ''}`} onClick={() => { setSel(h.path); setFocusLine({ line: h.line, key: Date.now() }); }} title={`${h.path}:${h.line}`}>
                    <span className="mono nm">{h.path}<i>:{h.line}</i></span><span className="mono tx">{h.text.trim()}</span>
                  </button>
                ))}
                {hits.truncated && <p className="gx-note">{t('git.search.capped', { count: hits.hits.length })}</p>}
              </>)}
            </div>
          ) : (
          <div className="gx-list">
            {!root ? <p className="gx-note">{t('git.loading')}</p> : shown.length === 0 ? (
              <p className="gx-note">{query ? t('git.noMatch', { query }) : onlyChanged ? t('git.clean') : t('git.noFiles')}</p>
            ) : <FileTree rows={shown} expanded={expanded} forceOpen={!!(query || onlyChanged)} sel={sel} onToggle={openDir} onSelect={pickFile} label={t('git.filesLabel')} />}
            {rows.length > shown.length && <p className="gx-note">{t('git.rowsCapped', { count: shown.length })}</p>}
            {tree?.isRepo && tree.truncated && <p className="gx-note">{t('git.treeTruncated', { count: tree.files.length })}</p>}
          </div>
          )}
          </>)}
          </div>
        </aside>

        {mode === 'stashes' ? (stashes?.find((x) => x.sha === stashSel) ? <StashPreview key={stashSel} agent={agent} stash={stashes.find((x) => x.sha === stashSel)!} a={actions} /> : <div className="gx-preview"><div className="gx-empty"><p>{t('git.stash.empty')}</p></div></div>)
          : mode === 'compare' ? <CompareView agent={agent} sel={cmp} />
          : mode === 'tags' ? (tagSel ? <TagView key={tagSel.name} agent={agent} tag={tagSel} onChanged={() => void refresh()} /> : <div className="gx-preview"><div className="gx-empty"><p>{t('git.tags.select')}</p></div></div>)
          : mode === 'history' ? (commitSel ? <CommitPreview key={`${commitSel}|${histPath ?? ''}`} agent={agent} sha={commitSel} focus={histPath ?? undefined} /> : <div className="gx-preview"><div className="gx-empty"><p>{t('git.hist.select')}</p></div></div>)
          : sel && selChange?.status === 'conflict' ? <ConflictResolver key={sel} agent={agent} path={sel} state={status.state} a={actions} onResolved={() => { void refresh(); }} />
          : sel ? <FilePreview key={sel} agent={agent} path={sel} ignored={isIgnored(sel)} change={selChange} stamp={status.generatedAt} refs={refs} focusLine={focusLine} onHistory={(p) => { setHistPath(p); setCommitSel(null); setMode('history'); }} onOpenCommit={(sha) => { setCommitSel(sha); setMode('history'); }} onDiscard={discardFile} onDiscardHunk={discardHunk} onDiscardLines={discardLines} /> : <div className="gx-preview"><div className="gx-empty"><p>{t('git.select')}</p></div></div>}
      </div>
      {switchPlan && <SwitchDialog agent={agent} plan={switchPlan} a={actions} onClose={() => setSwitchPlan(null)} onGo={() => { const p = switchPlan; setSwitchPlan(null); void doSwitch(p); }} />}
      {saveStash && <SaveStashDialog a={actions} onClose={() => setSaveStash(false)} />}
      {cancelSmart && status.stash && (
        <ConfirmDialog danger title={t('git.state.cancelStash.title')} body={t('git.state.cancelStash.body', { from: status.stash.from })} confirmLabel={t('git.state.cancelStash.go')} onClose={() => setCancelSmart(false)}
          onConfirm={() => { if (!actions.busy) void actions.run('smart', t('git.done.smartCancel'), 'smart-cancel'); }} />
      )}
      {discardAsk && <DiscardConfirm files={discardAsk.files} all={discardAsk.all} summary={discardAsk.summary} file={discardAsk.file} onClose={() => setDiscardAsk(null)} onConfirm={() => { void discardAsk.go(); }} />}
      {commitOpen && <CommitDialog changes={status.changes} a={actions} initialMessage={status.mergeMsg} onClose={() => setCommitOpen(false)} />}
    </div>
  );
}
