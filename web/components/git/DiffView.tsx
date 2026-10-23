'use client';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { ListChecks, MessageSquare, Undo2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n/index';
import { hunkRange, toSplit, type DiffLine, type ParsedDiff, type SplitRow } from '@/lib/git/diff';
import { MAX_COMMENTS, anchorLine, cite, locate, makeComment, rangeLabel, type DiffComment } from '@/lib/git/diffComments';
import type { DiffCommentsStore } from '@/lib/git/useDiffComments';
import { isCodeFile } from '@/lib/git/highlight';
import { useGitPrefs } from '@/lib/git/gitPrefs';
import { useIsMac } from '@/lib/hotkeys';
import { CodeLine } from './Code';
import { CommentEditor, useSay } from './DiffComments';
import { ROW_H, VirtualLines } from './VirtualLines';

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
interface DiffActions { canPick: boolean; /** A comment editor is open: picking lines waits for it. */ blocked: boolean; discardHunk: (index: number, header: string) => void; startPicking: (hunk: number) => void; stopPicking: () => void; pickAll: (hunk: number, count: number) => void; discardPicked: (hunk: number, header: string) => void }

/** How a line row takes part in comments. Only primitives and stable callbacks, so the memo keeps a cursor move cheap. */
interface RowComments { index: number; mark: string; zone: boolean; title?: string; bubble?: string; bubbleId?: string; onDown?: (i: number, e: ReactPointerEvent) => void; onEnter?: (i: number) => void; onTap?: (i: number) => void; onBubble?: (id: string) => void }

const DiffRow = memo(function DiffRow({ row, path, ws, actions, picking, onPick, index = -1, mark = '', zone = false, title, bubble, bubbleId, onDown, onEnter, onTap, onBubble }: { row: DiffRowData; path: string; ws: boolean; actions?: DiffActions; picking?: Picking | null; onPick?: (k: number) => void } & Partial<RowComments>) {
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
            {row.changed > 0 && actions.canPick && <button type="button" className="hk-btn" disabled={actions.blocked} title={actions.blocked ? t('diffc.busyPicking') : t('git.discard.lines.hint')} onClick={() => actions.startPicking(row.idx)}><ListChecks size={12} />{t('git.discard.lines')}</button>}
            <button type="button" className="hk-btn" title={t('git.discard.hunk.hint')} onClick={() => actions.discardHunk(row.idx, row.header)}><Undo2 size={12} />{t('git.discard.hunk')}</button>
          </>)}</div>
      </div>
    );
  }
  if (row.t === 'line') {
    const l = row.l;
    return (
      <div className={`vl-row ${l.kind} ${onPick && row.k !== undefined && picking?.picked.has(row.k) ? 'picked' : ''} ${zone ? 'dc-zone' : ''} ${mark}`} onClick={onPick && row.k !== undefined ? () => onPick(row.k!) : onTap && zone ? () => onTap(index) : undefined}
        onPointerDown={onDown && zone ? (e) => onDown(index, e) : undefined} onPointerEnter={onEnter && zone ? () => onEnter(index) : undefined}>
        <div className="vl-ln" style={{ left: 0 }} title={title}>{l.oldNo ?? ''}{bubbleId && onBubble && (
          <button type="button" className="dc-bubble" title={bubble} aria-label={bubble} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onBubble(bubbleId); }}><MessageSquare size={12} aria-hidden /></button>
        )}</div><div className="vl-ln" style={{ left: 'calc(6ch + 16px)' }} title={title}>{l.newNo ?? ''}</div>
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

/** Comments on this diff (only the current changes, Unified view): DiffView draws, selects and edits; the store keeps them. */
export interface DiffViewComments {
  /** The comments of this file. */
  items: DiffComment[];
  store: DiffCommentsStore;
  /** Every comment of the agent counts towards the limit. */
  total: number;
  /** "Go to the comment" from the Review list: show it (and open it to edit). */
  focus?: { id: string; key: number; edit: boolean };
  /** While the comments travel to the agent nothing can be edited. */
  locked: boolean;
}

interface Placed { id: string; first: boolean; outdated: boolean }
interface Editor { from: number; to: number; lines: DiffLine[]; initial: string; editingId?: string }

/** A diff, windowed like the file view: only the rows on screen exist, so a huge diff costs the same as a small one. */
export function DiffView({ parsed, layout, path, cutOff = false, firstIndex = 0, onDiscardHunk, onDiscardLines, comments }: { parsed: ParsedDiff; layout: 'unified' | 'split'; path: string; cutOff?: boolean; firstIndex?: number; onDiscardHunk?: (index: number, header: string) => void; onDiscardLines?: (index: number, header: string, lines: number[]) => void; comments?: DiffViewComments }) {
  const { t } = useI18n();
  const { whitespace: ws } = useGitPrefs();
  const mac = useIsMac();
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

  /* ---- comments: selection by row index, a keyboard cursor, the editor under the selection ---- */
  const cm = layout === 'unified' ? comments : undefined;
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [touch, setTouch] = useState(false);
  const [reveal, setReveal] = useState<{ top: number; bottom: number; key: number } | undefined>();
  const [flash, setFlash] = useState<{ from: number; to: number } | null>(null);
  const [said, say] = useSay();
  // The text being written (the editor owns it; this copy says whether it is unsaved), and a draft brought back when the file opens again.
  const editorText = useRef('');
  const [draftText, setDraftText] = useState<string | null>(null);
  const revealKey = useRef(0);
  const show = useCallback((from: number, to: number, extra = 0) => setReveal({ top: from * ROW_H, bottom: (to + 1) * ROW_H + extra, key: ++revealKey.current }), []);
  const lastHunk = parsed.hunks.length - 1;
  // Where each comment of this file is drawn: on its lines when found, an outdated one on the row with its old number.
  const placed = useMemo(() => {
    const at = new Map<number, Placed>();
    if (!cm) return at;
    const hunkRow = new Map<number, number>();
    rows.forEach((r, i) => { if (r.t === 'hunk') hunkRow.set(r.idx - firstIndex, i); });
    for (const c of cm.items) {
      const loc = c.outdated ? null : locate(parsed, c);
      if (loc) { const base = hunkRow.get(loc.hunk)! + 1 + loc.start; for (let k = 0; k < c.count; k++) if (!at.has(base + k)) at.set(base + k, { id: c.id, first: k === 0, outdated: false }); continue; }
      const n = anchorLine(c);
      const i = rows.findIndex((r) => r.t === 'line' && (c.removed ? r.l.kind === 'del' && r.l.oldNo === n : r.l.newNo === n));
      if (i >= 0 && !at.has(i)) at.set(i, { id: c.id, first: true, outdated: true });
    }
    return at;
  }, [cm?.items, parsed, rows, firstIndex]); // eslint-disable-line react-hooks/exhaustive-deps
  const zoneOk = useCallback((i: number) => { const r = rows[i]; return !!cm && !picking && r?.t === 'line' && !(cutOff && r.hunk - firstIndex === lastHunk); }, [cm, picking, rows, cutOff, firstIndex, lastHunk]);
  const lineRows = useMemo(() => rows.flatMap((r, i) => (r.t === 'line' ? [i] : [])), [rows]);
  const linesOf = (from: number, to: number) => rows.slice(from, to + 1).flatMap((r) => (r.t === 'line' ? [r.l] : []));
  const byId = (id: string) => cm?.items.find((c) => c.id === id);
  const rowsOf = (id: string) => { const got = [...placed].filter(([, p]) => p.id === id).map(([i]) => i); return got.length ? { from: Math.min(...got), to: Math.max(...got) } : null; };

  // Extend from `a` towards `b` inside one hunk, stopping before a line that already has a comment.
  const extend = useCallback((a: number, b: number): number => {
    const step = b >= a ? 1 : -1; let end = a;
    for (let i = a + step; step > 0 ? i <= b : i >= b; i += step) {
      const r = rows[i];
      if (r?.t !== 'line' || placed.has(i)) { if (placed.has(i)) say(t('diffc.announce.clamped')); break; }
      end = i;
    }
    return end;
  }, [rows, placed, say, t]);

  const canAdd = !!cm && cm.total < MAX_COMMENTS;
  const openEdit = (id: string) => {
    const c = byId(id), at = rowsOf(id); if (!c || !at || cm?.locked) return;
    editorText.current = c.text;
    setSel(null); setDraftText(null); setEditor({ from: at.from, to: at.to, lines: linesOf(at.from, at.to), initial: c.text, editingId: id });
    show(at.from, at.to, 200);
  };
  const openNew = (a: number, b: number) => {
    if (!cm || cm.locked) return;
    const from = Math.min(a, b), to = Math.max(a, b);
    if (from === to && placed.has(from)) return openEdit(placed.get(from)!.id);
    if (!canAdd) { say(t('diffc.limit', { max: MAX_COMMENTS })); return; }
    const lines = linesOf(from, to);
    editorText.current = '';
    setDraftText(null); setEditor({ from, to, lines, initial: '' });
    cm.store.setDraft({ path, lines, text: '' });
    show(from, to, 200);
  };
  const closeEditor = () => { setEditor(null); setSel(null); cm?.store.setDraft(null); editorText.current = ''; box.current?.querySelector<HTMLElement>('.vf-main')?.focus({ preventScroll: true }); };
  const dirty = () => !!editor && editorText.current !== (editor.editingId ? editor.initial : '') && !(!editor.editingId && !editorText.current.trim());

  // The latest state for the stable row callbacks (DiffRow is memoised).
  const clearDraft = () => cm?.store.setDraft(null);
  const live = useRef({ sel, editor, placed, zoneOk, extend, openNew, openEdit, dirty, clearDraft, dragging: false, touchTap: false });
  live.current = { ...live.current, sel, editor, placed, zoneOk, extend, openNew, openEdit, dirty, clearDraft };
  const focusEditor = () => box.current?.querySelector<HTMLTextAreaElement>('.dc-editor textarea')?.focus();
  const onDown = useCallback((i: number, e: ReactPointerEvent) => {
    const s = live.current;
    s.touchTap = e.pointerType === 'touch';
    if (e.pointerType === 'touch' || e.button !== 0 || !s.zoneOk(i) || !(e.target as Element).closest('.vl-ln, .vl-sg')) return;
    e.preventDefault(); setTouch(false);
    box.current?.querySelector<HTMLElement>('.vf-main')?.focus({ preventScroll: true });
    setCursor(i);
    if (s.editor && s.dirty()) {
      // Text already written is never dropped: Shift moves the editor to the longer selection, a plain click goes back to it.
      if (e.shiftKey) { const a = s.editor.from, b = s.extend(a, i), from = Math.min(a, b), to = Math.max(a, b); setEditor({ ...s.editor, from, to, lines: linesOf(from, to) }); }
      else focusEditor();
      return;
    }
    if (s.placed.has(i) && !e.shiftKey) { s.openEdit(s.placed.get(i)!.id); return; }
    if (s.editor) { setEditor(null); s.clearDraft(); }
    const a = e.shiftKey && s.sel ? s.sel.a : i;
    setSel({ a, b: s.extend(a, i) });
    live.current.dragging = true;
    const up = () => { window.removeEventListener('pointerup', up); live.current.dragging = false; const cur = live.current.sel; if (cur) live.current.openNew(cur.a, cur.b); };
    window.addEventListener('pointerup', up);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const onEnter = useCallback((i: number) => { const s = live.current; if (s.dragging && s.sel) setSel({ a: s.sel.a, b: s.extend(s.sel.a, i) }); }, []);
  // Touch: one tap picks a line, a second one in the same hunk the range, a third starts again; the bar under the diff opens the editor.
  const onTap = useCallback((i: number) => {
    const s = live.current;
    if (!s.touchTap || !s.zoneOk(i) || s.editor) return;
    setTouch(true);
    if (s.placed.has(i)) { s.openEdit(s.placed.get(i)!.id); return; }
    const r = rows[i] as Extract<DiffRowData, { t: 'line' }>;
    if (s.sel && s.sel.a === s.sel.b && s.sel.a !== i && (rows[s.sel.a] as Extract<DiffRowData, { t: 'line' }>).hunk === r.hunk) setSel({ a: s.sel.a, b: s.extend(s.sel.a, i) });
    else setSel({ a: i, b: i });
  }, [rows]);
  const onBubble = useCallback((id: string) => { const s = live.current; if (s.editor && s.dirty()) { focusEditor(); return; } s.openEdit(id); }, []);

  // A new diff (the agent edited the file): the editor follows its lines, the selection is dropped.
  useEffect(() => {
    setSel(null); setFlash(null);
    setEditor((ed) => {
      if (!ed) return ed;
      const c = makeComment(path, ed.lines, '', 0, '');
      const at = locate(parsed, c); if (!at) return { ...ed, from: Math.min(ed.from, rows.length - 1), to: Math.min(ed.to, rows.length - 1) };
      const base = rows.findIndex((r) => r.t === 'hunk' && r.idx - firstIndex === at.hunk) + 1 + at.start;
      return { ...ed, from: base, to: base + c.count - 1 };
    });
  }, [parsed]); // eslint-disable-line react-hooks/exhaustive-deps
  // Back to a file with a comment being written: open it again with its text.
  const restored = useRef(false);
  useEffect(() => {
    if (!cm || restored.current) return; restored.current = true;
    const d = cm.store.getDraft(); if (!d || d.path !== path || !d.lines.length || !d.text.trim()) return;
    const at = locate(parsed, makeComment(path, d.lines, '', 0, '')); if (!at) return;
    const from = rows.findIndex((r) => r.t === 'hunk' && r.idx - firstIndex === at.hunk) + 1 + at.start, to = from + d.lines.length - 1;
    editorText.current = d.text;
    const c = d.editingId ? byId(d.editingId) : undefined;
    setEditor({ from, to, lines: d.lines, initial: c ? c.text : '', editingId: c?.id });
    setDraftText(d.text);
    show(from, to, 200);
  }, [cm]); // eslint-disable-line react-hooks/exhaustive-deps
  // Go to a comment from the Review list: reveal it, flash it, open it to edit when asked.
  useEffect(() => {
    if (!cm?.focus) return;
    const at = rowsOf(cm.focus.id); if (!at) return;
    show(at.from, at.to, cm.focus.edit ? 200 : 0);
    setFlash(at); const h = setTimeout(() => setFlash(null), 1200);
    if (cm.focus.edit) openEdit(cm.focus.id);
    return () => clearTimeout(h);
  }, [cm?.focus?.key, placed.size > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const announceRow = (i: number) => {
    const r = rows[i]; if (r?.t !== 'line') return;
    const l = r.l, n = l.kind === 'del' ? l.oldNo : l.newNo;
    say(`${t(`diffc.row.${l.kind}`, { n: n ?? '', text: l.text.trim() })}. ${t('diffc.row.pos', { i: lineRows.indexOf(i) + 1, total: lineRows.length })}${placed.has(i) ? `, ${t('diffc.row.hasComment')}` : ''}.`);
  };
  const keyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!cm || e.target !== e.currentTarget || e.ctrlKey || e.metaKey || e.altKey || !lineRows.length) return;
    const pos = cursor === null ? -1 : lineRows.indexOf(cursor);
    const page = Math.max(1, Math.floor((e.currentTarget.clientHeight || 400) / ROW_H) - 1);
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = lineRows[Math.min(lineRows.length - 1, pos + 1)];
    else if (e.key === 'ArrowUp') next = lineRows[Math.max(0, pos < 0 ? 0 : pos - 1)];
    else if (e.key === 'Home') next = lineRows[0];
    else if (e.key === 'End') next = lineRows[lineRows.length - 1];
    else if (e.key === 'PageDown') next = lineRows[Math.min(lineRows.length - 1, Math.max(0, pos) + page)];
    else if (e.key === 'PageUp') next = lineRows[Math.max(0, pos - page)];
    else if (e.key === 'c' || e.key === 'C' || (e.key === 'Enter' && !e.shiftKey)) {
      const at = sel ?? (cursor !== null ? { a: cursor, b: cursor } : null);
      if (!at || !zoneOk(at.a)) return;
      e.preventDefault();
      if (editor && dirty()) { focusEditor(); return; }
      openNew(at.a, at.b); return;
    } else if (e.key === 'Escape') { if (sel) { e.preventDefault(); setSel(null); } return; }
    if (next === undefined || next === null) return;
    e.preventDefault();
    if (e.shiftKey && cursor !== null && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const a = sel ? sel.a : cursor, cur = rows[a] as Extract<DiffRowData, { t: 'line' }>, to = rows[next] as Extract<DiffRowData, { t: 'line' }>;
      if (!zoneOk(a) || cur.hunk !== to.hunk) return;
      const b = extend(a, next); setSel({ a, b }); setCursor(b); show(b, b);
      const from = Math.min(a, b), end = Math.max(a, b);
      say(t('diffc.announce.selected', { range: rangeLabel(cite(linesOf(from, end)), t) }));
      return;
    }
    setCursor(next); show(next, next); announceRow(next);
  };

  const actions: DiffActions | undefined = onDiscardHunk ? {
    canPick: layout === 'unified' && !!onDiscardLines,
    blocked: !!editor,
    discardHunk: onDiscardHunk,
    startPicking: (hunk) => { setSel(null); setPicking({ hunk, picked: new Set() }); },
    stopPicking: () => setPicking(null),
    pickAll: (hunk, count) => setPicking({ hunk, picked: new Set(Array.from({ length: count }, (_, i) => i)) }),
    discardPicked: (hunk, header) => { if (picking && onDiscardLines) { const lines = [...picking.picked].sort((a, b) => a - b); setPicking(null); onDiscardLines(hunk, header, lines); } },
  } : undefined;

  const selFrom = sel ? Math.min(sel.a, sel.b) : -1, selTo = sel ? Math.max(sel.a, sel.b) : -1;
  const rowComments = (i: number): Partial<RowComments> => {
    if (!cm || rows[i].t !== 'line') return {};
    const p = placed.get(i), zone = zoneOk(i), c = p?.first ? byId(p.id) : undefined;
    const inEditor = !!editor && i >= editor.from && i <= editor.to;
    const mark = [
      p && 'dc-has', p?.first && 'dc-first', p?.outdated && 'dc-outdated', ((i >= selFrom && i <= selTo) || inEditor) && 'dc-sel',
      focused && cursor === i && 'dc-cur', flash && i >= flash.from && i <= flash.to && 'dc-flash',
    ].filter(Boolean).join(' ');
    const r = rows[i] as Extract<DiffRowData, { t: 'line' }>;
    const title = cutOff && r.hunk - firstIndex === lastHunk ? t('diffc.cutoff') : zone && !p && !canAdd ? t('diffc.limit', { max: MAX_COMMENTS }) : undefined;
    const bubble = c ? `${c.outdated ? `${t('diffc.outdated')}: ` : ''}${t('diffc.marker', { range: rangeLabel(c, t), text: Array.from(c.text).length > 120 ? `${Array.from(c.text).slice(0, 119).join('')}…` : c.text })}` : undefined;
    return { index: i, mark, zone, title, bubble, bubbleId: c?.id, onDown, onEnter, onTap, onBubble };
  };

  const ed = editor && cm ? (
    <CommentEditor key={editor.editingId ?? 'new'} path={path} range={rangeLabel(editor.editingId && byId(editor.editingId) ? byId(editor.editingId)! : cite(editor.lines), t)} initial={draftText ?? editor.initial} saved={editor.initial} editing={!!editor.editingId} locked={cm.locked} mac={mac}
      onChange={(v) => { editorText.current = v; cm.store.setDraft({ path, lines: editor.lines, text: v, editingId: editor.editingId }); }}
      onSave={(text) => {
        const total = editor.editingId ? cm.total : cm.total + 1;
        if (editor.editingId) cm.store.update(editor.editingId, text); else cm.store.add(path, editor.lines, text);
        say(t('diffc.announce.added', { range: rangeLabel(editor.editingId && byId(editor.editingId) ? byId(editor.editingId)! : cite(editor.lines), t), count: total }));
        setDraftText(null); closeEditor();
      }}
      onCancel={() => { setDraftText(null); closeEditor(); }}
      onDelete={editor.editingId ? () => { cm.store.remove(editor.editingId!); say(t('diffc.announce.deleted', { count: cm.total - 1 })); setDraftText(null); closeEditor(); } : undefined} />
  ) : null;

  return (
    <div className={`vf is-${layout}`} ref={box} style={{ ['--vl-left' as never]: '0px', ['--hx' as never]: '0px' }}>
      {parsed.meta.length > 0 && <div className="gx-meta">{parsed.meta.join(' · ')}</div>}
      <div className={`vf-main ${cm ? 'dc-on' : ''}`} {...(cm ? { tabIndex: 0, role: 'group', 'aria-label': t('diffc.region', { file: path.slice(path.lastIndexOf('/') + 1) }), onKeyDown: keyDown, onFocus: (e: React.FocusEvent) => { if (e.target === e.currentTarget) { setFocused(true); if (cursor === null && lineRows.length) setCursor(lineRows[0]); } }, onBlur: (e: React.FocusEvent) => { if (e.target === e.currentTarget) setFocused(false); } } : {})}>
        <VirtualLines count={rows.length} width={width} reveal={reveal} overlay={ed && editor ? { top: (editor.to + 1) * ROW_H, node: ed } : undefined}
          render={(i) => { const r = rows[i]; const mine = r.t === 'line' && picking?.hunk === r.hunk; return <DiffRow key={i} row={r} path={path} ws={ws} actions={r.t === 'hunk' && !(cutOff && r.idx === parsed.hunks.length - 1) ? actions : undefined} picking={r.t === 'hunk' || mine ? picking : undefined} onPick={mine ? toggle : undefined} {...rowComments(i)} />; }} />
      </div>
      {cm && touch && sel && !editor && (
        <div className="dc-selbar" role="group" aria-label={rangeLabel(cite(linesOf(selFrom, selTo)), t)}>
          <span className="grow">{rangeLabel(cite(linesOf(selFrom, selTo)), t)}</span>
          <button type="button" className="btn sm" onClick={() => setSel(null)}>{t('diffc.select.cancel')}</button>
          <button type="button" className="btn primary sm" disabled={!canAdd || cm.locked} onClick={() => openNew(selFrom, selTo)}>{t('diffc.select.add')}</button>
        </div>
      )}
      {cm && <div className="sr-only" aria-live="polite">{said}</div>}
      {layout === 'split' && slide.max > 0 && (
        <div className="hbar" ref={bar} onScroll={(e) => box.current?.style.setProperty('--hx', `${e.currentTarget.scrollLeft}px`)} aria-label={t('a11y.scrollSideways')}>
          <div style={{ width: slide.track + slide.max, height: 1 }} />
        </div>
      )}
    </div>
  );
}
