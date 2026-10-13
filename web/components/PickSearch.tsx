'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useDismiss } from '@/lib/useDismiss';
import { useCombobox } from './combobox';

export interface PickOption { id: string; label: string; hint?: string }

/**
 * Picks from a list by searching it: what is chosen shows as chips (× removes), and typing filters the rest. `multi` takes several; without it
 * exactly one can be chosen (the chip replaces the search field until it is removed), so it never looks like more than one is allowed.
 */
export function PickSearch({ options, value, onChange, multi = false, inline = false, placeholder, empty, ariaLabel, autoFocus = false }: {
  options: PickOption[]; value: string[]; onChange: (ids: string[]) => void; multi?: boolean; /** The list opens in the flow (inside a scrolling card) instead of floating. */ inline?: boolean; placeholder?: string; empty?: string; ariaLabel?: string; autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useDismiss(open, box, () => setOpen(false));
  const chosen = value.map((id) => options.find((o) => o.id === id)).filter((o): o is PickOption => !!o);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return options.filter((o) => !value.includes(o.id) && (!s || `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(s))).slice(0, 50);
  }, [options, value, q]);
  useEffect(() => { setHi(0); }, [q, open]);
  const pick = (o: PickOption) => { onChange(multi ? [...value, o.id] : [o.id]); setQ(''); setOpen(multi); if (multi) input.current?.focus(); };
  const drop = (id: string) => { onChange(value.filter((x) => x !== id)); requestAnimationFrame(() => input.current?.focus()); };
  const single = !multi && chosen.length > 0;
  const listed = open && !single && (shown.length > 0 || !!empty);
  const combo = useCombobox(listed, hi, shown.length);

  return (
    <div className={`sg ps ${inline ? 'ps-inline' : ''}`} ref={box}>
      <div className={`ps-box input ${open ? 'open' : ''}`} onClick={() => { if (!single) { setOpen(true); input.current?.focus(); } }}>
        {chosen.map((o) => (
          <span key={o.id} className="chip ps-chip">{o.label}<button type="button" onClick={(e) => { e.stopPropagation(); drop(o.id); }} aria-label={`× ${o.label}`}><X size={12} /></button></span>
        ))}
        {!single && <input ref={input} className="ps-input" value={q} placeholder={chosen.length ? '' : placeholder} aria-label={ariaLabel} autoComplete="off" spellCheck={false} autoFocus={autoFocus} {...combo.input}
          onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(shown.length - 1, h + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
            else if (e.key === 'Enter' && open && shown[hi]) { e.preventDefault(); pick(shown[hi]); }
            else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); }
            else if (e.key === 'Backspace' && !q && chosen.length) drop(chosen[chosen.length - 1].id);
          }} />}
      </div>
      {listed && (
        <ul className="sg-list" {...combo.listProps}>
          {shown.length === 0 && <li className="sg-empty">{empty}</li>}
          {shown.map((o, i) => (
            <li key={o.id} {...combo.optionProps(i)}>
              <button type="button" className={`sg-opt ${i === hi ? 'hi' : ''}`} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setHi(i)} onClick={() => pick(o)}>
                <span className="nm">{o.label}</span>{o.hint && <span className="hint">{o.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
