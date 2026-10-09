'use client';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ListChecks, Undo2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n/index';
import { hunkRange, toSplit, type DiffLine, type ParsedDiff, type SplitRow } from '@/lib/git/diff';
import { isCodeFile } from '@/lib/git/highlight';
import { useGitPrefs } from '@/lib/git/gitPrefs';
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
  // Unified: two gutters + sign + code, scrolling sideways for long lines.
  // Split: two equal halves of the screen that scroll sideways *together*: the code of every row slides by the same
  // amount (--hx), driven by a bar under the diff (and by shift/trackpad wheel). Short lines never need the bar.
  const width = layout === 'unified' ? `calc(12ch + 32px + 18px + ${widest}ch + 24px)` : undefined;
  const box = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [slide, setSlide] = useState({ max: 0, track: 0 });   // how far the code can slide, and the bar's width, in px
  useEffect(() => {
    const el = box.current; if (!el || layout !== 'split') { setSlide({ max: 0, track: 0 }); return; }
    const measure = () => {
      const probe = el.querySelector('.vl'); if (!probe) return;
      const ctx = document.createElement('canvas').getContext('2d'); if (!ctx) return;
      ctx.font = getComputedStyle(probe).font;
      const ch = ctx.measureText('0').width;
      const gutter = 6 * ch + 16, half = (el.clientWidth - 2 * gutter) / 2;
      setSlide({ max: Math.max(0, Math.ceil(widest * ch + 24 - half)), track: el.clientWidth });
    };
    measure(); const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, [layout, widest, rows.length]);
  useEffect(() => { if (bar.current) bar.current.scrollLeft = 0; box.current?.style.setProperty('--hx', '0px'); }, [parsed, layout]);
  useEffect(() => {      // sideways wheel / shift+wheel moves the bar (a native listener: React's are passive)
    const el = box.current; if (!el || layout !== 'split') return;
    const wheel = (e: WheelEvent) => {
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      if (dx && bar.current) { e.preventDefault(); bar.current.scrollLeft += dx; }
    };
    el.addEventListener('wheel', wheel, { passive: false }); return () => el.removeEventListener('wheel', wheel);
  }, [layout]);
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
    <div className={`vf is-${layout}`} ref={box} style={{ ['--vl-left' as never]: '0px', ['--hx' as never]: '0px' }}>
      {parsed.meta.length > 0 && <div className="gx-meta">{parsed.meta.join(' · ')}</div>}
      <div className="vf-main">
        <VirtualLines count={rows.length} width={width} render={(i) => { const r = rows[i]; const mine = r.t === 'line' && picking?.hunk === r.hunk; return <DiffRow key={i} row={r} path={path} ws={ws} actions={r.t === 'hunk' && !(cutOff && r.idx === parsed.hunks.length - 1) ? actions : undefined} picking={r.t === 'hunk' || mine ? picking : undefined} onPick={mine ? toggle : undefined} />; }} />
      </div>
      {layout === 'split' && slide.max > 0 && (
        <div className="hbar" ref={bar} onScroll={(e) => box.current?.style.setProperty('--hx', `${e.currentTarget.scrollLeft}px`)} aria-label="Scroll sideways">
          <div style={{ width: slide.track + slide.max, height: 1 }} />
        </div>
      )}
    </div>
  );
}
