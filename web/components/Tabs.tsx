'use client';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export interface TabDef {
  id: string; label: ReactNode; count?: number; disabled?: boolean; icon?: ReactNode;
  /** Only the icon (the label is its name and tooltip) unless this tab is the selected one. */ iconOnly?: boolean;
  /** Makes the tab closable: an x button next to it (outside the tab itself) and the Delete key. */ onClose?: (id: string) => void;
}

const DEFAULT_PREFIX = 'tabs';
export const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
export const panelId = (prefix: string, id: string) => `${prefix}-panel-${id}`;

/**
 * A row of tabs (ARIA tablist): the selected one is the only one in the tab order, arrow keys / Home / End move between them and select.
 * Pair each with a `TabPanel` using the same `idPrefix` (give distinct prefixes when two tab sets share a page). `variant="pill"` is the compact look.
 */
export function Tabs({ tabs, value, onChange, label, idPrefix = DEFAULT_PREFIX, variant = 'tab' }: { tabs: TabDef[]; value: string; onChange: (id: string) => void; label: string; idPrefix?: string; variant?: 'tab' | 'pill' }) {
  const { t: tr } = useI18n();
  const closeLabel = tr('tabs.close');
  const list = useRef<HTMLDivElement>(null);
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const on = tabs.filter((t) => !t.disabled);
    const i = on.findIndex((t) => t.id === value);
    const cur = (e.target as HTMLElement).closest<HTMLElement>('[role=tab]');
    const curDef = tabs.find((t) => cur && cur.id === tabId(idPrefix, t.id));
    if (e.key === 'Delete' && curDef?.onClose) { e.preventDefault(); curDef.onClose(curDef.id); return; }
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % on.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + on.length) % on.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = on.length - 1;
    if (next === null || !on.length) return;
    e.preventDefault();
    onChange(on[next].id);
    requestAnimationFrame(() => document.getElementById(tabId(idPrefix, on[next!].id))?.focus());
  };
  // If the selected one is not in the list (or is disabled) the first enabled tab takes the tab stop, so the row is still reachable.
  const stop = tabs.some((t) => t.id === value && !t.disabled) ? value : tabs.find((t) => !t.disabled)?.id;
  return (
    <div ref={list} className={`tabs ${variant === 'pill' ? 'pill' : ''}`} role="tablist" aria-label={label} onKeyDown={key}>
      {tabs.map((t) => {
        const short = t.iconOnly && t.icon && value !== t.id, name = typeof t.label === 'string' ? t.label : undefined;
        const btn = (
          <button key={t.onClose ? undefined : t.id} id={tabId(idPrefix, t.id)} type="button" role="tab" className="tab" aria-selected={value === t.id} aria-controls={panelId(idPrefix, t.id)}
            aria-label={short ? name : undefined} title={short ? name : undefined} tabIndex={stop === t.id ? 0 : -1} disabled={t.disabled} onClick={() => onChange(t.id)}>
            {t.icon}{!short && t.label}{!short && t.count !== undefined && <span className="tab-count">{t.count}</span>}
          </button>
        );
        if (!t.onClose) return btn;
        return (
          <span key={t.id} className="tabwrap" role="presentation">
            {btn}
            <button type="button" className="tab-x" tabIndex={-1} onClick={() => t.onClose?.(t.id)} aria-label={name ? `${closeLabel}: ${name}` : closeLabel} title={closeLabel}><X size={12} /></button>
          </span>
        );
      })}
    </div>
  );
}

/** The content of one tab. Only the selected one renders unless `keepMounted` (then the others stay in the DOM, hidden, and keep their state). */
export function TabPanel({ id, value, idPrefix = DEFAULT_PREFIX, children, keepMounted = false }: { id: string; value: string; idPrefix?: string; children: ReactNode; keepMounted?: boolean }) {
  const active = id === value;
  if (!active && !keepMounted) return null;
  return <div id={panelId(idPrefix, id)} role="tabpanel" aria-labelledby={tabId(idPrefix, id)} hidden={!active} className="tabpanel">{children}</div>;
}
