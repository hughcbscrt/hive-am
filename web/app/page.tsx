'use client';
import Link from 'next/link';
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Keyboard, Plus, Search } from 'lucide-react';
import { useHiveData } from '@/lib/store';
import { useActivityPanel, useAttention } from '@/lib/attention';
import { usePersistentState } from '@/lib/hooks/usePersistentState';
import { LAST_CHAT } from '@/lib/lastChat';
import { useIsMac } from '@/lib/hotkeys';
import { keysText } from '@/lib/hotkeyRules';
import { HOME_FEED, homeModel, type HomeCard, type Pill } from '@/lib/homeModel';
import { sectionById } from '@/lib/sections';
import { useShellCommands } from '@/lib/shellCommands';
import { useI18n } from '@/lib/i18n';
import { Banner } from '@/components/ui';
import { NewAgentDrawer } from '@/components/agents/NewAgentDrawer';
import { RecentDelegations } from '@/components/RecentDelegations';
import { SECTION_ICON } from '@/components/sectionIcons';

/** Home: every screen as a card in three groups, what is happening now, and the latest delegations. What it shows: lib/homeModel.ts. */
export default function Home() {
  const { t } = useI18n();
  const router = useRouter();
  const { agents, types, skills, colonies, connections, objects, dispatches, ready, error, retry } = useHiveData();
  const { unread } = useAttention();
  const { openActivity } = useActivityPanel();
  const { openPalette, openShortcuts } = useShellCommands();
  const [lastChat] = usePersistentState<string>(LAST_CHAT, '');
  const mac = useIsMac();
  const [creating, setCreating] = useState(false);
  const ids = useId();
  const view = homeModel({ ready, error, agents, types, skills, colonies, connections, objects, dispatches, unreadCount: Object.keys(unread).length, lastChat });
  const known = view.state === 'ready' || view.state === 'empty';

  const pill = (p: Pill) => {
    switch (p.id) {
      case 'running': return <Link key={p.id} href={p.href!} className="nowt"><i className="dot run" aria-hidden />{t('attn.running.count', { count: p.count })}</Link>;
      case 'unread': return <button key={p.id} type="button" className="nowt" onClick={openActivity} aria-haspopup="dialog"><Bell size={15} aria-hidden />{t('home.now.unread', { count: p.count })}</button>;
      case 'tasks': return <Link key={p.id} href={p.href!} className="nowt"><i className="dot wait" aria-hidden />{t('home.now.tasks', { count: p.count })}</Link>;
      case 'errors': return <Link key={p.id} href={p.href!} className="nowt"><i className="dot err" aria-hidden />{t('home.now.errors', { count: p.count })}</Link>;
    }
  };
  const meta = (c: HomeCard) => {
    if (c.last) return <span className="hm">{t('hm.last', { name: c.last })}</span>;
    if (c.count === undefined) return null;
    const text = c.countKind === 'working' ? t('attn.running.count', { count: c.count }) : String(c.count);
    return <span className={`hm${c.count === 0 ? ' zero' : ''}${c.countKind === 'working' ? '' : ' num'}`}>{text}</span>;
  };
  const card = (c: HomeCard) => {
    const s = sectionById(c.id), Icon = SECTION_ICON[c.id];
    return (
      <li key={c.id}>
        <Link href={c.href} className="hc">
          <span className="hi" aria-hidden><Icon size={20} /></span>
          <b>{t(s.labelKey)}</b>
          {meta(c)}
          {s.descKey && <span className="hd">{t(s.descKey)}</span>}
          {c.errors ? <span className="hw"><i className="dot err" aria-hidden />{t('hm.connErr', { count: c.errors })}</span> : null}
        </Link>
      </li>
    );
  };

  return (
    <div className="page home">
      <div className="home-head">
        <div><h1>{t('home.title')}</h1><p>{t('home.sub')}</p></div>
        <div className="home-tools">
          <button type="button" className="jumpbtn" onClick={openPalette} aria-haspopup="dialog"><Search size={16} aria-hidden /><span>{t('home.search')}</span><kbd aria-hidden>{keysText(['Mod', 'K'], mac)}</kbd></button>
          <button type="button" className="jumpbtn keysbtn" onClick={openShortcuts} aria-haspopup="dialog"><Keyboard size={16} aria-hidden /><span>{t('keys.title')}</span><kbd aria-hidden>?</kbd></button>
        </div>
      </div>
      {view.state === 'error' && <div className="home-err"><Banner kind="err" action={<button type="button" className="btn sm" onClick={() => void retry()}>{t('cx.retry')}</button>}>{t('home.err')}</Banner></div>}
      {known && (view.quiet ? <p className="quiet">{t('home.quiet')}</p> : <div className="now">{view.pills.map(pill)}</div>)}
      {view.state === 'empty' && (
        <div className="firstrun">
          <div><b>{t('home.first.title')}</b><p>{t('home.first.body')}</p></div>
          <button type="button" className="btn primary" onClick={() => setCreating(true)}><Plus size={16} aria-hidden />{t('colony.empty.createAgent')}</button>
        </div>
      )}
      {view.state === 'loading'
        ? <div className="hgrid home-skel" role="status" aria-label={t('cx.loading')}>{Array.from({ length: 10 }, (_, i) => <div key={i} className="skel" />)}</div>
        : view.groups.map((g) => (
          <section key={g.id} className="hgroup" aria-labelledby={`${ids}-${g.id}`}>
            <h2 id={`${ids}-${g.id}`}>{t(`home.g.${g.id}`)}</h2>
            <ul className="hgrid">{g.cards.map(card)}</ul>
          </section>
        ))}
      {known && <RecentDelegations feed={dispatches} agents={agents} limit={HOME_FEED} viewAll />}
      {creating && <NewAgentDrawer onClose={() => setCreating(false)} onCreated={(id) => router.push(`/agents/${id}`)} />}
    </div>
  );
}
