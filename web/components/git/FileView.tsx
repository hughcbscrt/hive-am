'use client';
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { fmtDateTime } from '@/lib/format';
import { hunkRange, type ChangeGroup, type ChangeMarks, type Hunk } from '@/lib/git/diff';
import { useHighlighted } from '@/lib/git/useHighlighted';
import { useGitPrefs } from '@/lib/git/gitPrefs';
import { ago } from '@/lib/meta';
import type { Agent, GitBlame, GitFileResult } from '@/lib/types';
import { CodeCell } from './Code';
import { DiffView } from './DiffView';
import { ROW_H, VirtualLines } from './VirtualLines';

/** The block of the diff behind a change mark, shown under the marked line. */
function ChangePeek({ path, hunk, index, total, extent, onClose, onGo }: { path: string; hunk: Hunk; index: number; total: number; extent: { from: number; to: number } | null; onClose: () => void; onGo: (block: number) => void }) {
  const { t } = useI18n();
  const parsed = useMemo(() => ({ meta: [], hunks: [hunk], binary: false }), [hunk]);
  const rows = hunk.lines.length + 1;
  return (
    <div className="vl-peek" role="dialog" aria-label={t('git.peek.title')} onClick={(e) => e.stopPropagation()}>
      <div className="vl-peek-head">
        <b>{extent ? (extent.from === extent.to ? t('git.peek.line', { n: extent.from }) : t('git.peek.lines', { from: extent.from, to: extent.to })) : t('git.peek.title')}</b><span className="muted mono small grow">{hunkRange(hunk.header)}</span>
        <span className="small muted">{t('git.peek.count', { n: index + 1, total })}</span>
        <button type="button" className="btn ghost icon sm" disabled={index <= 0} onClick={() => onGo(index - 1)} aria-label={t('git.peek.prev')} title={`${t('git.peek.prev')} (Alt+↑)`}><ChevronUp size={15} /></button>
        <button type="button" className="btn ghost icon sm" disabled={index >= total - 1} onClick={() => onGo(index + 1)} aria-label={t('git.peek.next')} title={`${t('git.peek.next')} (Alt+↓)`}><ChevronDown size={15} /></button>
        <button type="button" className="btn ghost icon sm" onClick={onClose} aria-label={t('common.close')}><X size={14} /></button>
      </div>
      <div className="vl-peek-body" style={{ height: Math.min(rows * ROW_H + 4, 260) }}><DiffView parsed={parsed} layout="unified" path={path} firstIndex={index} /></div>
    </div>
  );
}

const GUTTER_CH = 6;           // line-number column, in characters
const BLAME_PX = 210;          // blame column width

/** The file, line by line. Only the rows on screen are in the DOM (see VirtualLines), so size does not matter. */
export function FileView({ f, agent, blame: blameOn, onOpenCommit, marks, allNew, focusLine }: { f: GitFileResult; agent: Agent; blame: boolean; onOpenCommit: (sha: string) => void; marks: ChangeMarks | null; allNew: boolean; /** Scroll to this line and mark it (a search result). */ focusLine?: { line: number; key: number } }) {
  const groups: ChangeGroup[] = marks?.groups ?? [];
  // Clicking a change mark opens that block of the diff right under it.
  const [peek, setPeek] = useState<{ row: number; block: number } | null>(null);
  // The lines the open block covers, so they can be outlined in the file (clamped: a removal at the very end sits on the last line).
  const extents = useMemo(() => { const n = f.content.split('\n').length; return groups.map((g) => ({ from: Math.min(g.from, n), to: Math.min(g.to, n) })); }, [groups, f.content]);
  const extent = peek ? extents[peek.block] ?? null : null;
  const [reveal, setReveal] = useState<{ top: number; bottom: number; key: number } | undefined>();
  // Where the peek of a change goes (below its last line, or below the first one for very long changes) and how tall it is.
  const peekTop = (g: ChangeGroup, row: number) => { const e = { from: g.from, to: Math.min(g.to, f.content.split('\n').length) }; return (e.to - (row + 1) <= 25 ? Math.max(e.to, row + 1) : row + 1) * ROW_H; };
  const peekHeight = (g: ChangeGroup) => 34 + Math.min((g.view.lines.length + 1) * ROW_H + 4, 260) + 14;
  /** Walk the changes in file order: open the previous / next block and scroll to it. */
  const goTo = (block: number) => { const e = extents[block]; if (!e) return; const row = Math.max(0, e.from - 1); setPeek({ row, block }); setReveal({ top: row * ROW_H, bottom: peekTop(groups[block], row) + peekHeight(groups[block]), key: Date.now() }); };
  useEffect(() => { setPeek(null); }, [f.path, marks]);
  useEffect(() => {
    if (!peek) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPeek(null);
      else if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); const to = peek.block + (e.key === 'ArrowDown' ? 1 : -1); if (to >= 0 && to < groups.length) goTo(to); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [peek]);
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
        <VirtualLines count={html.length} width={`calc(${left}px + ${GUTTER_CH}ch + ${widest}ch + 40px)`} overlay={peek && groups[peek.block] ? { top: peekTop(groups[peek.block], peek.row), node: <ChangePeek path={f.path} hunk={groups[peek.block].view} index={peek.block} extent={extent} onClose={() => setPeek(null)} total={groups.length} onGo={goTo} /> } : undefined} reveal={focusLine ? { top: Math.max(0, focusLine.line - 4) * ROW_H, bottom: (focusLine.line + 2) * ROW_H, key: focusLine.key } : reveal} render={(i) => {
          const sha = blame?.lines[i]; const c = sha ? blame!.commits[sha] : undefined; const run = runs?.[i];
          // What changed since the last commit: green = added, blue = modified, a red edge where lines were removed.
          const kind = f.source === 'worktree' ? (allNew ? 'add' : marks?.lines.get(i + 1)) : undefined;
          const delBefore = !!marks && marks.removedBefore.has(i + 1);
          const delAfter = !!marks && i === html.length - 1 && marks.removedBefore.has(html.length + 1);
          const block = !marks || f.source !== 'worktree' ? undefined : marks.blockOfLine.get(i + 1) ?? (delBefore ? marks.blockOfRemoval.get(i + 1) : delAfter ? marks.blockOfRemoval.get(html.length + 1) : undefined);
          return (
            <div key={i} className={`vl-row ${focusLine && i + 1 === focusLine.line ? 'm-hit' : ''} ${run ? `bl-g${run.g}` : ''} ${kind ? `m-${kind}` : ''} ${delBefore ? 'm-delb' : delAfter ? 'm-dela' : ''} ${block !== undefined ? 'has-peek' : ''} ${extent && i + 1 >= extent.from && i + 1 <= extent.to ? 'in-peek' : ''}`}
              onClick={block !== undefined ? (e) => { if ((e.target as HTMLElement).closest('.bl-btn')) return; if (!(e.target as HTMLElement).closest('.vl-ln') && !window.getSelection()?.isCollapsed) return; if (peek?.row === i) { setPeek(null); return; } setPeek({ row: i, block }); setReveal({ top: i * ROW_H, bottom: peekTop(groups[block], i) + peekHeight(groups[block]), key: Date.now() }); } : undefined}
              title={block !== undefined ? t('git.peek.hint') : undefined}>
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
