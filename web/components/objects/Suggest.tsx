'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDismiss } from '@/lib/useDismiss';
import { useCombobox } from '@/components/ui';

export interface Opt { value: string; label?: string; hint?: string }

/**
 * A text field that suggests values (images, containers, variable names…) while still taking anything you type. Arrow keys and Enter pick,
 * Escape closes. The list is shown on focus, filtered by what is typed.
 */
export function Suggest({ value, onChange, options, placeholder, mono = false, ariaLabel, onOpen, empty }: {
  value: string; onChange: (v: string) => void; options: Opt[]; placeholder?: string; mono?: boolean; ariaLabel?: string;
  /** Called the first time the list opens (to load it lazily). */ onOpen?: () => void; empty?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(open, box, () => setOpen(false));
  const shown = useMemo(() => {
    const q = value.trim().toLowerCase();
    const list = q ? options.filter((o) => `${o.value} ${o.label ?? ''} ${o.hint ?? ''}`.toLowerCase().includes(q)) : options;
    return list.slice(0, 60);
  }, [options, value]);
  useEffect(() => { setHi(0); }, [value, open]);
  const cb = useCombobox(open && (shown.length > 0 || !!empty), hi, shown.length);
  const pick = (o: Opt) => { onChange(o.value); setOpen(false); };

  return (
    <div className="sg" ref={box}>
      <input className={`input ${mono ? 'mono' : ''}`} value={value} placeholder={placeholder} aria-label={ariaLabel} autoComplete="off" spellCheck={false} {...cb.input}
        onFocus={() => { if (!open) { setOpen(true); onOpen?.(); } }} onClick={() => setOpen(true)}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(shown.length - 1, h + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
          else if (e.key === 'Enter' && open && shown[hi]) { e.preventDefault(); pick(shown[hi]); }
          else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); }
        }} />
      {open && (shown.length > 0 || empty) && (
        <ul className="sg-list" {...cb.listProps}>
          {shown.length === 0 && <li className="sg-empty" role="presentation">{empty}</li>}
          {shown.map((o, i) => (
            <li key={o.value} {...cb.optionProps(i)}>
              <button type="button" tabIndex={-1} className={`sg-opt ${i === hi ? 'hi' : ''}`} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setHi(i)} onClick={() => pick(o)}>
                <span className={`nm ${mono ? 'mono' : ''}`}>{o.label ?? o.value}</span>{o.hint && <span className="hint">{o.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
