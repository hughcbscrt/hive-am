'use client';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';

/** "‹ Home" above the title of the screens that are not in the menu (no entry lights up there), to go back and know where you are. */
export function HomeCrumb() {
  const { t } = useI18n();
  return <Link className="crumb" href="/"><span aria-hidden>‹</span>{t('nav.home')}</Link>;
}
