'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { useHive } from '@/lib/store';
import { useI18n } from '@/lib/i18n';
import { PROVIDERS, ago, permissionLabel, shortPath } from '@/lib/meta';
import { activity } from '@/lib/activity';
import { Hex, RoleChip, StatusChip } from './ui';

const OPEN_DELAY = 280;   // ms of hovering before the card appears
const CARD_W = 310;
const GAP = 12;

interface Anchor { id: string; rect: DOMRect }

/**
 * Hover (and keyboard-focus) card with an agent's details.
 *
 *   const card = useAgentCard();
 *   <a {...card.bind(agent.id)}>…</a>      // any element
 *   {card.node}                            // render once
 *
 * The card is portalled to <body> and positioned beside the element, so it is never clipped by a scrolling list.
 * It ignores the pointer, so it never gets in the way of clicking.
 */
export function useAgentCard() {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const shown = useRef(false);
  shown.current = !!anchor;

  const open = useCallback((id: string, el: Element, instant: boolean) => {
    clearTimeout(timer.current);
    const show = () => setAnchor({ id, rect: el.getBoundingClientRect() });
    // Moving from one agent to the next while a card is up should feel continuous: no delay then.
    if (instant || shown.current) show(); else timer.current = setTimeout(show, OPEN_DELAY);
  }, []);
  const close = useCallback(() => { clearTimeout(timer.current); setAnchor(null); }, []);

  useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);   // lists scroll under the cursor
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [anchor, close]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const bind = useCallback((id: string) => ({
    onMouseEnter: (e: SyntheticEvent) => open(id, e.currentTarget, false),
    onMouseLeave: close,
    onFocus: (e: SyntheticEvent) => { if ((e.currentTarget as HTMLElement).matches(':focus-visible')) open(id, e.currentTarget, true); },
    onBlur: close,
    onClick: close,
  }), [open, close]);

  const node = anchor && typeof document !== 'undefined' ? createPortal(<AgentCard anchor={anchor} />, document.body) : null;
  return { bind, node };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="ap-row"><dt>{label}</dt><dd>{children}</dd></div>;
}

function AgentCard({ anchor }: { anchor: Anchor }) {
  const { t } = useI18n();
  const { agents, colonies, live } = useHive();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; side: 'right' | 'left' } | null>(null);
  const a = agents.find((x) => x.id === anchor.id);

  // Place it beside the anchor (right if there is room, otherwise left) and keep it inside the window.
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    const { rect } = anchor;
    const side = rect.right + GAP + CARD_W + 8 <= window.innerWidth ? 'right' : 'left';
    const left = side === 'right' ? rect.right + GAP : Math.max(8, rect.left - GAP - CARD_W);
    const top = Math.min(Math.max(8, rect.top + rect.height / 2 - h / 2), Math.max(8, window.innerHeight - h - 8));
    setPos({ left, top, side });
  }, [anchor, a?.status, a?.description]);

  if (!a) return null;
  const col = colonies.find((c) => c.id === a.colony_id);
  const act = activity(live[a.id]);
  const workers = a.worker_ids.map((id) => agents.find((x) => x.id === id)?.name).filter(Boolean) as string[];
  const bosses = agents.filter((q) => q.role === 'orchestrator' && q.worker_ids.includes(a.id)).map((q) => q.name);
  const list = (names: string[]) => (names.length > 4 ? `${names.slice(0, 4).join(', ')} ${t('hover.more', { count: names.length - 4 })}` : names.join(', '));

  return (
    <div ref={ref} className={`ap-card ${pos?.side ?? 'right'}`} role="tooltip" style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: CARD_W, visibility: pos ? 'visible' : 'hidden' }}>
      <div className="ap-head">
        <Hex agent={a} />
        <div className="grow" style={{ minWidth: 0 }}>
          <b className="ap-name">{a.name}</b>
          <div className="row gap-s wrap" style={{ marginTop: 4 }}><RoleChip role={a.role} /><StatusChip status={a.status} /></div>
        </div>
      </div>
      <p className={`ap-desc ${a.description ? '' : 'muted'}`}>{a.description || t('switcher.noDescription')}</p>
      {act && <div className="ap-now"><i className="dot run" />{act}</div>}
      <dl className="ap-rows">
        <Row label={t('form.provider')}>{PROVIDERS[a.provider].label}{a.model ? ` · ${a.model}` : ` · ${t('model.cliDefault')}`}</Row>
        <Row label={t('inherit.permissions')}>{permissionLabel(a.effective.permission)}</Row>
        <Row label={t('colony.folder')}><span className="mono">{shortPath(a.effective.cwd)}</span>{a.effective.inherited.includes('cwd') && <span className="muted"> · {t('colony.fromColony')}</span>}</Row>
        <Row label={t('form.colony')}>{col ? <><i className="cdot" style={{ background: col.color || 'var(--honey)' }} />{col.name}</> : <span className="muted">{t('common.noColony')}</span>}</Row>
        {a.role === 'orchestrator'
          ? <Row label={t('form.team')}>{workers.length ? list(workers) : <span className="muted">{t('colony.noWorkers')}</span>}</Row>
          : <Row label={t('rel.directedBy')}>{bosses.length ? list(bosses) : <span className="muted">{t('hover.noOrchestrator')}</span>}</Row>}
        <Row label={t('colony.session')}><span className="mono">{a.session_id ? `${a.session_id.slice(0, 12)}…` : t('colony.noSession')}</span></Row>
        <Row label={t('agents.col.updated')}>{ago(a.updated_at)}{!!a.queued && a.queued > 0 && <span className="muted"> · {t('queue.count', { count: a.queued })}</span>}</Row>
      </dl>
    </div>
  );
}
