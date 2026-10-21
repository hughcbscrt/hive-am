import { chatHref } from './lastChat';
import { HOME_GROUPS, sectionById, type HomeGroup, type SectionId } from './sections';
import type { Agent, Connection, Dispatch } from './types';

/*
 * What the Home page shows, from what the client already holds (no request of its own), with no React or DOM so
 * `server/scripts/test-web-home.ts` checks it. Ids and numbers only: the page puts the words.
 */

/** Rows of the recent delegations feed on Home (the Colony screen keeps six): with the current columns three fill one row of the grid, so Home fits a 1366x768 window. */
export const HOME_FEED = 3;

export type HomeState = 'loading' | 'error' | 'empty' | 'ready';
/** The "Now" strip: agents working, unread notices, delegations in progress, connections with an error. */
export interface Pill { id: 'running' | 'unread' | 'tasks' | 'errors'; count: number; /** None for unread: it opens the Activity panel. */ href?: string }
export interface HomeCard {
  id: SectionId;
  href: string;
  /** A total, the agents working or the colonies; none where the client has no number (or it failed to load). */
  count?: number;
  countKind?: 'total' | 'working' | 'colonies';
  /** Name of the last chat opened, while that agent exists. */
  last?: string;
  /** Connections with an error. */
  errors?: number;
}
export interface HomeView { state: HomeState; pills: Pill[]; quiet: boolean; groups: { id: HomeGroup; cards: HomeCard[] }[] }

export interface HomeInput {
  ready: boolean;
  error: string | null;
  agents: Pick<Agent, 'id' | 'name' | 'status'>[];
  types: readonly unknown[];
  skills: readonly unknown[];
  colonies: readonly unknown[];
  connections: Pick<Connection, 'status'>[];
  objects: readonly unknown[];
  dispatches: Pick<Dispatch, 'status'>[];
  /** Agents with an unread notice. */
  unreadCount: number;
  /** Id of the last chat opened (`hive-am.lastChat`). */
  lastChat: string;
}

export function homeModel(input: HomeInput): HomeView {
  const state: HomeState = input.error ? 'error' : !input.ready ? 'loading' : input.agents.length === 0 ? 'empty' : 'ready';
  const known = state === 'ready' || state === 'empty';
  const running = input.agents.filter((a) => a.status === 'running').length;
  const tasks = input.dispatches.filter((d) => d.status === 'queued' || d.status === 'running').length;
  const errors = input.connections.filter((c) => c.status.state === 'error').length;

  const pills: Pill[] = known ? ([
    { id: 'running', count: running, href: '/agents' },
    { id: 'unread', count: input.unreadCount },
    { id: 'tasks', count: tasks, href: '#recent' },
    { id: 'errors', count: errors, href: sectionById('connections').href },
  ] as Pill[]).filter((p) => p.count > 0) : [];

  const card = (id: SectionId): HomeCard => {
    const href = id === 'chat' ? chatHref(input.agents, input.lastChat) : sectionById(id).href;
    if (!known) return { id, href };
    const total = (n: number): HomeCard => ({ id, href, count: n, countKind: 'total' });
    switch (id) {
      case 'chat': { const last = input.agents.find((a) => a.id === input.lastChat)?.name; return last ? { id, href, last } : { id, href }; }
      case 'agents': return total(input.agents.length);
      case 'colony': return running ? { id, href, count: running, countKind: 'working' } : { id, href, count: input.colonies.length, countKind: 'colonies' };
      case 'resources': return total(input.objects.length);
      case 'connections': return errors ? { ...total(input.connections.length), errors } : total(input.connections.length);
      case 'types': return total(input.types.length);
      case 'skills': return total(input.skills.length);
      default: return { id, href };
    }
  };

  return { state, pills, quiet: known && pills.length === 0, groups: HOME_GROUPS.map((g) => ({ id: g.id, cards: g.ids.map(card) })) };
}
