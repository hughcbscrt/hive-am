import type { MessageKey } from './i18n/en';

/*
 * The screens of the web app in one place, with no React or DOM, so the scripts in `server/scripts/` load it: where each
 * lives, its name and description keys, the words that also find it in the palette (Ctrl K), and whether it sits in the
 * menu or under "More sections" (palette) and the Home cards.
 */

export type SectionId = 'home' | 'chat' | 'colony' | 'resources' | 'agents' | 'schedules' | 'relations' | 'connections' | 'types' | 'skills' | 'sessions';

export interface Section {
  id: SectionId;
  /** Chat goes to the last chat opened (`lib/lastChat.ts`); this is where it lands without one. */
  href: string;
  labelKey: MessageKey;
  /** One line under the name in the Home card (none for Home itself). */
  descKey: MessageKey | null;
  /** Synonyms without diacritics (the palette strips them), in English and Spanish: they find the screen in either language. */
  keywords: string[];
  /** Out of the menu: reached from Home and listed under "More sections" in the palette. */
  more: boolean;
}

/** Menu order first, then the five screens that live in Home and the palette. */
export const SECTIONS: Section[] = [
  { id: 'home', href: '/', labelKey: 'nav.home', descKey: null, keywords: ['inicio', 'home', 'start', 'panel', 'dashboard'], more: false },
  { id: 'chat', href: '/chat', labelKey: 'nav.chat', descKey: 'hc.chat', keywords: [], more: false },
  { id: 'colony', href: '/colony', labelKey: 'nav.colony', descKey: 'hc.colony', keywords: [], more: false },
  { id: 'resources', href: '/resources', labelKey: 'nav.objects', descKey: 'hc.resources', keywords: [], more: false },
  { id: 'agents', href: '/agents', labelKey: 'nav.agents', descKey: 'hc.agents', keywords: [], more: false },
  { id: 'schedules', href: '/schedules', labelKey: 'nav.schedules', descKey: 'hc.schedules', keywords: [], more: false },
  { id: 'relations', href: '/relations', labelKey: 'nav.relations', descKey: 'hc.relations', keywords: ['relaciones', 'relations', 'grafo', 'graph', 'orquestadores', 'orchestrators'], more: true },
  { id: 'connections', href: '/connections', labelKey: 'nav.connections', descKey: 'hc.connections', keywords: ['conexiones', 'connections', 'telegram', 'slack', 'canales', 'channels', 'bots'], more: true },
  { id: 'types', href: '/types', labelKey: 'nav.types', descKey: 'hc.types', keywords: ['tipos de agente', 'types', 'agent types', 'tipos', 'plantillas', 'templates', 'blueprints'], more: true },
  { id: 'skills', href: '/skills', labelKey: 'nav.skills', descKey: 'hc.skills', keywords: ['skills', 'habilidades', 'instrucciones', 'instructions', 'library', 'biblioteca'], more: true },
  { id: 'sessions', href: '/sessions', labelKey: 'nav.sessions', descKey: 'hc.sessions', keywords: ['sesiones', 'sessions', 'historial', 'history', 'conversaciones', 'conversations', 'transcripciones'], more: true },
];

export const MENU_IDS: SectionId[] = SECTIONS.filter((s) => !s.more).map((s) => s.id);
export const MORE_IDS: SectionId[] = SECTIONS.filter((s) => s.more).map((s) => s.id);
/** The ten entries of the menu before Home, and where each lives now: still in the menu, or in Home and the palette. */
export const MIGRATION: { id: SectionId; now: 'menu' | 'home' }[] = [
  { id: 'chat', now: 'menu' }, { id: 'colony', now: 'menu' }, { id: 'resources', now: 'menu' }, { id: 'agents', now: 'menu' },
  { id: 'relations', now: 'home' }, { id: 'connections', now: 'home' }, { id: 'schedules', now: 'menu' },
  { id: 'types', now: 'home' }, { id: 'skills', now: 'home' }, { id: 'sessions', now: 'home' },
];
export const sectionById = (id: SectionId): Section => SECTIONS.find((s) => s.id === id)!;

export type HomeGroup = 'work' | 'operate' | 'library';
/** The cards of Home, by group and in reading order: every screen but Home itself. */
export const HOME_GROUPS: { id: HomeGroup; ids: SectionId[] }[] = [
  { id: 'work', ids: ['chat', 'agents', 'colony', 'relations'] },
  { id: 'operate', ids: ['resources', 'schedules', 'connections'] },
  { id: 'library', ids: ['types', 'skills', 'sessions'] },
];
