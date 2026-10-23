'use client';
import { useMemo, useRef, useState } from 'react';
import { CodeEditor } from '@/components/git/CodeEditor';
import type { VarInfo } from '@/lib/types';
import { NO_VALUE } from '@/lib/meta';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const HEADERS = ['Accept', 'Accept-Language', 'Authorization', 'Cache-Control', 'Content-Type', 'Cookie', 'If-None-Match', 'Origin', 'Referer', 'User-Agent', 'X-Api-Key', 'X-Requested-With'];
const MIME = ['application/json', 'application/x-www-form-urlencoded', 'application/xml', 'text/plain', 'text/html', 'multipart/form-data'];
const DYNAMIC = ['$uuid', '$timestamp', '$isoTimestamp', '$randomInt'];

interface Item { label: string; insert: string; hint?: string }
interface Sug { items: Item[]; from: number; to: number }

/** What can be suggested at the caret: variables inside {{ }}, methods at the start of a request, headers and their values. */
function suggest(text: string, caret: number, vars: VarInfo[], named: string[]): Sug | null {
  const ls = text.lastIndexOf('\n', caret - 1) + 1;
  const line = text.slice(ls, caret);
  const before = text.slice(0, ls).split('\n');
  const v = /\{\{([\w.$-]*)$/.exec(line);
  if (v) {
    const q = v[1].toLowerCase(), from = caret - v[1].length;
    const items: Item[] = [
      ...vars.filter((x) => !x.name.includes('.response.') && !x.name.startsWith('$')).map((x) => ({ label: x.name, insert: `${x.name}}}`, hint: x.source === 'missing' ? NO_VALUE : x.secret || x.hidden ? '••••' : (x.value ?? '').slice(0, 30) })),
      ...named.map((n) => ({ label: `${n}.response.body.`, insert: `${n}.response.body.`, hint: 'answer' })),
      ...DYNAMIC.map((d) => ({ label: d, insert: `${d}}}`, hint: 'generated' })),
    ].filter((i) => i.label.toLowerCase().includes(q) && i.label.toLowerCase() !== q).slice(0, 12);
    return items.length ? { items, from, to: caret } : null;
  }
  const hv = /^(content-type|accept)\s*:\s*([\w/+.-]*)$/i.exec(line);
  if (hv) { const q = hv[2].toLowerCase(); const items = MIME.filter((m) => m.includes(q) && m !== q).map((m) => ({ label: m, insert: m })); return items.length ? { items, from: caret - hv[2].length, to: caret } : null; }
  const w = /^([A-Za-z-]+)$/.exec(line);
  if (w) {
    const p = (before[before.length - 2] ?? '').trim();
    const startOfRequest = !p || /^#{3,}/.test(p) || p.startsWith('#') || p.startsWith('//');
    const inHeaders = !!p && !startOfRequest && !/^\{|^\[|^</.test(p) && !p.endsWith('%}');
    const q = w[1].toLowerCase();
    if (startOfRequest) { const items = METHODS.filter((m) => m.toLowerCase().startsWith(q) && m.toLowerCase() !== q).map((m) => ({ label: m, insert: `${m} ` })); return items.length ? { items, from: ls, to: caret } : null; }
    if (inHeaders) { const items = HEADERS.filter((h) => h.toLowerCase().startsWith(q) && h.toLowerCase() !== q).map((h) => ({ label: h, insert: `${h}: ` })); return items.length ? { items, from: ls, to: caret } : null; }
  }
  const tg = /^#\s*@?(\w*)$/.exec(line);
  if (tg && tg[0].length > 1) { const q = tg[1].toLowerCase(); if ('name'.startsWith(q) && q !== 'name') return { items: [{ label: '# @name', insert: '# @name ', hint: 'name the request to use its answer' }], from: ls, to: caret }; }
  return null;
}

/** Where the caret is on the screen, measured with a hidden copy of the text with the same layout. */
export function caretXY(ta: HTMLTextAreaElement, pos: number): { x: number; y: number } {
  const cs = getComputedStyle(ta); const m = document.createElement('div');
  for (const p of ['fontFamily', 'fontSize', 'lineHeight', 'letterSpacing', 'tabSize', 'paddingTop', 'paddingLeft', 'paddingRight', 'paddingBottom', 'borderTopWidth', 'borderLeftWidth', 'borderRightWidth', 'boxSizing'] as const) (m.style as unknown as Record<string, string>)[p] = cs[p];
  m.style.cssText += ';position:absolute;visibility:hidden;white-space:pre;top:0;left:0;width:' + ta.clientWidth + 'px';
  m.textContent = ta.value.slice(0, pos); const s = document.createElement('span'); s.textContent = '​'; m.appendChild(s);
  document.body.appendChild(m); const x = s.offsetLeft, y = s.offsetTop; document.body.removeChild(m);
  return { x: x - ta.scrollLeft, y: y - ta.scrollTop };
}

export function SourceEditor({ value, onChange, onSave, vars, named }: { value: string; onChange: (v: string) => void; onSave: () => void; vars: VarInfo[]; named: string[] }) {
  const ta = useRef<HTMLTextAreaElement | null>(null);
  const [sug, setSug] = useState<Sug | null>(null);
  const [sel, setSel] = useState(0);
  const [xy, setXy] = useState({ x: 0, y: 0 });
  const stableVars = useMemo(() => vars, [vars]);

  const refresh = (text: string, caret: number) => {
    const s = suggest(text, caret, stableVars, named);
    setSug(s); setSel(0);
    if (s && ta.current) { const p = caretXY(ta.current, caret); setXy({ x: Math.min(p.x, Math.max(0, ta.current.clientWidth - 260)), y: p.y }); }
  };
  const accept = (i: Item) => {
    if (!sug || !ta.current) return;
    const next = value.slice(0, sug.from) + i.insert + value.slice(sug.to);
    onChange(next); setSug(null);
    const pos = sug.from + i.insert.length;
    requestAnimationFrame(() => { ta.current?.focus(); ta.current?.setSelectionRange(pos, pos); });
  };
  return (
    <div className="se" data-hotkeys="own">
      <CodeEditor value={value} path="requests.http" areaRef={ta} onChange={(v) => { onChange(v); const el = ta.current; if (el) requestAnimationFrame(() => refresh(v, el.selectionStart)); }}
        onClick={() => setSug(null)} onBlur={() => setTimeout(() => setSug(null), 120)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); onSave(); return; }
          if ((e.ctrlKey || e.metaKey) && e.key === ' ') { e.preventDefault(); refresh(value, e.currentTarget.selectionStart); return; }
          if (!sug) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % sug.items.length); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + sug.items.length) % sug.items.length); }
          else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); accept(sug.items[sel]); }
          else if (e.key === 'Escape') { e.preventDefault(); setSug(null); }
        }} />
      {sug && (
        <ul className="se-pop" role="listbox" style={{ left: xy.x + 16, ...(xy.y > (ta.current?.clientHeight ?? 400) - sug.items.length * 30 - 50 ? { bottom: (ta.current?.clientHeight ?? 0) - xy.y - 8 } : { top: xy.y + 34 }) }}>
          {sug.items.map((i, n) => <li key={i.label} role="option" aria-selected={n === sel} className={n === sel ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); accept(i); }}><span className="mono">{i.label}</span>{i.hint && <i>{i.hint}</i>}</li>)}
        </ul>)}
    </div>
  );
}
