'use client';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useHighlighted } from '@/lib/useHighlighted';
import { useGitPrefs } from '@/lib/gitPrefs';
import { CodeCell } from './Code';
import { ROW_H } from './VirtualLines';

/**
 * Editable code with line numbers and the same highlighting, theme and whitespace markers as the viewer.
 * A transparent <textarea> sits on top of a highlighted layer; they share font, padding, line height and scroll, so the
 * caret and selection are the browser's own while what you read is the highlighted layer.
 * Large files stay fast: the layer only renders the rows on screen, and big files are highlighted in a worker
 * (see useHighlighted), so typing is never blocked by it.
 * Conflict markers (<<<<<<< ======= >>>>>>>) get their own line colour so they are easy to spot and remove.
 */
export function CodeEditor({ value, onChange, path, id, label }: { value: string; onChange: (v: string) => void; path: string; id?: string; label?: string }) {
  const prefs = useGitPrefs();
  const area = useRef<HTMLTextAreaElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const [view, setView] = useState({ top: 0, h: 600 });
  const lines = useHighlighted(value, path, 150);
  const raws = useMemo(() => value.split('\n'), [value]);
  const widest = useMemo(() => raws.reduce((m, l) => Math.max(m, l.length), 0), [raws]);
  const gutter = String(lines.length).length + 2;

  const sync = () => {
    const a = area.current, l = layer.current; if (!a || !l) return;
    l.scrollTop = a.scrollTop; l.scrollLeft = a.scrollLeft;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => setView((v) => (v.top === a.scrollTop && v.h === a.clientHeight ? v : { top: a.scrollTop, h: a.clientHeight })));
  };
  useEffect(() => {
    const a = area.current; if (!a) return;
    const ro = new ResizeObserver(sync); ro.observe(a); sync();
    return () => { ro.disconnect(); cancelAnimationFrame(raf.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const start = Math.max(0, Math.floor(view.top / ROW_H) - 20);
  const end = Math.min(lines.length, Math.ceil((view.top + view.h) / ROW_H) + 20);
  const rows = [];
  for (let i = start; i < end; i++) {
    const raw = raws[i] ?? '';
    const mark = /^(<{7}|>{7})( |$)/.test(raw) ? 'mk-edge' : raw === '=======' ? 'mk-mid' : '';
    rows.push(<div key={i} className={`ce-row ${mark}`}><span className="ce-no">{i + 1}</span><span className="ce-code"><CodeCell html={lines[i]} ws={prefs.whitespace} /></span></div>);
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const el = e.currentTarget, s = el.selectionStart, en = el.selectionEnd, ind = ' '.repeat(prefs.tabSize);
    if (s === en && !e.shiftKey) { onChange(value.slice(0, s) + ind + value.slice(en)); requestAnimationFrame(() => el.setSelectionRange(s + ind.length, s + ind.length)); return; }
    const from = value.lastIndexOf('\n', s - 1) + 1; const nl = value.indexOf('\n', en); const to = nl === -1 ? value.length : nl;
    const out = value.slice(from, to).split('\n').map((x) => (e.shiftKey ? x.replace(new RegExp(`^ {1,${prefs.tabSize}}`), '') : ind + x)).join('\n');
    onChange(value.slice(0, from) + out + value.slice(to));
    requestAnimationFrame(() => el.setSelectionRange(from, from + out.length));
  };

  return (
    <div className="ce" style={{ ['--g-tab' as never]: prefs.tabSize, ['--ce-gw' as never]: `${gutter}ch` }}>
      <div className="ce-layer" ref={layer} aria-hidden>
        <div className="ce-space" style={{ height: raws.length * ROW_H, minWidth: `calc(${gutter}ch + ${widest}ch + 40px)` }}>
          <div className="ce-win" style={{ top: start * ROW_H }}>{rows}</div>
        </div>
      </div>
      <textarea ref={area} id={id} aria-label={label} className="ce-area" value={value} spellCheck={false} wrap="off" onChange={(e) => onChange(e.target.value)} onScroll={sync} onKeyDown={onKey} />
    </div>
  );
}
