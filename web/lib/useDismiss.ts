'use client';
import { useEffect, type RefObject } from 'react';

/** While `open`: close on a click outside `ref` and on Escape. `onEscape` runs after closing (e.g. to restore focus). */
export function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void, onEscape?: () => void) {
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); onEscape?.(); } };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
}
