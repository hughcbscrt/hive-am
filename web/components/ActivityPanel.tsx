'use client';
import Link from 'next/link';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { CheckCheck, X } from 'lucide-react';
import { useHiveData, useLive } from '@/lib/store';
import { useAttention } from '@/lib/attention';
import { dotState, openDelegations, orderedNotices, statusLine } from '@/lib/attentionRules';
import { activity } from '@/lib/activity';
import { useDismiss } from '@/lib/useDismiss';
import { useI18n } from '@/lib/i18n';
import { ago } from '@/lib/meta';
import type { Agent, Colony, Dispatch } from '@/lib/types';
import { Banner, EmptyState, Hex } from './ui';
import { StatePip } from './agents/StatePip';

const EDGE = 8;

/**
 * The Activity popover of the rail foot: unread notices, the agents working now and the browser notifications switch.
 * Not modal: a click outside, Escape or tabbing out closes it. On a desktop it grows upwards from the Activity button,
 * at the right of the rail; under 760px it is a bottom sheet (globals.css, .act-pop).
 */
export function ActivityPanel({ id, wrap, button, onClose }: { id: string; wrap: RefObject<HTMLElement | null>; button: RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  const { t } = useI18n();
  const { agents, colonies, dispatches, ready, connected } = useHiveData();
  const { unread, markRead, markAll, notify, notifyState, setNotify } = useAttention();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId(), notifyId = useId();
  const back = () => button.current?.focus();
  useDismiss(true, wrap, onClose, back);

  // Anchored to the button: left edge at the rail's right edge + 8px, bottom edge level with the button's, never closer than 8px to the window.
  const [pos, setPos] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    const place = () => {
      const b = button.current?.getBoundingClientRect(), rail = button.current?.closest('.rail')?.getBoundingClientRect();
      if (!b || !rail) return;
      const bottom = Math.max(EDGE, window.innerHeight - b.bottom);
      const room = window.innerHeight - bottom - EDGE;
      setPos({ '--ap-left': `${rail.right + EDGE}px`, '--ap-bottom': `${bottom}px`, '--ap-max': `${Math.min(window.innerHeight * 0.7, 520, room)}px`, '--ap-notch': `${Math.max(6, b.height / 2 - 5 - (bottom - (window.innerHeight - b.bottom)))}px` } as CSSProperties);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [button]);

  // Focus the first unread row, or the title when there is none.
  useEffect(() => {
    const p = panel.current; if (!p) return;
    (p.querySelector<HTMLElement>('.act-unread .act-link') ?? p.querySelector<HTMLElement>(`[id="${titleId}"]`))?.focus({ preventScroll: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = new Map(agents.map((a) => [a.id, a]));
  const colonyOf = (a: Agent) => colonies.find((c) => c.id === a.colony_id);
  const notices = orderedNotices(unread).filter((n) => byId.has(n.id));
  const now = agents.filter((a) => a.status === 'running' || (a.role === 'orchestrator' && openDelegations(dispatches, a.id).length > 0));

  return (
    <div ref={panel} id={id} className="act-pop card" role="dialog" aria-label={t('attn.panel.label')} style={pos}
      onBlur={(e) => { if (e.relatedTarget instanceof Node && !wrap.current?.contains(e.relatedTarget)) onClose(); }}>
      <div className="act-head">
        <h2 id={titleId} tabIndex={-1}>{t('attn.unread.head')}{notices.length > 0 && <span className="act-n"> {notices.length}</span>}</h2>
        <button type="button" className="btn ghost sm" onClick={markAll} disabled={!notices.length}>{t('attn.markAll')}</button>
        <button type="button" className="btn ghost icon sm act-close" onClick={() => { onClose(); back(); }} aria-label={t('common.close')} title={t('common.close')}><X size={16} /></button>
      </div>
      <div className="act-body">
        {!connected && ready && <Banner kind="warn">{t('nav.offline')}</Banner>}
        {!ready ? (
          <div className="act-skel" aria-hidden>{[0, 1, 2].map((i) => <div key={i} className="skel" />)}</div>
        ) : notices.length === 0 ? (
          <EmptyState compact icon={<CheckCheck size={20} />} title={t('attn.empty.title')} body={t('attn.empty.body')} />
        ) : (
          <ul className="act-list act-unread">
            {notices.map((n) => {
              const a = byId.get(n.id)!, col = colonyOf(a);
              return (
                <li key={n.id} className="act-row">
                  <Link href={`/agents/${a.id}`} className="act-link" onClick={onClose}>
                    <span className="sw-av"><Hex agent={a} /><StatePip state={dotState(a.status, n)} /></span>
                    <span className="act-txt">
                      <span className="act-top"><b>{a.name}</b>{col && <em className="act-col"><i className="cdot" style={{ background: col.color || 'var(--honey)' }} />{col.name}</em>}</span>
                      <span className="act-state">{t(n.kind === 'error' ? 'attn.row.error' : 'attn.row.done', { when: ago(n.at) })}</span>
                      {n.snippet && <span className="act-snip">{n.snippet}</span>}
                    </span>
                  </Link>
                  <button type="button" className="btn ghost icon sm act-x" onClick={() => markRead(n.id)} aria-label={t('attn.markOne', { name: a.name })} title={t('attn.markOne', { name: a.name })}><X size={14} /></button>
                </li>
              );
            })}
          </ul>
        )}
        <h3 className="act-sec">{t('attn.running.head')}</h3>
        {!ready ? null : now.length === 0 ? <p className="act-none">{t('attn.runningEmpty')}</p> : (
          <ul className="act-list">
            {now.map((a) => <NowRow key={a.id} agent={a} colony={colonyOf(a)} dispatches={dispatches} nameOf={(x) => byId.get(x)?.name} onOpen={onClose} />)}
          </ul>
        )}
      </div>
      <div className="act-foot">
        <label htmlFor={notifyId} className="act-notify">
          <span className="grow"><b>{t('attn.notify.label')}</b>
            <small>{notifyState === 'denied' ? t('attn.notify.denied') : notifyState === 'unsupported' ? t('attn.notify.unsupported') : t('attn.notify.hint')}</small></span>
          <button id={notifyId} type="button" role="switch" className="switch" aria-checked={notify} disabled={notifyState === 'denied' || notifyState === 'unsupported'} onClick={() => void setNotify(!notify)} />
        </label>
      </div>
    </div>
  );
}

/** One agent of "Now", with the same line as the side list. It alone follows that agent's streamed turn. */
function NowRow({ agent: a, colony, dispatches, nameOf, onOpen }: { agent: Agent; colony?: Colony; dispatches: Dispatch[]; nameOf: (id: string) => string | undefined; onOpen: () => void }) {
  const { t } = useI18n();
  const live = useLive(a.id);
  const line = statusLine({ agent: a, dispatches, nameOf, activity: activity(live) }, t);
  return (
    <li className="act-row">
      <Link href={`/agents/${a.id}`} className="act-link" onClick={onOpen}>
        <span className="sw-av"><Hex agent={a} /><StatePip state={dotState(a.status)} /></span>
        <span className="act-txt">
          <span className="act-top"><b>{a.name}</b>{colony && <em className="act-col"><i className="cdot" style={{ background: colony.color || 'var(--honey)' }} />{colony.name}</em>}</span>
          <span className={`act-snip ${line.kind === 'deleg' || line.kind === 'live' ? 'strong' : ''}`}>{line.text}</span>
        </span>
      </Link>
    </li>
  );
}
