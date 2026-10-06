'use client';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bold, Code, Code2, Heading2, Italic, Link2, List, ListOrdered, Quote, Minus } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

type Edit = { value: string; start: number; end: number };

/** Wrap the selection (or insert the placeholder) with a marker, or unwrap it if already wrapped. */
function wrap(v: string, s: number, e: number, l: string, r = l, ph = ''): Edit {
  const sel = v.slice(s, e) || ph;
  if (v.slice(s - l.length, s) === l && v.slice(e, e + r.length) === r && s !== e)
    return { value: v.slice(0, s - l.length) + sel + v.slice(e + r.length), start: s - l.length, end: e - l.length };
  return { value: v.slice(0, s) + l + sel + r + v.slice(e), start: s + l.length, end: s + l.length + sel.length };
}

/** Apply/remove a line prefix on every line touched by the selection. */
function prefixLines(v: string, s: number, e: number, prefix: (i: number) => string, has: RegExp): Edit {
  const from = v.lastIndexOf('\n', s - 1) + 1;
  const nl = v.indexOf('\n', e);
  const to = nl === -1 ? v.length : nl;
  const lines = v.slice(from, to).split('\n');
  const all = lines.every((x) => has.test(x));
  const out = lines.map((x, i) => (all ? x.replace(has, '') : prefix(i) + x.replace(has, ''))).join('\n');
  return { value: v.slice(0, from) + out + v.slice(to), start: from, end: from + out.length };
}

const BULLET = /^\s*[-*+] (\[[ x]\] )?/, ORDERED = /^\s*\d+\. /, HEADING = /^#{1,6} /, QUOTE = /^> ?/;

export function MarkdownEditor({ value, onChange, placeholder, defaultView = 'split', minHeight = 340, fill = false }: { value: string; onChange: (v: string) => void; placeholder?: string; defaultView?: 'split' | 'write' | 'preview'; minHeight?: number; fill?: boolean }) {
  const { t } = useI18n();
  const ta = useRef<HTMLTextAreaElement>(null);
  const [view, setView] = useState<'split' | 'write' | 'preview'>(defaultView);

  const apply = (fn: (v: string, s: number, e: number) => Edit) => {
    const el = ta.current; if (!el) return;
    const r = fn(el.value, el.selectionStart, el.selectionEnd);
    onChange(r.value);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(r.start, r.end); });
  };

  const actions: { id: string; icon: ReactNode; label: string; keys?: string; run: () => void }[] = [
    { id: 'h', icon: <Heading2 size={15} />, label: t('md.heading'), run: () => apply((v, s, e) => prefixLines(v, s, e, () => '## ', HEADING)) },
    { id: 'b', icon: <Bold size={15} />, label: t('md.bold'), keys: 'B', run: () => apply((v, s, e) => wrap(v, s, e, '**', '**', t('md.boldPh'))) },
    { id: 'i', icon: <Italic size={15} />, label: t('md.italic'), keys: 'I', run: () => apply((v, s, e) => wrap(v, s, e, '*', '*', t('md.italicPh'))) },
    { id: 'c', icon: <Code size={15} />, label: t('md.code'), run: () => apply((v, s, e) => wrap(v, s, e, '`', '`', 'code')) },
    { id: 'cb', icon: <Code2 size={15} />, label: t('md.codeBlock'), run: () => apply((v, s, e) => wrap(v, s, e, '\n```\n', '\n```\n', 'code')) },
    { id: 'ul', icon: <List size={15} />, label: t('md.bullets'), run: () => apply((v, s, e) => prefixLines(v, s, e, () => '- ', BULLET)) },
    { id: 'ol', icon: <ListOrdered size={15} />, label: t('md.numbered'), run: () => apply((v, s, e) => prefixLines(v, s, e, (i) => `${i + 1}. `, ORDERED)) },
    { id: 'q', icon: <Quote size={15} />, label: t('md.quote'), run: () => apply((v, s, e) => prefixLines(v, s, e, () => '> ', QUOTE)) },
    { id: 'l', icon: <Link2 size={15} />, label: t('md.link'), keys: 'K', run: () => apply((v, s, e) => { const sel = v.slice(s, e) || t('md.linkPh'); const out = `[${sel}](https://)`; return { value: v.slice(0, s) + out + v.slice(e), start: s + sel.length + 3, end: s + sel.length + 11 }; }) },
    { id: 'hr', icon: <Minus size={15} />, label: t('md.rule'), run: () => apply((v, s, e) => ({ value: v.slice(0, s) + '\n\n---\n\n' + v.slice(e), start: s + 7, end: s + 7 })) },
  ];

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (e.ctrlKey || e.metaKey) {
      const a = actions.find((x) => x.keys && x.keys.toLowerCase() === e.key.toLowerCase());
      if (a) { e.preventDefault(); a.run(); return; }
    }
    if (e.key === 'Tab') {            // indent / outdent instead of leaving the field
      e.preventDefault();
      apply((v, s, en) => {
        if (s === en && !e.shiftKey) return { value: v.slice(0, s) + '  ' + v.slice(en), start: s + 2, end: s + 2 };
        const from = v.lastIndexOf('\n', s - 1) + 1;
        const nl = v.indexOf('\n', en); const to = nl === -1 ? v.length : nl;
        const out = v.slice(from, to).split('\n').map((x) => (e.shiftKey ? x.replace(/^ {1,2}/, '') : '  ' + x)).join('\n');
        return { value: v.slice(0, from) + out + v.slice(to), start: from, end: from + out.length };
      });
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && el.selectionStart === el.selectionEnd) {   // continue lists
      const v = el.value, s = el.selectionStart;
      const from = v.lastIndexOf('\n', s - 1) + 1;
      const line = v.slice(from, s);
      const m = /^(\s*)([-*+] (?:\[[ x]\] )?|(\d+)\. )(.*)$/.exec(line);
      if (!m) return;
      e.preventDefault();
      if (!m[4]) { onChange(v.slice(0, from) + v.slice(s)); requestAnimationFrame(() => el.setSelectionRange(from, from)); return; }  // empty item ends the list
      const next = m[3] ? `${m[1]}${Number(m[3]) + 1}. ` : m[1] + m[2].replace('[x]', '[ ]');
      onChange(v.slice(0, s) + '\n' + next + v.slice(s));
      requestAnimationFrame(() => { const p = s + 1 + next.length; el.setSelectionRange(p, p); });
    }
  };

  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  return (
    <div className={`mde${fill ? ' fill' : ''}`}>
      <div className="mde-bar" role="toolbar" aria-label={t('md.toolbar')}>
        {actions.map((a) => (
          <button key={a.id} type="button" className="mde-btn" title={a.keys ? `${a.label} (Ctrl+${a.keys})` : a.label} aria-label={a.label} onMouseDown={(e) => e.preventDefault()} onClick={a.run} disabled={view === 'preview'}>{a.icon}</button>
        ))}
        <span className="grow" />
        <div className="mde-views" role="group">
          {(['write', 'split', 'preview'] as const).map((v) => (
            <button key={v} type="button" className={view === v ? 'on' : ''} aria-pressed={view === v} onClick={() => setView(v)}>{t(`md.view.${v}`)}</button>
          ))}
        </div>
      </div>
      <div className={`mde-body v-${view}`} style={{ minHeight }}>
        {view !== 'preview' && <textarea ref={ta} className="mde-text mono" style={{ minHeight }} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} placeholder={placeholder} spellCheck={false} />}
        {view !== 'write' && <div className="mde-prev md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{value || t('skills.previewEmpty')}</ReactMarkdown></div>}
      </div>
      <div className="mde-foot muted">{t('md.stats', { words, chars: value.length })} · {t('md.tips')}</div>
    </div>
  );
}
