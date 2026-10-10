'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Boxes, CalendarClock, Globe, Hexagon, History, Library, Moon, Network, Server, SquareTerminal, Sun, Users, Plug } from 'lucide-react';
import { HiveProvider, useHive } from '@/lib/store';
import { I18nProvider, LOCALES, useI18n } from '@/lib/i18n';
import { Toaster } from './ui';
import { Tooltips } from './Tooltips';
import { DockProvider, useDock } from '@/lib/dock';
import { TerminalDock } from './dock/TerminalDock';

function HiveMark() {
  return <img src="/icon.png" width={34} height={34} alt="" aria-hidden className="brand-mark" />;
}

/** Language switch at the top of the rail. The choice lives in localStorage; URLs never change. */
function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="lang-row" role="group" aria-label={t('lang.label')}>
      <Globe size={15} aria-hidden />
      <div className="seg">
        {LOCALES.map((l) => (
          <button key={l.id} type="button" aria-pressed={locale === l.id} lang={l.id} title={l.name} aria-label={l.name} onClick={() => setLocale(l.id)}>{l.short}</button>
        ))}
      </div>
    </div>
  );
}

function Nav() {
  const path = usePathname();
  const { t } = useI18n();
  const { agents, types, skills, connections, objects, connected } = useHive();
  const dock = useDock();
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);
  useEffect(() => { try { const saved = localStorage.getItem('hive-theme') as 'light' | 'dark' | null; if (saved) { setTheme(saved); document.documentElement.dataset.theme = saved; } } catch { /* ignore */ } }, []);
  const flip = () => {
    const dark = theme ? theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    setTheme(next); document.documentElement.dataset.theme = next;
    try { localStorage.setItem('hive-theme', next); } catch { /* ignore */ }
  };
  const running = agents.filter((a) => a.status === 'running').length;
  const item = (href: string, label: string, icon: ReactNode, count?: number) => {
    const active = href === '/' ? path === '/' : path.startsWith(href);
    return <Link key={href} href={href} className="nav" aria-current={active ? 'page' : undefined}>{icon}<span className="t">{label}</span>{count !== undefined && <span className="count">{count}</span>}</Link>;
  };
  return (
    <nav className="rail" aria-label={t('nav.main')}>
      <div className="brand"><HiveMark /><div>hive-am<small>{t('app.tagline')}</small></div></div>
      <LanguageSwitch />
      {item('/', t('nav.colony'), <Hexagon size={18} />, running || undefined)}
      {item('/objects', t('nav.objects'), <Server size={18} />, objects.length || undefined)}
      {item('/agents', t('nav.agents'), <Users size={18} />, agents.length)}
      {item('/relations', t('nav.relations'), <Network size={18} />)}
      {item('/connections', t('nav.connections'), <Plug size={18} />, connections.length || undefined)}
      {item('/schedules', t('nav.schedules'), <CalendarClock size={18} />)}
      <div className="nav-label">{t('nav.library')}</div>
      {item('/types', t('nav.types'), <Boxes size={18} />, types.length)}
      {item('/skills', t('nav.skills'), <Library size={18} />, skills.length)}
      <div className="nav-label">{t('nav.history')}</div>
      {item('/sessions', t('nav.sessions'), <History size={18} />)}
      <div className="rail-foot">
        <button className="btn ghost sm" onClick={dock.toggle} aria-pressed={dock.open} title={`${t('dock.nav')} (Ctrl+\`)`} style={{ justifyContent: 'flex-start' }}><SquareTerminal size={15} /> {t('dock.nav')}{dock.tabs.length > 0 && <span className="count" style={{ marginLeft: 'auto' }}>{dock.tabs.length}</span>}</button>
        <div className="conn"><i className={`dot ${connected ? 'ok' : 'err'}`} />{connected ? t('nav.connected') : t('nav.offline')}</div>
        <button className="btn ghost sm" onClick={flip} style={{ justifyContent: 'flex-start' }}>{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />} {t('nav.switchTheme')}</button>
      </div>
    </nav>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <HiveProvider>
        <DockProvider>
          <Toaster>
            <Tooltips />
            <div className="shell"><Nav /><main className="main">{children}</main></div>
            <TerminalDock />
          </Toaster>
        </DockProvider>
      </HiveProvider>
    </I18nProvider>
  );
}
