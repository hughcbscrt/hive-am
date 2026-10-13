'use client';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useDismiss } from '@/lib/useDismiss';

/**
 * A button that opens a menu under it. Arrow keys move between the items, Enter picks one, Escape closes it and gives the focus back, and
 * it opens upwards when there is no room below. `children` gets a function to close it. Inside: `MenuItem`, `MenuCheck`, `MenuGroup`, `MenuSep`.
 */
export function Menu({ label, icon, iconOnly = false, children }: { label: string; icon?: ReactNode; /** Only the icon on the button (the label is its name for screen readers and its tooltip). */ iconOnly?: boolean; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [room, setRoom] = useState<number | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);
  useDismiss(open, box, close, () => trigger.current?.focus());

  // room below? otherwise open upwards
  useLayoutEffect(() => {
    if (!open || !pop.current || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect(), h = pop.current.scrollHeight + 14;
    const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
    const flip = h > below && above > below;           // not enough room below, and more above: open upwards
    setUp(flip); setRoom(Math.max(160, Math.min(h, flip ? above : below)));
  }, [open]);
  useEffect(() => { if (open) pop.current?.querySelector<HTMLElement>('[role^=menuitem]:not([disabled])')?.focus(); }, [open]);

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) return;
    const items = [...(pop.current?.querySelectorAll<HTMLElement>('[role^=menuitem]:not([disabled])') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); }
    else if (e.key === 'Tab') close();
  };

  return (
    <div className="menu" ref={box} onKeyDown={onKey}>
      {iconOnly
        ? <button ref={trigger} className="btn ghost icon sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" aria-label={label} title={label}>{icon}</button>
        : <button ref={trigger} className="btn sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">{icon}{label}<ChevronDown size={13} /></button>}
      {open && <div ref={pop} className={`menu-pop ${up ? 'up' : ''}`} role="menu" aria-label={label} style={room ? { maxHeight: room } : undefined}>{children(close)}</div>}
    </div>
  );
}

/** One action: an icon, its name and, under it, a line that says what it does. `danger` for what loses something. */
export function MenuItem({ onClick, icon, hint, danger = false, disabled = false, children }: { onClick: () => void; icon?: ReactNode; hint?: string; danger?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" role="menuitem" className={`menu-item ${danger ? 'danger' : ''}`} disabled={disabled} onClick={onClick}>
      <span className="mi-ic">{icon}</span><span className="mi-tx"><span className="mi-lb">{children}</span>{hint && <small>{hint}</small>}</span>
    </button>
  );
}
/** An on / off option that does not close the menu. */
export function MenuCheck({ checked, onChange, hint, children }: { checked: boolean; onChange: (v: boolean) => void; hint?: string; children: ReactNode }) {
  return (
    <button type="button" role="menuitemcheckbox" aria-checked={checked} className="menu-item" onClick={() => onChange(!checked)}>
      <span className="mi-ic"><span className={`mi-box ${checked ? 'on' : ''}`}>{checked && <Check size={12} strokeWidth={3} />}</span></span><span className="mi-tx"><span className="mi-lb">{children}</span>{hint && <small>{hint}</small>}</span>
    </button>
  );
}
export const MenuGroup = ({ label, children }: { label: string; children: ReactNode }) => <div role="group" aria-label={label}><div className="menu-group">{label}</div>{children}</div>;
export const MenuSep = () => <div className="menu-sep" role="separator" />;
