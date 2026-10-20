'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { Boxes, MessageSquare, CalendarClock, Globe, Hexagon, History, Library, Moon, Network, PanelLeftClose, PanelLeftOpen, Server, SquareTerminal, Sun, Users, Plug } from 'lucide-react';
import { usePersistentState } from '@/lib/hooks/usePersistentState';
import { LAST_CHAT } from '@/lib/lastChat';
import { RAIL_KEY } from '@/lib/rail';
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

/** The main rail. Folded (`collapsed`), it is a column of icons: each entry keeps its label as accessible name and tooltip. */
function Nav({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const path = usePathname();
  const { t } = useI18n();
  const { agents, types, skills, connections, objects, connected } = useHive();
  const dock = useDock();
  // The inline script in layout.tsx already applied the theme (saved or the system's); this only follows it.
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement, read = () => setDark(el.dataset.theme === 'dark');
    read();
    const mo = new MutationObserver(read); mo.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  const flip = () => {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('hive-theme', next); } catch { /* ignore */ }
  };
  const running = agents.filter((a) => a.status === 'running').length;
  const [lastChat] = usePersistentState<string>(LAST_CHAT, '');
  const chatHref = agents.some((a) => a.id === lastChat) ? `/agents/${lastChat}` : agents[0] ? `/agents/${agents[0].id}` : '/chat';
  // Folded, the label is hidden, so it becomes the accessible name (with the count) and the tooltip; a count shows as a badge.
  const named = (label: string, count?: number) => (collapsed ? { 'aria-label': count !== undefined ? `${label}, ${count}` : label, title: label } : {});
  const badge = (count: number) => <span className="count">{collapsed && count > 99 ? '99+' : count}</span>;
  const item = (href: string, label: string, icon: ReactNode, count?: number, on?: boolean) => {
    const active = on ?? (href === '/' ? path === '/' : path.startsWith(href));
    return <Link key={label} href={href} className="nav" aria-current={active ? 'page' : undefined} {...named(label, count)}>{icon}<span className="t">{label}</span>{count !== undefined && badge(count)}</Link>;
  };
  const fold = collapsed ? t('nav.expand') : t('nav.collapse');
  return (
    <nav className="rail" aria-label={t('nav.main')}>
      <div className="brand"><HiveMark /><div className="brand-name">hive-am<small>{t('app.tagline')}</small></div>
        <button type="button" className="btn ghost icon sm rail-fold" onClick={onToggle} aria-expanded={!collapsed} aria-label={fold} title={fold}>{collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>
      </div>
      <LanguageSwitch />
      {item(chatHref, t('nav.chat'), <MessageSquare size={18} />, undefined, path.startsWith('/agents/') || path === '/chat')}
      {item('/', t('nav.colony'), <Hexagon size={18} />, running || undefined)}
      {item('/resources', t('nav.objects'), <Server size={18} />, objects.length || undefined)}
      {item('/agents', t('nav.agents'), <Users size={18} />, agents.length, path === '/agents')}
      {item('/relations', t('nav.relations'), <Network size={18} />)}
      {item('/connections', t('nav.connections'), <Plug size={18} />, connections.length || undefined)}
      {item('/schedules', t('nav.schedules'), <CalendarClock size={18} />)}
      <div className="nav-label">{t('nav.library')}</div>
      {item('/types', t('nav.types'), <Boxes size={18} />, types.length)}
      {item('/skills', t('nav.skills'), <Library size={18} />, skills.length)}
      <div className="nav-label">{t('nav.history')}</div>
      {item('/sessions', t('nav.sessions'), <History size={18} />)}
      <div className="rail-foot">
        <button type="button" className="nav" onClick={dock.toggle} aria-pressed={dock.open} {...named(t('dock.nav'), dock.tabs.length || undefined)} title={`${t('dock.nav')} (Ctrl+\`)`}><SquareTerminal size={18} /><span className="t">{t('dock.nav')}</span>{dock.tabs.length > 0 && badge(dock.tabs.length)}</button>
        <div className="conn" title={collapsed ? (connected ? t('nav.connected') : t('nav.offline')) : undefined}><i className={`dot ${connected ? 'ok' : 'err'}`} /><span className="t">{connected ? t('nav.connected') : t('nav.offline')}</span></div>
        <button type="button" className="nav" onClick={flip} aria-pressed={dark} {...named(t('nav.switchTheme'))}>{dark ? <Sun size={18} /> : <Moon size={18} />}<span className="t">{t('nav.switchTheme')}</span></button>
      </div>
    </nav>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [railCollapsed, setRailCollapsed, railLoaded] = usePersistentState<boolean>(RAIL_KEY, false);
  useLayoutEffect(() => { if (railLoaded) document.documentElement.dataset.rail = railCollapsed ? 'collapsed' : 'open'; }, [railCollapsed, railLoaded]);
  // The width only animates when the person folds or unfolds the rail, never while the saved choice is applied on arrival.
  const [railAnimate, setRailAnimate] = useState(false);
  const toggleRail = () => { setRailAnimate(true); setRailCollapsed(!railCollapsed); };
  return (
    <I18nProvider>
      <HiveProvider>
        <DockProvider>
          <Toaster>
            <Tooltips />
            <div className={`shell ${railAnimate ? 'rail-anim' : ''}`}><Nav collapsed={railCollapsed} onToggle={toggleRail} /><main className="main">{children}</main></div>
            <TerminalDock />
          </Toaster>
        </DockProvider>
      </HiveProvider>
    </I18nProvider>
  );
}
