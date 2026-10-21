import type { Notice, Unread } from './attentionRules';
import type { Agent, Colony } from './types';

/*
 * What the command palette lists for a query, with no React or DOM, so `server/scripts/test-web-palette.ts` checks it.
 * Sections in order: Unread, Agents, Go to, Actions; an empty one is left out. With no query the screens out of the menu
 * come first as "More sections" and only the first agents show, so they are in sight without scrolling.
 */

export const MAX_AGENTS = 50;
/** Agents listed with an empty query. */
export const EMPTY_AGENTS = 5;

/** Lower case and without diacritics, so "agil" finds "Ágil". */
export const normalize = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export type PaletteAgent = Pick<Agent, 'id' | 'name' | 'role' | 'description' | 'provider' | 'model' | 'status' | 'colony_id' | 'updated_at'>;
export interface GoTo { id: string; label: string; href: string; /** Other words that find it (`lib/sections.ts`). */ keywords?: string[]; /** Out of the menu: "More sections" with an empty query. */ more?: boolean }
export interface PaletteAction { id: string; label: string; /** Hidden with no unread notice (jump to the latest, mark all as read). */ needsUnread?: boolean }
export type PaletteItem =
  | { kind: 'unread'; key: string; agent: PaletteAgent; notice: Notice }
  | { kind: 'agent'; key: string; agent: PaletteAgent }
  | { kind: 'screen'; key: string; goTo: GoTo; /** The keyword that matched, when the label did not. */ via?: string }
  | { kind: 'action'; key: string; action: PaletteAction };
export interface PaletteSection { id: 'unread' | 'more' | 'agents' | 'screens' | 'actions'; items: PaletteItem[] }

export interface PaletteInput {
  query: string;
  /** False while the agents load: then only Go to and Actions (no agent is made up). */
  ready: boolean;
  agents: PaletteAgent[];
  colonies: Pick<Colony, 'id' | 'name'>[];
  unread: Unread;
  /** Id of the last chat opened (`hive-am.lastChat`). */
  lastChat: string;
  goTo: GoTo[];
  actions: PaletteAction[];
  /** Provider names to match besides their ids (e.g. "Claude Code"). */
  providerNames?: Partial<Record<Agent['provider'], string>>;
}

export function paletteSections(input: PaletteInput): { sections: PaletteSection[]; items: PaletteItem[]; more: boolean } {
  const q = normalize(input.query.trim());
  const hit = (text: string) => !q || normalize(text).includes(q);
  const colony = new Map(input.colonies.map((c) => [c.id, c.name]));
  const agentHit = (a: PaletteAgent) => hit([a.name, a.colony_id ? colony.get(a.colony_id) ?? '' : '', a.description, a.provider, input.providerNames?.[a.provider] ?? '', a.model].join(' '));
  const sections: PaletteSection[] = [];
  let more = false;
  const screen = (goTo: GoTo): PaletteItem => ({ kind: 'screen', key: `s:${goTo.id}`, goTo, ...(q && !hit(goTo.label) ? { via: goTo.keywords?.find(hit) } : {}) });
  const screenHit = (g: GoTo) => hit(g.label) || (g.keywords ?? []).some(hit);

  if (input.ready) {
    const byId = new Map(input.agents.map((a) => [a.id, a]));
    const unread = Object.entries(input.unread).filter(([id]) => byId.has(id) && agentHit(byId.get(id)!)).sort((a, b) => b[1].at - a[1].at);
    sections.push({ id: 'unread', items: unread.map(([id, notice]) => ({ kind: 'unread', key: `u:${id}`, agent: byId.get(id)!, notice })) });
  }
  if (!q) sections.push({ id: 'more', items: input.goTo.filter((g) => g.more).map(screen) });
  if (input.ready) {
    // Working first, then the last chat, then the most recently active.
    const rank = (a: PaletteAgent) => (a.status === 'running' ? 0 : a.id === input.lastChat ? 1 : 2);
    const agents = input.agents.filter(agentHit).sort((a, b) => rank(a) - rank(b) || b.updated_at - a.updated_at);
    const max = q ? MAX_AGENTS : EMPTY_AGENTS;
    more = agents.length > max;
    sections.push({ id: 'agents', items: agents.slice(0, max).map((agent) => ({ kind: 'agent', key: `a:${agent.id}`, agent })) });
  }
  // A screen whose name matches goes before one found by a keyword.
  const viaRank = (i: PaletteItem) => (i.kind === 'screen' && i.via ? 1 : 0);
  sections.push({ id: 'screens', items: input.goTo.filter((g) => (q ? screenHit(g) : !g.more)).map(screen).sort((a, b) => viaRank(a) - viaRank(b)) });
  const anyUnread = Object.keys(input.unread).length > 0;
  sections.push({ id: 'actions', items: input.actions.filter((a) => (anyUnread || !a.needsUnread) && hit(a.label)).map((action) => ({ kind: 'action', key: `x:${action.id}`, action })) });

  const shown = sections.filter((s) => s.items.length > 0);
  return { sections: shown, items: shown.flatMap((s) => s.items), more };
}
