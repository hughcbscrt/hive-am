'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';

/**
 * A help icon that opens a small explanatory popover. Closes with Escape, a click outside or the icon again;
 * Escape returns focus to the icon so keyboard users keep their place.
 */
export function HelpPopover({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <span className="help" ref={root}>
      <button ref={button} type="button" className="help-btn" aria-label={label} title={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <CircleHelp size={18} />
      </button>
      {open && (
        <div id={id} role="dialog" aria-label={title} className="help-pop">
          <div className="eyebrow">{title}</div>
          <p className="muted small">{children}</p>
        </div>
      )}
    </span>
  );
}
