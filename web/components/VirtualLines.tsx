'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export const ROW_H = 20;   // px; every virtualised code row (and the editor's text) uses this exact height

/**
 * Renders only the rows that are on screen (plus a margin), inside its own scroll area, so a file with tens of
 * thousands of lines costs the same as one with fifty. Rows must all be ROW_H tall and must not wrap.
 * `width` (a CSS length) reserves the horizontal scroll range, since off-screen rows are not measured.
 */
export function VirtualLines({ count, width, render, overscan = 20, overlay }: { count: number; width?: string; render: (i: number) => ReactNode; overscan?: number; overlay?: { top: number; node: ReactNode } }) {
  const box = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const [view, setView] = useState({ top: 0, h: 800, w: 900 });

  const measure = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => { const el = box.current; if (el) setView((v) => (v.top === el.scrollTop && v.h === el.clientHeight && v.w === el.clientWidth ? v : { top: el.scrollTop, h: el.clientHeight, w: el.clientWidth })); });
  }, []);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(measure); ro.observe(el); measure();
    return () => { ro.disconnect(); cancelAnimationFrame(raf.current); };
  }, [measure]);
  // A different file (or a shorter one) must not leave the view scrolled past the end.
  useEffect(() => { const el = box.current; if (el && el.scrollTop > count * ROW_H) { el.scrollTop = 0; measure(); } }, [count, measure]);

  const start = Math.max(0, Math.floor(view.top / ROW_H) - overscan);
  const end = Math.min(count, Math.ceil((view.top + view.h) / ROW_H) + overscan);
  const rows: ReactNode[] = [];
  for (let i = start; i < end; i++) rows.push(render(i));

  return (
    <div className="vl" ref={box} onScroll={measure} style={{ ['--vl-vw' as never]: `${view.w}px` }}>
      <div className="vl-space" style={{ height: count * ROW_H, minWidth: width }}>
        <div className="vl-win" style={{ top: start * ROW_H }}>{rows}</div>
        {overlay && <div className="vl-peekwrap" style={{ top: overlay.top }}>{overlay.node}</div>}
      </div>
    </div>
  );
}
