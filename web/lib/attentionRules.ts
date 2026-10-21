import type { MessageKey } from './i18n/en';
import type { Agent, Block, Dispatch } from './types';

/*
 * The rules behind the unread notices and the one-line status of an agent, with no React, DOM or `@/` imports,
 * so `server/scripts/test-web-attention.ts` runs them as they are. The provider (lib/attention.tsx) keeps the state.
 */

export type NoticeKind = 'done' | 'error';
/** What a finished turn leaves behind for an agent you were not looking at. One per agent: a newer one replaces it. */
export interface Notice { kind: NoticeKind; at: number; snippet: string }
export type Unread = Record<string, Notice>;
export interface TurnEnd { agentId: string; kind: NoticeKind; source: 'user' | 'dispatch'; at: number; snippet: string }
/** The part of a streamed turn these rules read (`LiveTurn` in lib/store.tsx fits it). */
export interface TurnLike { source: 'user' | 'dispatch'; blocks: Block[]; error?: string }
export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export const UNREAD_KEY = 'hive-am.unread';
export const NOTIFY_KEY = 'hive-am.notify';
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_NOTICES = 100;
export const SNIPPET_MAX = 140;

/** Whitespace (line breaks included) collapsed to single spaces, then cut to `max` code points with `…` as the last one. */
export function oneLine(s: string, max = Infinity): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : flat;
}

/** The excerpt of a finished turn: the error when it failed with one, else its last text block. Empty when there is none. */
export function snippetOf(blocks: Block[], error?: string): string {
  if (error) return oneLine(error, SNIPPET_MAX);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.type === 'text') return oneLine(b.text, SNIPPET_MAX);
  }
  return '';
}

/**
 * A status change that ends a streamed turn (the same condition that bumps `finished` in the store), or null.
 * `silent` is the store's `clearLive`: dismissing an error banner is not the end of a turn.
 */
export function turnEnd(agentId: string, prev: TurnLike | undefined, status: Agent['status'], silent = false, now = Date.now()): TurnEnd | null {
  if (status === 'running' || !prev || silent) return null;
  const kind: NoticeKind = status === 'error' ? 'error' : 'done';
  return { agentId, kind, source: prev.source, at: now, snippet: snippetOf(prev.blocks, kind === 'error' ? prev.error : undefined) };
}

/** False when you are looking at the agent, and when a delegated turn ended well (its orchestrator tells you instead). */
export const shouldRecord = (end: TurnEnd, seen: boolean): boolean => !seen && !(end.kind === 'done' && end.source === 'dispatch');

export const addNotice = (unread: Unread, end: TurnEnd): Unread => ({ ...unread, [end.agentId]: { kind: end.kind, at: end.at, snippet: end.snippet } });

/** Pruning only runs once the agents loaded: before that the empty list would drop every notice. */
export const shouldPrune = (ready: boolean): boolean => ready;

/** Drops notices of agents that no longer exist and older than 7 days, and keeps the 100 most recent. Same object when nothing changes. */
export function pruneUnread(unread: Unread, agentIds: ReadonlySet<string>, now = Date.now()): Unread {
  const kept = Object.entries(unread).filter(([id, n]) => agentIds.has(id) && now - n.at <= MAX_AGE_MS).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_NOTICES);
  if (kept.length === Object.keys(unread).length) return unread;
  return Object.fromEntries(kept);
}

export function markRead(unread: Unread, id: string): Unread {
  if (!(id in unread)) return unread;
  const next = { ...unread }; delete next[id];
  return next;
}
export const markAll = (): Unread => ({});

/** Notices with their agent id, the most recent first. */
export const orderedNotices = (unread: Unread): (Notice & { id: string })[] => Object.entries(unread).map(([id, n]) => ({ id, ...n })).sort((a, b) => b.at - a.at);

const countText = (count: number) => (count > 99 ? '99+' : String(count));

/** The Activity badge: the number of agents with a notice, red when one of them failed. No badge (`tone: null`) at 0. */
export function badgeOf(unread: Unread): { count: number; text: string; tone: 'err' | 'ok' | null } {
  const all = Object.values(unread);
  return { count: all.length, text: countText(all.length), tone: !all.length ? null : all.some((n) => n.kind === 'error') ? 'err' : 'ok' };
}

export const tabTitle = (count: number): string => (count > 0 ? `(${countText(count)}) hive-am` : 'hive-am');

export type DotState = 'running' | 'err' | 'unread' | null;
/** The dot on an agent's avatar: working beats needs attention, which beats finished unread. */
export function dotState(status: Agent['status'], notice?: Notice): DotState {
  if (status === 'running') return 'running';
  if (status === 'error' || notice?.kind === 'error') return 'err';
  if (notice?.kind === 'done' && status === 'idle') return 'unread';
  return null;
}

/** Delegations an agent started that have not finished, the oldest first. */
export const openDelegations = (dispatches: Dispatch[], agentId: string): Dispatch[] =>
  dispatches.filter((d) => d.from_id === agentId && (d.status === 'queued' || d.status === 'running')).sort((a, b) => a.created_at - b.created_at);

export interface StatusInput {
  agent: Pick<Agent, 'id' | 'status' | 'description'>;
  dispatches: Dispatch[];
  /** Name of an agent by id; undefined when it no longer exists. */
  nameOf: (id: string) => string | undefined;
  /** What `activity()` (lib/activity.ts) says about its live turn, already computed. */
  activity: string | null;
  notice?: Notice;
}
export type StatusKind = 'deleg' | 'live' | 'done' | 'error' | 'desc';

/** The one line under an agent's name: its open delegations, else what it is doing, else its unread result, its error or its description. */
export function statusLine({ agent, dispatches, nameOf, activity, notice }: StatusInput, t: Translate): { kind: StatusKind; text: string } {
  const open = openDelegations(dispatches, agent.id).filter((d) => nameOf(d.to_id) !== undefined);
  if (open.length === 1) {
    const d = open[0];
    const line = t('attn.delegated', { count: 1, to: nameOf(d.to_id)!, task: oneLine(d.task) });
    return { kind: 'deleg', text: d.status === 'queued' ? `${line} (${t('attn.queuedTag')})` : line };
  }
  if (open.length > 1) {
    const names = [...new Set(open.map((d) => nameOf(d.to_id)!))].join(', ');
    return { kind: 'deleg', text: t('attn.delegated', { count: open.length, names }) };
  }
  if (activity) return { kind: 'live', text: activity };
  if (notice?.kind === 'done') return { kind: 'done', text: notice.snippet ? t('attn.line.done', { text: notice.snippet }) : t('attn.state.done') };
  if (agent.status === 'error') return { kind: 'error', text: t('status.error') };
  return { kind: 'desc', text: agent.description || t('switcher.noDescription') };
}
