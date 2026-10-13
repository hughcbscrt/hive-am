'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { ChevronLeft, Ellipsis } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Menu, MenuCheck, MenuItem } from './Menu';

export interface HeaderAction {
  id: string; label: string; icon?: ReactNode; hint?: string;
  onClick?: () => void; /** Navigates instead of calling onClick. */ href?: string;
  danger?: boolean; disabled?: boolean; /** Makes it an on / off toggle (aria-pressed; a checkbox inside the menu). */ pressed?: boolean;
}

/**
 * The top bar of a workspace (an agent, a resource): back link, avatar, name, a line of meta and the actions. `primary` is always visible;
 * `actions` are buttons while there is room and fold into one "more" menu when the bar is narrow (it measures itself, not the window).
 */
export function WorkspaceHeader({ back, avatar, title, meta, primary, actions = [] }: {
  back?: { href: string; label: string }; avatar?: ReactNode; title: ReactNode; meta?: ReactNode; primary?: ReactNode; actions?: HeaderAction[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const run = (a: HeaderAction) => (a.href ? router.push(a.href) : a.onClick?.());
  return (
    <header className="ws-head wsh">
      {back && <Link href={back.href} className="btn ghost icon wsh-back" aria-label={back.label} title={back.label}><ChevronLeft size={18} /></Link>}
      {avatar}
      <div className="wsh-id">
        <h1>{title}</h1>
        {meta && <div className="wsh-meta">{meta}</div>}
      </div>
      <div className="wsh-actions">
        {actions.length > 0 && (
          <div className="wsh-wide">
            {actions.map((a) => a.href
              ? <Link key={a.id} href={a.href} className={`btn sm ${a.danger ? 'danger' : ''}`} title={a.hint}>{a.icon}{a.label}</Link>
              : <button key={a.id} type="button" className={`btn sm ${a.danger ? 'danger' : ''} ${a.pressed ? 'on' : ''}`} disabled={a.disabled} aria-pressed={a.pressed} title={a.hint} onClick={a.onClick}>{a.icon}{a.label}</button>)}
          </div>
        )}
        {actions.length > 0 && (
          <div className="wsh-narrow">
            <Menu label={t('ws.more')} icon={<Ellipsis size={16} />} iconOnly>
              {(close) => actions.map((a) => a.pressed !== undefined
                ? <MenuCheck key={a.id} checked={a.pressed} hint={a.hint} onChange={() => { a.onClick?.(); close(); }}>{a.label}</MenuCheck>
                : <MenuItem key={a.id} icon={a.icon} hint={a.hint} danger={a.danger} disabled={a.disabled} onClick={() => { close(); run(a); }}>{a.label}</MenuItem>)}
            </Menu>
          </div>
        )}
        {primary}
      </div>
    </header>
  );
}
