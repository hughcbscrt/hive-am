'use client';
import { useRef, useState, type KeyboardEvent, type MutableRefObject } from 'react';
import { CodeEditor } from '@/components/git/CodeEditor';
import { suggestSql, type SqlCtx, type SqlSug } from '@/lib/sql';
import { caretXY } from './SourceEditor';

/** The code editor of the queries, with suggestions of tables, schemas, columns and keywords (they show while you type; Ctrl+Space asks for them). */
export function SqlEditor({ value, onChange, areaRef, ctx, label, onKeyDown }: {
  value: string; onChange: (v: string) => void; areaRef: MutableRefObject<HTMLTextAreaElement | null>; ctx: SqlCtx; label: string; onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const [sug, setSug] = useState<SqlSug | null>(null);
  const [sel, setSel] = useState(0);
  const [xy, setXy] = useState({ x: 0, y: 0 });
  const live = useRef(ctx); live.current = ctx;

  const refresh = (text: string, caret: number, explicit = false) => {
    const s = suggestSql(text, caret, live.current, explicit);
    setSug(s); setSel(0);
    const ta = areaRef.current;
    if (s && ta) { const p = caretXY(ta, caret); setXy({ x: Math.min(p.x, Math.max(0, ta.clientWidth - 260)), y: p.y }); }
  };
  const accept = (i: { insert: string }) => {
    const ta = areaRef.current; if (!sug || !ta) return;
    onChange(value.slice(0, sug.from) + i.insert + value.slice(sug.to)); setSug(null);
    const pos = sug.from + i.insert.length;
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(pos, pos); });
  };
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown(e);
    if (e.defaultPrevented) return;
    if ((e.ctrlKey || e.metaKey) && e.key === ' ') { e.preventDefault(); refresh(value, e.currentTarget.selectionStart, true); return; }
    if (!sug) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % sug.items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + sug.items.length) % sug.items.length); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); accept(sug.items[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); setSug(null); }
  };
  const h = areaRef.current?.clientHeight ?? 400;
  return (
    <div className="se">
      <CodeEditor value={value} path="query.sql" areaRef={areaRef} label={label}
        onChange={(v) => { onChange(v); const el = areaRef.current; if (el) requestAnimationFrame(() => refresh(v, el.selectionStart)); }}
        onClick={() => setSug(null)} onBlur={() => setTimeout(() => setSug(null), 120)} onKeyDown={keys} />
      {sug && (
        <ul className="se-pop" role="listbox" style={{ left: xy.x + 16, ...(xy.y > h - sug.items.length * 30 - 50 ? { bottom: h - xy.y - 8 } : { top: xy.y + 34 }) }}>
          {sug.items.map((i, n) => <li key={`${i.label}-${n}`} role="option" aria-selected={n === sel} className={n === sel ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); accept(i); }}><span className="mono">{i.label}</span>{i.hint && <i>{i.hint}</i>}</li>)}
        </ul>)}
    </div>
  );
}
