'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ChevronDown, ExternalLink, Loader2, Play, RotateCw, Server, Square } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { useHive } from '@/lib/store';
import { usePersistentState } from '@/lib/hooks/usePersistentState';
import { StatusDot } from '@/components/objects/ObjectPanel';
import { KIND, STATUS_TONE, detailText } from '@/components/objects/meta';
import { ACTIONABLE } from '@/components/objects/ManagerField';
import { useToast } from '@/components/ui';
import type { Agent, ObjectView } from '@/lib/types';

type Action = 'start' | 'stop' | 'restart';
type Status = ObjectView['state']['status'];

/** The states worth counting in the closed header, most urgent first. */
const ORDER: Status[] = ['error', 'starting', 'running', 'ready', 'stopped', 'unknown'];

/**
 * The resources next to the chat, folded above it. Closed: one line that says how many are up, stopped or failing (a failure is loud).
 * Open: a card per resource with the one action that makes sense now (start or stop), restart, and a way into its own screen.
 */
export function ResourceStrip({ agent }: { agent: Agent }) {
  const { t } = useI18n();
  const { objects } = useHive();
  const toast = useToast();
  const [open, setOpen] = usePersistentState('hive-am.chat.resources', false);
  const [scope, setScope] = usePersistentState<'mine' | 'all'>('hive-am.chat.resources.scope', 'mine');
  const [busy, setBusy] = useState<string | null>(null);
  if (objects.length === 0) return null;
  const mine = objects.filter((o) => o.manager_id === agent.id || (o.colony_id ?? null) === (agent.colony_id ?? null));
  const all = scope === 'all' || mine.length === 0;
  const shown = all ? objects : mine;
  const count = (s: Status) => shown.filter((o) => o.state.status === s).length;
  const act = async (o: ObjectView, action: Action) => {
    setBusy(`${o.id}:${action}`);
    try { await api.post(`/objects/${o.id}/action`, { action }); }
    catch (e) { toast(`${t('obj.act.failed', { action: t(`obj.act.${action}`) })}: ${e instanceof Error ? e.message : ''}`, 'err'); }
    finally { setBusy(null); }
  };
  return (
    <div className="cres">
      <button type="button" className="cres-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Server size={15} aria-hidden /><b>{t('cres.title')}</b>
        <span className="cres-sum">
          {ORDER.filter((s) => count(s) > 0).map((s) => <span key={s} className={`cres-n ${STATUS_TONE[s]}`}><StatusDot status={s} />{count(s)} <em>{t(`cres.n.${s}`)}</em></span>)}
        </span>
        <ChevronDown size={15} className={`chev2 ${open ? 'open' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="cres-body">
          {mine.length > 0 && mine.length < objects.length && (
            <div className="seg cres-scope" role="group" aria-label={t('cres.scope')}>
              <button type="button" aria-pressed={!all} onClick={() => setScope('mine')}>{t('cres.mine', { a1: String(mine.length) })}</button>
              <button type="button" aria-pressed={all} onClick={() => setScope('all')}>{t('cres.all', { a1: String(objects.length) })}</button>
            </div>
          )}
          {mine.length === 0 && <p className="muted small cres-note">{t('cres.none')}</p>}
          <ul className="cres-grid">
            {shown.map((o) => {
              const Icon = KIND[o.kind].icon, st = o.state.status, live = st === 'running' || st === 'starting', can = ACTIONABLE.includes(o.kind);
              const mine1 = busy?.startsWith(`${o.id}:`) ?? false;
              const detail = detailText(t, o.state.detail);
              return (
                <li key={o.id} className={`cres-card ${STATUS_TONE[st]}`}>
                  <span className="cres-ico" style={{ ['--c' as never]: KIND[o.kind].color }}><Icon size={16} aria-hidden /></span>
                  <div className="cres-info">
                    <Link className="cres-name" href={`/resources/${o.id}`} title={t('obj.open')}>{o.name}</Link>
                    <span className={`cres-st ${STATUS_TONE[st]}`} title={detail || undefined}><StatusDot status={st} />{t(`obj.status.${st}`)}{detail && st === 'error' ? <em>{detail}</em> : null}</span>
                  </div>
                  <div className="cres-act">
                    {mine1 && <Loader2 size={14} className="spin muted" aria-hidden />}
                    {can && (live
                      ? <button type="button" className="btn ghost icon sm" disabled={!!busy} onClick={() => void act(o, 'stop')} aria-label={t('obj.act.stop')} title={t('obj.act.stop')}><Square size={14} /></button>
                      : <button type="button" className="btn ghost icon sm" disabled={!!busy} onClick={() => void act(o, 'start')} aria-label={t('obj.act.start')} title={t('obj.act.start')}><Play size={14} /></button>)}
                    {can && <button type="button" className="btn ghost icon sm" disabled={!!busy} onClick={() => void act(o, 'restart')} aria-label={t('obj.act.restart')} title={t('obj.act.restart')}><RotateCw size={14} /></button>}
                    <Link className="btn ghost icon sm" href={`/resources/${o.id}`} aria-label={t('obj.open')} title={t('obj.open')}><ExternalLink size={14} /></Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
