'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, PanelLeftClose, PanelLeftOpen, Plus, Search } from 'lucide-react';
import { useHive } from '@/lib/store';
import { usePersistentState } from '@/lib/hooks/usePersistentState';
import { PROVIDERS, ago } from '@/lib/meta';
import { useI18n } from '@/lib/i18n/index';
import { activity } from '@/lib/activity';
import { useAgentCard } from './AgentCard';
import type { Agent } from '@/lib/types';
import { Hex } from '@/components/ui';
import { NewAgentDrawer } from './NewAgentDrawer';
import { Copy } from 'lucide-react';

export function AgentSwitcher({ activeId, collapsed = false, onToggle }: { activeId: string; collapsed?: boolean; onToggle?: () => void }) {
  const { t } = useI18n();
  const { agents, colonies, live, ready } = useHive();
  const card = useAgentCard();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  // Folded groups (colony ids and 'free'), remembered; ids of colonies that no longer exist are dropped on the next change.
  const [foldedRaw, setFolded] = usePersistentState<string[]>('hive-am.switcher.folded', []);
  const folded = Array.isArray(foldedRaw) ? foldedRaw : [];
  const toggleGroup = (key: string) => setFolded((f) => {
    const kept = (Array.isArray(f) ? f : []).filter((k) => k === 'free' || colonies.some((c) => c.id === k));
    return kept.includes(key) ? kept.filter((k) => k !== key) : [...kept, key];
  });

  const groups = useMemo(() => {
    const match = (a: Agent) => !q || `${a.name} ${a.description} ${a.provider} ${a.model}`.toLowerCase().includes(q.toLowerCase());
    const out: { key: string; name: string; color: string | null; items: Agent[] }[] = colonies.map((c) => ({ key: c.id, name: c.name, color: c.color || 'var(--honey)', items: agents.filter((a) => a.colony_id === c.id && match(a)) }));
    out.push({ key: 'free', name: t('common.noColony'), color: null, items: agents.filter((a) => (!a.colony_id || !colonies.some((c) => c.id === a.colony_id)) && match(a)) });
    return out.filter((g) => g.items.length);
  }, [agents, colonies, q, t]);

  // Bring the active agent into view when the list mounts (arrival, reload, folding the list) or the active agent changes,
  // once its row exists; the list is left alone when the row is already visible.
  const listRef = useRef<HTMLDivElement>(null);
  const shown = useRef('');
  useEffect(() => {
    const list = listRef.current, row = list?.querySelector<HTMLElement>('.sw-item[aria-current]');
    const at = `${activeId}:${collapsed}`;
    if (!list || !row || shown.current === at) return;
    shown.current = at;
    const l = list.getBoundingClientRect(), r = row.getBoundingClientRect();
    if (r.top < l.top) list.scrollTop -= l.top - r.top;
    else if (r.bottom > l.bottom) list.scrollTop += r.bottom - l.bottom;
  });

  const toggleBtn = onToggle && (
    <button className="btn ghost icon sm" onClick={onToggle} aria-label={collapsed ? t('switcher.expand') : t('switcher.collapse')} title={collapsed ? t('switcher.expand') : t('switcher.collapse')} aria-expanded={!collapsed}>
      {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
    </button>
  );

  // Collapsed: just each agent's avatar (its initial), still grouped by colony, with the name as a tooltip.
  if (collapsed) {
    return (
      <aside className="switcher mini" aria-label={t('nav.agents')}>
        <div className="switcher-head">{toggleBtn}<button className="btn ghost icon sm" onClick={() => setCreating(true)} aria-label={t('newAgent.title')} title={t('newAgent.title')}><Plus size={16} /></button></div>
        <div className="switcher-list" ref={listRef}>
          {groups.map((g) => (
            <div key={g.key} className="mini-group">
              <div className="mini-sep" title={`${g.name} · ${g.items.length}`} style={g.color ? { ['--c' as any]: g.color } : undefined} />
              {g.items.map((a) => (
                <Link key={a.id} href={`/agents/${a.id}`} className="sw-item mini" aria-current={a.id === activeId ? 'page' : undefined} aria-label={a.cloned_from && agents.some((x) => x.id === a.cloned_from) ? `${a.name}, ${t('agent.cloneOf', { name: agents.find((x) => x.id === a.cloned_from)!.name })}` : a.name} {...card.bind(a.id)}>
                  <span className="sw-av"><Hex agent={a} />{a.status !== 'idle' && <i className={`pip ${a.status === 'error' ? 'err' : ''}`} />}</span>
                </Link>
              ))}
            </div>
          ))}
        </div>
        {creating && <NewAgentDrawer onClose={() => setCreating(false)} />}
        {card.node}
      </aside>
    );
  }

  // One row of the full list.
  const row = (a: Agent) => {
    const act = activity(live[a.id]);
    return (
      <Link key={a.id} href={`/agents/${a.id}`} className="sw-item" aria-current={a.id === activeId ? 'page' : undefined} {...card.bind(a.id)}>
        <span className="sw-av"><Hex agent={a} />{a.status !== 'idle' && <i className={`pip ${a.status === 'error' ? 'err' : ''}`} />}</span>
        <span className="sw-body">
          <span className="sw-top"><b>{a.name}</b>{a.role === 'orchestrator' && <em>{t('role.orchestrator')}</em>}{a.cloned_from && agents.some((x) => x.id === a.cloned_from) && <em className="clone" title={t('agent.cloneOf', { name: agents.find((x) => x.id === a.cloned_from)!.name })}><Copy size={9} aria-hidden />{agents.find((x) => x.id === a.cloned_from)!.name}</em>}</span>
          <span className={`sw-sub ${act ? 'live' : a.description ? '' : 'blank'}`}>{act ?? (a.status === 'error' ? t('status.error') : a.description || t('switcher.noDescription'))}</span>
          <span className="sw-meta"><i style={{ background: PROVIDERS[a.provider].color }} />{PROVIDERS[a.provider].short}{a.model ? ` · ${a.model}` : ''}<span className="sw-ago">{!!a.queued && a.queued > 0 ? t('queue.count', { count: a.queued }) : ago(a.updated_at)}</span></span>
        </span>
      </Link>
    );
  };

  return (
    <aside className="switcher" aria-label={t('nav.agents')}>
      <div className="switcher-head">
        <div className="row"><b style={{ fontFamily: 'var(--font-display)', fontSize: 16 }} className="grow">{t('nav.agents')}</b>
          {toggleBtn}
          <button className="btn ghost icon sm" onClick={() => setCreating(true)} aria-label={t('newAgent.title')}><Plus size={16} /></button></div>
        <div className="search"><Search size={15} /><input className="input" placeholder={t('switcher.find')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('switcher.find')} /></div>
      </div>
      <div className="switcher-list" ref={listRef}>
        {groups.length === 0 && (q || ready) && <p className="muted small" style={{ padding: 16 }}>{q ? t('switcher.noMatch', { query: q }) : t('switcher.empty')}</p>}
        {groups.map((g) => {
          // While searching every group with a match is open, whatever was saved, so a result is never hidden.
          const open = !!q || !folded.includes(g.key);
          // A folded group still shows the agent you are on, and a pulsing dot when one of its agents is working.
          const busy = g.items.filter((a) => a.status === 'running').length;
          // Orchestrators first; otherwise the order the agents came in (the sort is stable).
          const items = [...g.items].sort((a, b) => Number(b.role === 'orchestrator') - Number(a.role === 'orchestrator'));
          return (
            <div key={g.key}>
              <button type="button" className="switcher-group" aria-expanded={open} disabled={!!q} onClick={() => toggleGroup(g.key)} title={open ? t('switcher.groupFold', { name: g.name }) : t('switcher.groupUnfold', { name: g.name })}>
                <ChevronRight size={13} className="chev" aria-hidden />{g.color && <i className="cdot" style={{ background: g.color }} />}<span className="sg-name">{g.name}</span>
                {!open && busy > 0 && <i className="pip" role="img" aria-label={t('switcher.groupBusy', { count: busy })} />}<span className="sg-count">{g.items.length}</span>
              </button>
              {(open ? items : items.filter((a) => a.id === activeId)).map(row)}
            </div>
          );
        })}
      </div>
      {creating && <NewAgentDrawer onClose={() => setCreating(false)} />}
      {card.node}
    </aside>
  );
}
