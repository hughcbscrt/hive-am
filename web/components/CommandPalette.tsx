'use client';
import { useEffect, useId, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { useHiveData } from '@/lib/store';
import { useActivityPanel, useAttention } from '@/lib/attention';
import { dotState } from '@/lib/attentionRules';
import { paletteSections, type GoTo, type PaletteAction, type PaletteItem, type PaletteSection } from '@/lib/paletteRules';
import { HOTKEYS, keysText } from '@/lib/hotkeyRules';
import { usePersistentState } from '@/lib/hooks/usePersistentState';
import { LAST_CHAT, chatHref } from '@/lib/lastChat';
import { flipTheme } from '@/lib/theme';
import { useDock } from '@/lib/dock';
import { useI18n } from '@/lib/i18n';
import { PROVIDERS, ago } from '@/lib/meta';
import type { MessageKey } from '@/lib/i18n';
import { Banner, Dialog, Hex, useCombobox } from './ui';
import { StatePip } from './agents/StatePip';

const SECTION_LABEL: Record<PaletteSection['id'], MessageKey> = { unread: 'attn.unread.head', agents: 'nav.agents', screens: 'cmd.group.screens', actions: 'cmd.group.actions' };
const ACTION_KEYS: Record<string, string> = { jumpUnread: 'unread', rail: 'rail', terminal: 'terminal', shortcuts: 'help' };

/**
 * Ctrl/⌘ K: jump to an agent, a screen or an action from anywhere. A Dialog (focus trap, Escape, focus back to the opener)
 * with a combobox: the field keeps the focus and the highlighted option is announced. What it lists: lib/paletteRules.ts.
 */
export function CommandPalette({ onClose, collapsed, mac, onToggleRail, onShortcuts }: { onClose: () => void; collapsed: boolean; mac: boolean; onToggleRail: () => void; onShortcuts: () => void }) {
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const { agents, colonies, ready, error, retry } = useHiveData();
  const { unread, latest, markAll } = useAttention();
  const { openActivity } = useActivityPanel();
  const dock = useDock();
  const [lastChat] = usePersistentState<string>(LAST_CHAT, '');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const titleId = useId();

  const goTo: GoTo[] = [
    { id: 'chat', label: t('nav.chat'), href: chatHref(agents, lastChat) }, { id: 'colony', label: t('nav.colony'), href: '/' },
    { id: 'resources', label: t('nav.objects'), href: '/resources' }, { id: 'agents', label: t('nav.agents'), href: '/agents' },
    { id: 'relations', label: t('nav.relations'), href: '/relations' }, { id: 'connections', label: t('nav.connections'), href: '/connections' },
    { id: 'schedules', label: t('nav.schedules'), href: '/schedules' }, { id: 'types', label: t('nav.types'), href: '/types' },
    { id: 'skills', label: t('nav.skills'), href: '/skills' }, { id: 'sessions', label: t('nav.sessions'), href: '/sessions' },
  ];
  const actions: PaletteAction[] = [
    { id: 'activity', label: t('cmd.act.activity') }, { id: 'jumpUnread', label: t('cmd.act.jumpUnread'), needsUnread: true },
    { id: 'markAll', label: t('attn.markAll'), needsUnread: true }, { id: 'rail', label: collapsed ? t('nav.expand') : t('nav.collapse') },
    { id: 'theme', label: t('nav.switchTheme') }, { id: 'language', label: t('cmd.act.language') },
    { id: 'terminal', label: t('keys.terminal') }, { id: 'shortcuts', label: t('cmd.act.shortcuts') },
  ];
  const providerNames = useMemo(() => Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, v.label])), []);
  const { sections, items, more } = paletteSections({ query, ready, agents, colonies, unread, lastChat, goTo, actions, providerNames });
  const cur = items.length ? Math.min(active, items.length - 1) : -1;
  const combo = useCombobox(true, cur, items.length);
  useEffect(() => setActive(0), [query]);
  // Keep the highlighted option in sight while moving with the arrows.
  useEffect(() => { if (cur >= 0) document.getElementById(combo.optionProps(cur).id)?.scrollIntoView({ block: 'nearest' }); }, [cur]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = (item: PaletteItem) => {
    onClose();
    if (item.kind === 'unread' || item.kind === 'agent') return router.push(`/agents/${item.agent.id}`);
    if (item.kind === 'screen') return router.push(item.goTo.href);
    switch (item.action.id) {
      case 'activity': return openActivity();
      case 'jumpUnread': return latest ? router.push(`/agents/${latest}`) : undefined;
      case 'markAll': return markAll();
      case 'rail': return onToggleRail();
      case 'theme': return flipTheme();
      case 'language': return setLocale(locale === 'en' ? 'es' : 'en');
      case 'terminal': return dock.toggle();
      case 'shortcuts': return onShortcuts();
    }
  };
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    // The field is an open combobox, which the Dialog leaves Escape to: it closes the palette here.
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (!items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((cur + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((cur - 1 + items.length) % items.length); }
    else if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); setActive(0); }
    else if (e.key === 'End' && e.ctrlKey) { e.preventDefault(); setActive(items.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); run(items[cur]); }
  };

  const colonyName = (id: string | null) => (id ? colonies.find((c) => c.id === id)?.name : undefined);
  const stateText = (s: ReturnType<typeof dotState>) => (s === 'running' ? t('status.running') : s === 'err' ? t('status.error') : s === 'unread' ? t('attn.state.done') : '');
  const row = (item: PaletteItem) => {
    if (item.kind === 'unread' || item.kind === 'agent') {
      const a = item.agent, state = dotState(a.status, unread[a.id]), col = colonyName(a.colony_id);
      return (<>
        <span className="sw-av"><Hex agent={a} /><StatePip state={state} /></span>
        <span className="cmdk-txt"><b>{a.name}</b>{col && <small>{col}</small>}</span>
        <span className="cmdk-meta">{item.kind === 'unread' ? t(item.notice.kind === 'error' ? 'attn.row.error' : 'attn.row.done', { when: ago(item.notice.at) }) : stateText(state)}</span>
      </>);
    }
    if (item.kind === 'screen') return <span className="cmdk-txt"><b>{item.goTo.label}</b></span>;
    const def = HOTKEYS.find((h) => h.id === ACTION_KEYS[item.action.id]);
    return (<>
      <span className="cmdk-txt"><b>{item.action.label}</b></span>
      {def && <kbd className="cmdk-meta" aria-hidden>{keysText(def.keys, mac)}</kbd>}
    </>);
  };

  let index = -1;
  return (
    <Dialog onClose={onClose} labelId={titleId} className="cmdk">
      <h2 id={titleId} className="sr-only">{t('cmd.title')}</h2>
      <div className="cmdk-field">
        <Search size={17} aria-hidden />
        <input data-autofocus className="cmdk-input" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} placeholder={t('cmd.placeholder')} aria-label={t('cmd.placeholder')} autoComplete="off" spellCheck={false} {...combo.input} />
      </div>
      {error && <div className="cmdk-err"><Banner kind="warn" action={<button type="button" className="btn sm" onClick={() => void retry()}>{t('cx.retry')}</button>}>{t('cx.loadFailed')} {error}</Banner></div>}
      <div className="cmdk-list" {...combo.listProps} aria-label={t('cmd.title')}>
        {sections.map((s) => (
          <div key={s.id} role="group" aria-labelledby={`${titleId}-${s.id}`}>
            <div id={`${titleId}-${s.id}`} className="cmdk-sec" role="presentation">{t(SECTION_LABEL[s.id])}</div>
            {s.items.map((item) => {
              const i = ++index;
              return (
                <div key={item.key} {...combo.optionProps(i)} className="cmdk-opt" onMouseMove={() => i !== cur && setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => run(item)}>{row(item)}</div>
              );
            })}
            {s.id === 'agents' && more && <p className="cmdk-more">{t('cmd.more')}</p>}
          </div>
        ))}
        {!items.length && <p className="cmdk-empty">{t('cmd.empty', { query })}</p>}
      </div>
      <div className="cmdk-foot" aria-hidden>{t('cmd.hint')}</div>
      <div className="sr-only" aria-live="polite">{query.trim() ? t('cmd.results', { count: items.length }) : ''}</div>
    </Dialog>
  );
}
