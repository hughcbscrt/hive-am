'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bell, Search, Globe, Keyboard, Moon, PanelLeftClose, PanelLeftOpen, SquareTerminal, Sun } from 'lucide-react';
import { usePersistentState } from '@/lib/hooks/usePersistentState';
import { LAST_CHAT, chatHref as chatTarget } from '@/lib/lastChat';
import { flipTheme } from '@/lib/theme';
import { useHotkeys, useIsMac } from '@/lib/hotkeys';
import { keysText } from '@/lib/hotkeyRules';
import { RAIL_KEY } from '@/lib/rail';
import { sectionById, type SectionId } from '@/lib/sections';
import { ShellCommandsContext, useShellCommands, type ShellCommands } from '@/lib/shellCommands';
import { HiveProvider, useHiveData } from '@/lib/store';
import { AttentionProvider, useActivityPanel, useAttention } from '@/lib/attention';
import { badgeOf } from '@/lib/attentionRules';
import { I18nProvider, LOCALES, useI18n } from '@/lib/i18n';
import { Toaster } from './ui';
import { Tooltips } from './Tooltips';
import { DockProvider, useDock } from '@/lib/dock';
import { TerminalDock } from './dock/TerminalDock';
import { ActivityPanel } from './ActivityPanel';
import { CommandPalette } from './CommandPalette';
import { ShortcutsSheet } from './ShortcutsSheet';
import { SECTION_ICON } from './sectionIcons';
import { useRouter } from 'next/navigation';

const VERSION = process.env.NEXT_PUBLIC_HIVE_AM_VERSION ?? '';

function HiveMark() {
  return <img src="/icon.png" width={34} height={34} alt="" aria-hidden className="brand-mark" />;
}

/** Language switch at the top of the rail, and the keyboard shortcuts sheet at its right. The language lives in localStorage; URLs never change. */
function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n();
  const { openShortcuts } = useShellCommands();
  return (
    <div className="lang-row">
      <Globe size={15} aria-hidden />
      <div className="seg" role="group" aria-label={t('lang.label')}>
        {LOCALES.map((l) => (
          <button key={l.id} type="button" aria-pressed={locale === l.id} lang={l.id} title={l.name} aria-label={l.name} onClick={() => setLocale(l.id)}>{l.short}</button>
        ))}
      </div>
      <button type="button" className="btn ghost icon rail-keys" onClick={openShortcuts} aria-haspopup="dialog" aria-label={t('keys.title')} title={`${t('keys.title')} (?)`}><Keyboard size={17} aria-hidden /></button>
    </div>
  );
}

/** The main rail. Folded (`collapsed`), it is a column of icons: each entry keeps its label as accessible name and tooltip. */
function Nav({ collapsed, onToggle, onOpenPalette, mac }: { collapsed: boolean; onToggle: () => void; onOpenPalette: () => void; mac: boolean }) {
  const path = usePathname();
  const { t } = useI18n();
  const { agents, objects, connected } = useHiveData();
  const dock = useDock();
  // The inline script in layout.tsx already applied the theme (saved or the system's); this only follows it.
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement, read = () => setDark(el.dataset.theme === 'dark');
    read();
    const mo = new MutationObserver(read); mo.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  const running = agents.filter((a) => a.status === 'running').length;
  const [lastChat] = usePersistentState<string>(LAST_CHAT, '');
  const chatHref = chatTarget(agents, lastChat);
  // Folded, the label is hidden, so it becomes the accessible name (with the count) and the tooltip; a count shows as a badge.
  const named = (label: string, count?: number) => (collapsed ? { 'aria-label': count !== undefined ? `${label}, ${count}` : label, title: label } : {});
  const badge = (count: number) => <span className="count">{collapsed && count > 99 ? '99+' : count}</span>;
  const item = (id: SectionId, count?: number, on?: boolean, countLabel?: string) => {
    const s = sectionById(id), Icon = SECTION_ICON[id], label = t(s.labelKey), icon = <Icon size={18} />;
    const href = id === 'chat' ? chatHref : s.href;
    const active = on ?? (href === '/' ? path === '/' : path.startsWith(href));
    // A count that needs words (Colony counts the agents working) names it the same way folded or not.
    const names = countLabel ? { 'aria-label': `${label}, ${countLabel}`, title: `${label}, ${countLabel}` } : named(label, count);
    return <Link key={label} href={href} className="nav" aria-current={active ? 'page' : undefined} {...names}>{icon}<span className="t">{label}</span>{count !== undefined && badge(count)}</Link>;
  };
  const fold = `${collapsed ? t('nav.expand') : t('nav.collapse')} (${keysText(['Mod', 'B'], mac)})`;
  const paletteKeys = keysText(['Mod', 'K'], mac);
  return (
    <nav className="rail" aria-label={t('nav.main')}>
      <div className="brand"><Link href="/" className="brand-link" aria-label={`hive-am, ${t('nav.home')}`}><HiveMark /><div className="brand-name">hive-am<small>{t('app.tagline')}</small></div></Link>
        <button type="button" className="btn ghost icon sm rail-fold" onClick={onToggle} aria-expanded={!collapsed} aria-label={fold} title={fold}>{collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>
      </div>
      <LanguageSwitch />
      <button type="button" className="nav" onClick={onOpenPalette} aria-haspopup="dialog" {...(collapsed ? { 'aria-label': t('cmd.navHint', { keys: paletteKeys }), title: t('cmd.navHint', { keys: paletteKeys }) } : {})}>
        <Search size={18} /><span className="t">{t('cmd.nav')}</span><kbd className="nav-kbd" aria-hidden>{paletteKeys}</kbd>
      </button>
      {item('home')}
      {item('chat', undefined, path.startsWith('/agents/') || path === '/chat')}
      {item('colony', running || undefined, undefined, running ? t('attn.running.count', { count: running }) : undefined)}
      {item('resources', objects.length || undefined)}
      {item('agents', agents.length, path === '/agents')}
      {item('schedules')}
      {/* Relations, Connections, Agent types, Skills and Sessions live in Home and the palette: say where, unfolded only. */}
      {!collapsed && <p className="rail-hint">{t('nav.moreHint', { home: t('nav.home'), keys: paletteKeys })}</p>}
      <div className="rail-foot">
        <ActivityButton collapsed={collapsed} />
        <button type="button" className="nav" onClick={dock.toggle} aria-pressed={dock.open} {...named(t('dock.nav'), dock.tabs.length || undefined)} title={`${t('dock.nav')} (Ctrl+\`)`}><SquareTerminal size={18} /><span className="t">{t('dock.nav')}</span>{dock.tabs.length > 0 && badge(dock.tabs.length)}</button>
        {/* The connection and the version share a row: a short word in sight, the whole sentence as tooltip and for screen readers. */}
        <div className="conn ver" title={connected ? t('nav.connected') : t('nav.offline')}>
          <i className={`dot ${connected ? 'ok' : 'err'}`} /><span className="t" aria-hidden>{connected ? t('nav.connectedShort') : t('nav.offline')}</span><span className="sr-only">{connected ? t('nav.connected') : t('nav.offline')}</span>
          {VERSION && <span className="v" title={t('nav.version', { version: VERSION })}>v{VERSION}</span>}
        </div>
        <button type="button" className="nav" onClick={flipTheme} aria-pressed={dark} {...named(t('nav.switchTheme'))}>{dark ? <Sun size={18} /> : <Moon size={18} />}<span className="t">{t('nav.switchTheme')}</span></button>
      </div>
    </nav>
  );
}

/** First item of the rail foot, right above Terminal: the unread notices badge, and the panel right after it in the DOM (so the tab order follows). */
function ActivityButton({ collapsed }: { collapsed: boolean }) {
  const { t } = useI18n();
  const { unread } = useAttention();
  const { open, toggleActivity, closeActivity } = useActivityPanel();
  const wrap = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const badge = badgeOf(unread);
  // Folding or unfolding the rail animates its width: close rather than chase the button.
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } closeActivity(); }, [collapsed]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="act" ref={wrap}>
      <button ref={button} type="button" className="nav activity" onClick={toggleActivity} aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? id : undefined}
        {...(badge.count ? { 'aria-label': t('attn.navUnread', { count: badge.count }) } : {})} {...(collapsed ? { title: t('attn.nav'), ...(badge.count ? {} : { 'aria-label': t('attn.nav') }) } : {})}>
        <Bell size={18} /><span className="t">{t('attn.nav')}</span>{badge.tone && <span className={`count attn ${badge.tone}`}>{badge.text}</span>}
      </button>
      {open && <ActivityPanel id={id} wrap={wrap} button={button} onClose={closeActivity} />}
    </div>
  );
}

/** The palette, the shortcuts sheet and the global keys that open them (inside the providers they read). */
function Commands({ palette, setPalette, sheet, setSheet, collapsed, onToggleRail, mac }: { palette: boolean; setPalette: (v: boolean) => void; sheet: boolean; setSheet: (v: boolean) => void; collapsed: boolean; onToggleRail: () => void; mac: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const { latest, announce } = useAttention();
  useHotkeys({
    palette: () => setPalette(!palette),
    help: () => setSheet(true),
    rail: onToggleRail,
    unread: () => (latest ? router.push(`/agents/${latest}`) : announce(t('attn.noUnread'))),
  }, palette, mac);
  return (<>
    {palette && <CommandPalette onClose={() => setPalette(false)} collapsed={collapsed} mac={mac} onToggleRail={onToggleRail} onShortcuts={() => setSheet(true)} />}
    {sheet && <ShortcutsSheet onClose={() => setSheet(false)} mac={mac} />}
  </>);
}

export function Shell({ children }: { children: ReactNode }) {
  const [railCollapsed, setRailCollapsed, railLoaded] = usePersistentState<boolean>(RAIL_KEY, false);
  useLayoutEffect(() => { if (railLoaded) document.documentElement.dataset.rail = railCollapsed ? 'collapsed' : 'open'; }, [railCollapsed, railLoaded]);
  // The width only animates when the person folds or unfolds the rail, never while the saved choice is applied on arrival.
  const [railAnimate, setRailAnimate] = useState(false);
  const toggleRail = () => { setRailAnimate(true); setRailCollapsed((c) => !c); };
  const [palette, setPalette] = useState(false);
  const [sheet, setSheet] = useState(false);
  const mac = useIsMac();
  const commands = useMemo<ShellCommands>(() => ({ openPalette: () => setPalette(true), openShortcuts: () => setSheet(true) }), []);
  return (
    <I18nProvider>
      <HiveProvider>
        <DockProvider>
          <AttentionProvider>
            <Toaster>
              <Tooltips />
              <ShellCommandsContext.Provider value={commands}>
                <div className={`shell ${railAnimate ? 'rail-anim' : ''}`}><Nav collapsed={railCollapsed} onToggle={toggleRail} onOpenPalette={commands.openPalette} mac={mac} /><main className="main">{children}</main></div>
              </ShellCommandsContext.Provider>
              <Commands palette={palette} setPalette={setPalette} sheet={sheet} setSheet={setSheet} collapsed={railCollapsed} onToggleRail={toggleRail} mac={mac} />
              <TerminalDock />
            </Toaster>
          </AttentionProvider>
        </DockProvider>
      </HiveProvider>
    </I18nProvider>
  );
}
