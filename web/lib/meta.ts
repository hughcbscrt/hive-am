import type { Permission, Provider } from './types';
import { intlLocale, translate as t } from './i18n/core';

/** Names and colours are brand identifiers and are not translated; descriptions come from the message catalogue. */
export const PROVIDERS: Record<Provider, { label: string; short: string; color: string }> = {
  claude: { label: 'Claude Code', short: 'Claude', color: 'var(--p-claude)' },
  opencode: { label: 'OpenCode', short: 'OpenCode', color: 'var(--p-opencode)' },
  kiro: { label: 'Kiro', short: 'Kiro', color: 'var(--p-kiro)' },
};

export const providerBlurb = (p: Provider) => t(`provider.${p}.blurb`);

export const PERMISSION_IDS: Permission[] = ['plan', 'acceptEdits', 'bypassPermissions'];
export const permissionLabel = (p: Permission) => t(`permission.${p}.label`);
export const permissionHint = (p: Permission) => t(`permission.${p}.hint`);
/** Translated at call time, so call it during render (inside a component that uses `useI18n`). */
export const permissions = () => PERMISSION_IDS.map((id) => ({ id, label: permissionLabel(id), hint: permissionHint(id) }));

export function ago(ts: number | null | undefined): string {
  if (!ts) return '—';
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return t('time.justNow');
  const m = Math.round(s / 60); if (m < 60) return t('time.minutesAgo', { count: m });
  const h = Math.round(m / 60); if (h < 24) return t('time.hoursAgo', { count: h });
  const d = Math.round(h / 24); if (d < 30) return t('time.daysAgo', { count: d });
  return new Date(ts).toLocaleDateString(intlLocale());
}

export const shortPath = (p: string) => p.replace(/^\/home\/[^/]+/, '~');
export const initials = (n: string) => n.split(/[\s_-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
