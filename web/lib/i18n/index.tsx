'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LOCALE_KEY, LOCALES, detectLocale, getLocale, intlLocale, setCurrentLocale, translate, translateServerError, type Locale, type Params } from './core';
import type { MessageKey } from './en';

export type { Locale, MessageKey, Params };
export { LOCALES, translate, translateServerError, getLocale, intlLocale };

interface Ctx { locale: Locale; setLocale: (l: Locale) => void; t: (key: MessageKey, params?: Params) => string }
const C = createContext<Ctx | null>(null);

/** Language state for the whole admin. Persisted in localStorage only; routes and URLs are never touched. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');
  // Keep the module-level language in step with React state on every render (also after a dev hot reload).
  setCurrentLocale(locale);

  useEffect(() => {
    const l = detectLocale();
    setCurrentLocale(l); setLocaleState(l); document.documentElement.lang = l;
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setCurrentLocale(l); setLocaleState(l); document.documentElement.lang = l;
    try { localStorage.setItem(LOCALE_KEY, l); } catch { /* storage unavailable: the choice lasts until reload */ }
  }, []);

  const value = useMemo<Ctx>(() => ({ locale, setLocale, t: translate }), [locale, setLocale]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useI18n(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error('I18nProvider missing');
  return c;
}
