'use client';
import { useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useDismiss } from '@/lib/useDismiss';

/** A button that opens a small menu under it (closes with Escape or a click outside). `children` gets a function to close it. */
export function Menu({ label, icon, iconOnly = false, children }: { label: string; icon?: ReactNode; /** Only the icon on the button (the label is its name for screen readers and its tooltip). */ iconOnly?: boolean; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(open, box, () => setOpen(false));
  return (
    <div className="menu" ref={box}>
      {iconOnly
        ? <button className="btn ghost icon sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" aria-label={label} title={label}>{icon}</button>
        : <button className="btn sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">{icon}{label}<ChevronDown size={13} /></button>}
      {open && <div className="menu-pop" role="menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}
export const MenuItem = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => <button role="menuitem" className="menu-item" onClick={onClick}>{children}</button>;
