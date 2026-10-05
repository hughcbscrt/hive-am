'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, Plus, Search } from 'lucide-react';
import { useHive } from '@/lib/store';
import { PROVIDERS, ago } from '@/lib/meta';
import { useI18n } from '@/lib/i18n';
import { activity } from '@/lib/activity';
import { useAgentCard } from './AgentCard';
import type { Agent } from '@/lib/types';
import { Hex } from './ui';
import { NewAgentDrawer } from './NewAgentDrawer';

export function AgentSwitcher({ activeId, collapsed = false, onToggle }: { activeId: string; collapsed?: boolean; onToggle?: () => void }) {
  const { t } = useI18n();
  const { agents, colonies, live } = useHive();
  const card = useAgentCard();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);

  const groups = useMemo(() => {
    const match = (a: Agent) => !q || `${a.name} ${a.description} ${a.provider} ${a.model}`.toLowerCase().includes(q.toLowerCase());
    const out: { key: string; name: string; color: string | null; items: Agent[] }[] = colonies.map((c) => ({ key: c.id, name: c.name, color: c.color || 'var(--honey)', items: agents.filter((a) => a.colony_id === c.id && match(a)) }));
    out.push({ key: 'free', name: t('common.noColony'), color: null, items: agents.filter((a) => (!a.colony_id || !colonies.some((c) => c.id === a.colony_id)) && match(a)) });
    return out.filter((g) => g.items.length);
  }, [agents, colonies, q, t]);

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
        <div className="switcher-list">
          {groups.map((g) => (
            <div key={g.key} className="mini-group">
              <div className="mini-sep" title={`${g.name} · ${g.items.length}`} style={g.color ? { ['--c' as any]: g.color } : undefined} />
              {g.items.map((a) => (
                <Link key={a.id} href={`/agents/${a.id}`} className="sw-item mini" aria-current={a.id === activeId ? 'page' : undefined} aria-label={a.name} {...card.bind(a.id)}>
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

  return (
    <aside className="switcher" aria-label={t('nav.agents')}>
      <div className="switcher-head">
        <div className="row"><b style={{ fontFamily: 'var(--font-display)', fontSize: 16 }} className="grow">{t('nav.agents')}</b>
          {toggleBtn}
          <button className="btn ghost icon sm" onClick={() => setCreating(true)} aria-label={t('newAgent.title')}><Plus size={16} /></button></div>
        <div className="search"><Search size={15} /><input className="input" placeholder={t('switcher.find')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('switcher.find')} /></div>
      </div>
      <div className="switcher-list">
        {groups.length === 0 && <p className="muted small" style={{ padding: 16 }}>{t('switcher.noMatch', { query: q })}</p>}
        {groups.map((g) => (
          <div key={g.key}>
            <div className="switcher-group">{g.color && <i className="cdot" style={{ background: g.color }} />}{g.name}<span>{g.items.length}</span></div>
            {g.items.map((a) => {
              const act = activity(live[a.id]);
              return (
                <Link key={a.id} href={`/agents/${a.id}`} className="sw-item" aria-current={a.id === activeId ? 'page' : undefined} {...card.bind(a.id)}>
                  <span className="sw-av"><Hex agent={a} />{a.status !== 'idle' && <i className={`pip ${a.status === 'error' ? 'err' : ''}`} />}</span>
                  <span className="sw-body">
                    <span className="sw-top"><b>{a.name}</b>{a.role === 'orchestrator' && <em>{t('role.orchestrator')}</em>}</span>
                    <span className={`sw-sub ${act ? 'live' : a.description ? '' : 'blank'}`}>{act ?? (a.status === 'error' ? t('status.error') : a.description || t('switcher.noDescription'))}</span>
                    <span className="sw-meta"><i style={{ background: PROVIDERS[a.provider].color }} />{PROVIDERS[a.provider].short}{a.model ? ` · ${a.model}` : ''}<span className="sw-ago">{!!a.queued && a.queued > 0 ? t('queue.count', { count: a.queued }) : ago(a.updated_at)}</span></span>
                  </span>
                </Link>
              );
            })}
          </div>
        ))}
      </div>
      {creating && <NewAgentDrawer onClose={() => setCreating(false)} />}
      {card.node}
    </aside>
  );
}
