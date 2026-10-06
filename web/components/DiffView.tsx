'use client';
import { memo, useEffect, useMemo, useState } from 'react';
import { ListChecks, Undo2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { hunkRange, toSplit, type DiffLine, type ParsedDiff, type SplitRow } from '@/lib/diff';
import { isCodeFile } from '@/lib/highlight';
import { useGitPrefs } from '@/lib/gitPrefs';
import { CodeLine } from './Code';
import { VirtualLines } from './VirtualLines';

/** `k` is the position of a changed (+/-) line among its block's changed lines: what "discard lines" sends to the server. */
export type DiffRowData = { t: 'hunk'; idx: number; header: string; section: string; changed: number } | { t: 'line'; l: DiffLine; hunk: number; k?: number } | { t: 'pair'; r: SplitRow };

/** Flatten the hunks into one list of fixed-height rows (a header row per hunk), ready to be windowed. */
function buildRows(parsed: ParsedDiff, layout: 'unified' | 'split', path: string, firstIndex = 0): DiffRowData[] {
  const rows: DiffRowData[] = [];
  const code = isCodeFile(path);   // in prose / data files git's hunk context is just some earlier line: it would look like diff content
  parsed.hunks.forEach((h, idx) => {
    rows.push({ t: 'hunk', idx: idx + firstIndex, header: hunkRange(h.header), section: code ? h.section : '', changed: h.lines.filter((l) => l.kind !== 'ctx').length });
    let k = 0;
    if (layout === 'unified') for (const l of h.lines) rows.push({ t: 'line', l, hunk: idx + firstIndex, k: l.kind === 'ctx' ? undefined : k++ });
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
export function DiffView({ parsed, layout, path, cutOff = false, firstIndex = 0, onDiscardHunk, onDiscardLines }: { parsed: ParsedDiff; layout: 'unified' | 'split'; path: string; cutOff?: boolean; firstIndex?: number; onDiscardHunk?: (index: number, header: string) => void; onDiscardLines?: (index: number, header: string, lines: number[]) => void }) {
  const { whitespace: ws } = useGitPrefs();
  const rows = useMemo(() => buildRows(parsed, layout, path, firstIndex), [parsed, layout, path, firstIndex]);
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
