'use client';
import { useId, useRef, useState, type ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';
import { useDismiss } from '@/lib/useDismiss';

/**
 * A help icon that opens a small explanatory popover. Closes with Escape, a click outside or the icon again;
 * Escape returns focus to the icon so keyboard users keep their place.
 */
export function HelpPopover({ label, title, children, size = 'md', align = 'start' }: { label: string; title: string; children: ReactNode; /** `sm` for inside a panel or a toolbar. */ size?: 'sm' | 'md'; /** Which edge of the icon the popover lines up with: `end` for icons near the right edge. */ align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useDismiss(open, root, () => setOpen(false), () => button.current?.focus());

  return (
    <span className={`help ${size === 'sm' ? 'sm' : ''} ${align === 'end' ? 'end' : ''}`} ref={root}>
      <button ref={button} type="button" className="help-btn" aria-label={label} title={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <CircleHelp size={size === 'sm' ? 15 : 18} />
      </button>
      {open && (
        <div id={id} role="dialog" aria-label={title} className="help-pop">
          <div className="eyebrow">{title}</div>
          <div className="muted small help-body">{children}</div>
        </div>
      )}
    </span>
  );
}
