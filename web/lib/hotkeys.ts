'use client';
import { useEffect, useRef, useState } from 'react';
import { dialogDepth } from '@/components/Dialog';
import { isMacPlatform, matchHotkey, type HotkeyId } from './hotkeyRules';

const FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="combobox"]';

/** True on a Mac, known only after mounting (the first render matches the server's, which cannot tell). */
export function useIsMac(): boolean {
  const [mac, setMac] = useState(false);
  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    setMac(isMacPlatform(nav.userAgentData?.platform || nav.platform || nav.userAgent));
  }, []);
  return mac;
}

/**
 * The global shortcuts: one `keydown` on `window` in the bubbling phase (Ctrl+` in lib/dock.tsx stays in the capture phase),
 * with the rules of lib/hotkeyRules.ts. Only a match is prevented, so every other key reaches the page as before.
 */
export function useHotkeys(handlers: Record<HotkeyId, () => void>, paletteOpen: boolean, mac: boolean) {
  const cur = useRef({ handlers, paletteOpen, mac });
  cur.current = { handlers, paletteOpen, mac };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      const id = matchHotkey(e, {
        mac: cur.current.mac,
        inField: !!el && (el.matches(FIELD) || (el instanceof HTMLElement && el.isContentEditable)),
        inOwn: !!el?.closest('[data-hotkeys="own"]'),
        layers: dialogDepth(), paletteOpen: cur.current.paletteOpen,
        menuOpen: !!document.querySelector('[role="menu"]'),
      });
      if (!id) return;
      e.preventDefault();
      cur.current.handlers[id]();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
