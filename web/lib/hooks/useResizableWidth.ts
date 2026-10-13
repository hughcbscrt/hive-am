'use client';
import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { readStored, writeStored } from './usePersistentState';

export interface ResizableOpts {
  /** localStorage key; the width is remembered. */
  key: string;
  min: number; default: number;
  /** Upper bound in px, or a function of the window width (default: window width minus 80). */
  max?: number | ((vw: number) => number);
  /** Edge the panel is attached to: a panel on the right is dragged by its left edge (default 'right'). */
  side?: 'left' | 'right';
  /** Width used by `toggle()` when expanding (default: min(max, 1100)). */
  expanded?: number | ((vw: number) => number);
}
/**
 * Usage: `const r = useResizableWidth({ key: 'hive-am.drawerWidth', min: 420, default: 560, side: 'right' });`
 * then `<aside style={{ width: r.width }}><div className="drawer-grip" {...r.gripProps} /></aside>` and a button
 * calling `r.toggle` (shows `r.wide ? shrink : expand`). The grip also toggles on double click. `width` is the
 * default on the server and first render, then the stored value.
 */
export function useResizableWidth({ key, min, default: def, max, side = 'right', expanded }: ResizableOpts) {
  const cap = useCallback(() => { const vw = window.innerWidth; return Math.max(min, typeof max === 'function' ? max(vw) : max ?? vw - 80); }, [min, max]);
  const [width, setWidth] = useState(def);
  useEffect(() => { const w = Number(readStored<unknown>(key, 0)); if (w >= min) setWidth(Math.min(w, cap())); }, [key, min, cap]);
  const save = (w: number) => writeStored(key, Math.round(w));
  const wide = width > def + 40;
  const toggle = () => {
    const vw = window.innerWidth; const big = typeof expanded === 'function' ? expanded(vw) : expanded ?? 1100;
    const w = wide ? def : Math.max(min, Math.min(cap(), big)); setWidth(w); save(w);
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault();
    const el = e.currentTarget; el.setPointerCapture(e.pointerId);
    let w = width;
    const move = (ev: PointerEvent) => { w = Math.min(cap(), Math.max(min, side === 'right' ? window.innerWidth - ev.clientX : ev.clientX)); setWidth(w); };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); save(w); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  };
  return { width, wide, toggle, gripProps: { onPointerDown, onDoubleClick: toggle } };
}
