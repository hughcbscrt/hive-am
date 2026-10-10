'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, Plus, Search } from 'lucide-react';
import { useHive } from '@/lib/store';
import { useI18n } from '@/lib/i18n/index';
import type { ObjectView } from '@/lib/types';
import { KIND } from './meta';
import { StatusDot } from './ObjectPanel';
import { ObjectEditor } from './ObjectEditor';

/** The list of objects at the left of the Objects screen, grouped by colony, like the agents' list. It folds to icons. */
export function ObjectSwitcher({ activeId, collapsed = false, onToggle }: { activeId?: string; collapsed?: boolean; onToggle?: () => void }) {
  const { t } = useI18n();
  const { objects, colonies } = useHive();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);

  const groups = useMemo(() => {
    const match = (o: ObjectView) => !q || `${o.name} ${o.kind}`.toLowerCase().includes(q.toLowerCase());
    const out: { key: string; name: string; color: string | null; items: ObjectView[] }[] = colonies.map((c) => ({ key: c.id, name: c.name, color: c.color || 'var(--honey)', items: objects.filter((o) => o.colony_id === c.id && match(o)) }));
    out.push({ key: 'free', name: t('obj.noColony'), color: null, items: objects.filter((o) => (!o.colony_id || !colonies.some((c) => c.id === o.colony_id)) && match(o)) });
    return out.filter((g) => g.items.length);
  }, [objects, colonies, q, t]);

  const toggleBtn = onToggle && (
    <button className="btn ghost icon sm" onClick={onToggle} aria-label={collapsed ? t('ow.expand') : t('ow.collapse')} title={collapsed ? t('ow.expand') : t('ow.collapse')} aria-expanded={!collapsed}>
      {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
    </button>
  );

  if (collapsed) {
    return (
      <aside className="switcher mini" aria-label={t('nav.objects')}>
        <div className="switcher-head">{toggleBtn}<button className="btn ghost icon sm" onClick={() => setCreating(true)} aria-label={t('obj.new')} title={t('obj.new')}><Plus size={16} /></button></div>
        <div className="switcher-list">
          {groups.map((g) => (
            <div key={g.key} className="mini-group">
              <div className="mini-sep" title={`${g.name} · ${g.items.length}`} style={g.color ? { ['--c' as never]: g.color } : undefined} />
              {g.items.map((o) => { const { icon: Icon, color } = KIND[o.kind]; return (
                <Link key={o.id} href={`/objects/${o.id}`} className="sw-item mini" aria-current={o.id === activeId ? 'page' : undefined} aria-label={o.name} title={`${o.name} — ${t(`obj.status.${o.state.status}`)}`}>
                  <span className="sw-av"><span className="obj-ico sm" style={{ ['--c' as never]: color }}><Icon size={17} /></span><StatusDot status={o.state.status} className="sw-dot" /></span>
                </Link>); })}
            </div>
          ))}
        </div>
        {creating && <ObjectEditor onClose={() => setCreating(false)} />}
      </aside>
    );
  }
  return (
    <aside className="switcher" aria-label={t('nav.objects')}>
      <div className="switcher-head">
        <div className="row"><b style={{ fontFamily: 'var(--font-display)', fontSize: 16 }} className="grow">{t('nav.objects')}</b>{toggleBtn}
          <button className="btn ghost icon sm" onClick={() => setCreating(true)} aria-label={t('obj.new')} title={t('obj.new')}><Plus size={16} /></button></div>
        <div className="search"><Search size={15} /><input className="input" placeholder={t('ow.find')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('ow.find')} /></div>
      </div>
      <div className="switcher-list">
        {groups.length === 0 && <p className="muted small" style={{ padding: 16 }}>{q ? t('ow.noMatch', { query: q }) : t('ow.empty.body')}</p>}
        {groups.map((g) => (
          <div key={g.key}>
            <div className="switcher-group">{g.color && <i className="cdot" style={{ background: g.color }} />}{g.name}<span>{g.items.length}</span></div>
            {g.items.map((o) => { const { icon: Icon, color } = KIND[o.kind]; return (
              <Link key={o.id} href={`/objects/${o.id}`} className="sw-item" aria-current={o.id === activeId ? 'page' : undefined}>
                <span className="sw-av"><span className="obj-ico sm" style={{ ['--c' as never]: color }}><Icon size={17} /></span></span>
                <span className="sw-body">
                  <span className="sw-top"><b>{o.name}</b></span>
                  <span className="sw-sub"><StatusDot status={o.state.status} /> {t(`obj.status.${o.state.status}`)}{o.state.detail ? ` · ${o.state.detail}` : ''}</span>
                  <span className="sw-meta">{t(`obj.kind.${o.kind}`)}</span>
                </span>
              </Link>); })}
          </div>
        ))}
      </div>
      {creating && <ObjectEditor onClose={() => setCreating(false)} />}
    </aside>
  );
}
