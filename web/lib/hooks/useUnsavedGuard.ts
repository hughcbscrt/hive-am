'use client';
import { useEffect } from 'react';

/**
 * Usage: `useUnsavedGuard(dirty)` in a form. While dirty, closing/reloading the tab asks for confirmation.
 * It only covers closing or reloading the browser tab. Leaving inside the app (closing a drawer, switching item) is asked with a `ConfirmDialog`
 * (see ColonyEditor, NewAgentDrawer), so there is no native `window.confirm` anywhere.
 */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
}
