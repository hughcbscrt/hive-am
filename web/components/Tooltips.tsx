'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * One tooltip for the whole app. Anything that sets a `title` attribute gets a styled tooltip instead of the browser's own:
 * on hover (after a short pause) or keyboard focus, the `title` is taken off the element (so the native one never shows) and kept in
 * `data-tip`. An icon-only element that had no accessible name gets the text as its `aria-label`, so nothing is lost for screen readers.
 * New code only needs `title="…"`; `\n` in the text makes a new line.
 */
const DELAY = 350, GAP = 8, EDGE = 8;

interface Tip { text: string; rect: DOMRect }

export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: HTMLElement | null = null;
    const hide = () => { clearTimeout(timer); current = null; setTip(null); setPos(null); };
    const find = (t: EventTarget | null) => (t instanceof Element ? (t.closest('[title],[data-tip]') as HTMLElement | null) : null);
    /** Takes the native title off the element and returns the text to show. */
    const adopt = (el: HTMLElement): string => {
      const title = el.getAttribute('title');
      if (title !== null) {
        el.removeAttribute('title');
        if (title.trim()) {
          el.dataset.tip = title;
          if (!el.getAttribute('aria-label') && !el.textContent?.trim()) el.setAttribute('aria-label', title);
        }
      }
      return el.dataset.tip ?? '';
    };
    const start = (el: HTMLElement | null, instant = false) => {
      if (!el || el === current) return;
      hide();
      const text = adopt(el);
      if (!text) return;
      current = el;
      const open = () => { if (current === el && el.isConnected) setTip({ text, rect: el.getBoundingClientRect() }); };
      if (instant) open(); else timer = setTimeout(open, DELAY);
    };
    const over = (e: MouseEvent) => start(find(e.target));
    const out = (e: MouseEvent) => { if (current && !(e.relatedTarget instanceof Node && current.contains(e.relatedTarget))) hide(); };
    const focus = (e: FocusEvent) => { const el = find(e.target); if (el && el.matches(':focus-visible')) start(el, true); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    document.addEventListener('mouseover', over);
    document.addEventListener('mouseout', out);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      hide();
      document.removeEventListener('mouseover', over); document.removeEventListener('mouseout', out);
      document.removeEventListener('focusin', focus); document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', hide, true); document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', hide, true); window.removeEventListener('blur', hide);
    };
  }, []);

  // Above the element when there is room, below otherwise; always inside the window.
  useLayoutEffect(() => {
    if (!tip || !box.current) return;
    const { width, height } = box.current.getBoundingClientRect();
    const below = tip.rect.top - height - GAP < EDGE;
    const left = Math.min(Math.max(EDGE, tip.rect.left + tip.rect.width / 2 - width / 2), window.innerWidth - width - EDGE);
    setPos({ left, top: below ? tip.rect.bottom + GAP : tip.rect.top - height - GAP, below });
  }, [tip]);

  if (!tip) return null;
  return (
    <div ref={box} className="tooltip" role="tooltip" data-below={pos?.below ? '1' : undefined} style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}>
      {tip.text}
    </div>
  );
}
