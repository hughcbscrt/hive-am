'use client';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useResizableWidth } from '@/lib/hooks/useResizableWidth';

/*
 * One mechanism for every layer that blocks the page (modals, drawers, confirmations). A global stack decides who is on top:
 * only the top layer answers Escape, gets the focus trap, and is the only part of the page that is not `inert`.
 */
interface Layer { host: HTMLElement; close: () => void }
const stack: Layer[] = [];
const inerted = new WeakSet<Element>();
let savedOverflow: string | null = null;
let bound = false;

// What stays interactive under a dialog: scripts and framework bits (custom elements), and anything marked `data-live` (toasts, the tooltip).
const IGNORE = /^(SCRIPT|STYLE|LINK|NOSCRIPT|TEMPLATE)$/;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), summary';
// A popup inside the dialog (menu, combobox, help) closes with its own Escape first.
const POPUP = '[role="menu"], [aria-haspopup][aria-expanded="true"], [role="combobox"][aria-expanded="true"]';

function sync() {
  const top = stack[stack.length - 1];
  for (const el of Array.from(document.body.children)) {
    if (IGNORE.test(el.tagName) || el.tagName.includes('-') || el.hasAttribute('data-live')) continue;
    if (top && el !== top.host) { if (!el.hasAttribute('inert')) { el.setAttribute('inert', ''); inerted.add(el); } }
    else if (inerted.has(el)) { el.removeAttribute('inert'); inerted.delete(el); }
  }
  if (stack.length && savedOverflow === null) { savedOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
  else if (!stack.length && savedOverflow !== null) { document.body.style.overflow = savedOverflow; savedOverflow = null; }
}
function onEscape(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  if (e.target instanceof Element && e.target.closest(POPUP)) return;
  top.close();
}
function register(layer: Layer): number {
  if (!bound) { window.addEventListener('keydown', onEscape); bound = true; }
  const depth = stack.length;
  stack.push(layer); sync();
  return depth;
}
function unregister(layer: Layer) {
  const i = stack.indexOf(layer);
  if (i >= 0) stack.splice(i, 1);
  sync();
  if (!stack.length && bound) { window.removeEventListener('keydown', onEscape); bound = false; }
}
const visible = (el: HTMLElement) => !el.closest('[inert]') && el.getClientRects().length > 0;

/** Layers currently open (for callers that need to know whether something is on top of them). */
export const dialogDepth = () => stack.length;

export function Dialog({ onClose, labelId, className, style, role = 'dialog', children }: { onClose: () => void; /** id of the element that names the dialog (aria-labelledby). */ labelId: string; className?: string; style?: CSSProperties; role?: 'dialog' | 'alertdialog'; children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [depth, setDepth] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  useLayoutEffect(() => {
    const el = document.createElement('div');
    el.setAttribute('data-dialog-host', '');
    document.body.appendChild(el);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const layer: Layer = { host: el, close: () => closeRef.current() };
    setDepth(register(layer)); setHost(el);
    return () => {
      const focusInside = !document.activeElement || document.activeElement === document.body || el.contains(document.activeElement);
      unregister(layer); el.remove();
      // Give the focus back to what opened it (unless the user already moved it somewhere else on purpose).
      if (focusInside && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  // First control (not the close buttons), or whatever asks for it with data-autofocus; the panel itself when it has none.
  useEffect(() => {
    const p = panel.current;
    if (!host || !p || p.contains(document.activeElement)) return;
    const target = p.querySelector<HTMLElement>('[data-autofocus]')
      ?? [...p.querySelectorAll<HTMLElement>(FOCUSABLE)].find((el) => !el.hasAttribute('data-dlg-chrome') && visible(el));
    (target ?? p).focus({ preventScroll: true });
  }, [host]);

  const trap = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
    if (!items.length) { e.preventDefault(); panel.current.focus(); return; }
    const first = items[0], last = items[items.length - 1], active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };

  if (!host) return null;
  const layer = { '--layer': depth } as CSSProperties;
  return createPortal(
    <>
      <div className="scrim" style={layer} onClick={onClose} />
      <div ref={panel} className={className} style={{ ...layer, ...style }} role={role} aria-modal="true" aria-labelledby={labelId} tabIndex={-1} onKeyDown={trap}>{children}</div>
    </>,
    host,
  );
}

/* ---------- Modal & Drawer: the two shapes of a Dialog ---------- */
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  const id = useId();
  return (
    <Dialog onClose={onClose} labelId={id} className={`modal ${wide ? 'wide' : ''}`}>
      <div className="modal-head">
        <h3 id={id}>{title}</h3>
        <button type="button" className="btn ghost icon sm" data-dlg-chrome onClick={onClose} aria-label={t('common.close')}><X size={17} /></button>
      </div>
      {children}
    </Dialog>
  );
}

/** Side panel the user can widen: drag its left edge or use the expand button. The width is remembered. */
export function Drawer({ title, subtitle, onClose, children, footer }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const { t } = useI18n();
  const id = useId();
  const { width, wide, toggle, gripProps } = useResizableWidth({ key: 'hive-am.drawerWidth', min: 420, default: 560, side: 'right' });
  return (
    <Dialog onClose={onClose} labelId={id} className="drawer" style={{ width: `min(${width}px, 100vw)` }}>
      <div className="drawer-grip" {...gripProps} role="separator" aria-orientation="vertical" aria-label={t('drawer.resize')} title={t('drawer.resize')} />
      <header>
        <div className="grow"><h2 id={id}>{title}</h2>{subtitle && <p className="muted small drawer-sub">{subtitle}</p>}</div>
        <button type="button" className="btn ghost icon" data-dlg-chrome onClick={toggle} aria-label={wide ? t('drawer.shrink') : t('drawer.expand')} title={wide ? t('drawer.shrink') : t('drawer.expand')}>{wide ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
        <button type="button" className="btn ghost icon" data-dlg-chrome onClick={onClose} aria-label={t('common.close')}><X size={18} /></button>
      </header>
      <div className="body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </Dialog>
  );
}
