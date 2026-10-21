import type { MessageKey } from './i18n/en';

/*
 * The screens of the web app in one place, with no React or DOM, so the scripts in `server/scripts/` load it: where each
 * lives, its name and description keys, the words that also find it in the palette (Ctrl K), and whether it sits in the
 * menu or under "More sections" (palette) and the Home cards.
 */

export type SectionId = 'chat' | 'colony' | 'resources' | 'agents' | 'schedules' | 'relations' | 'connections' | 'types' | 'skills' | 'sessions';

export interface Section {
  id: SectionId;
  /** Chat goes to the last chat opened (`lib/lastChat.ts`); this is where it lands without one. */
  href: string;
  labelKey: MessageKey;
  /** Synonyms without diacritics (the palette strips them), in English and Spanish: they find the screen in either language. */
  keywords: string[];
  /** Out of the menu: reached from Home and listed under "More sections" in the palette. */
  more: boolean;
}

/** Menu order first, then the five screens that live in Home and the palette. */
export const SECTIONS: Section[] = [
  { id: 'chat', href: '/chat', labelKey: 'nav.chat', keywords: [], more: false },
  { id: 'colony', href: '/', labelKey: 'nav.colony', keywords: [], more: false },
  { id: 'resources', href: '/resources', labelKey: 'nav.objects', keywords: [], more: false },
  { id: 'agents', href: '/agents', labelKey: 'nav.agents', keywords: [], more: false },
  { id: 'schedules', href: '/schedules', labelKey: 'nav.schedules', keywords: [], more: false },
  { id: 'relations', href: '/relations', labelKey: 'nav.relations', keywords: ['relaciones', 'relations', 'grafo', 'graph', 'orquestadores', 'orchestrators'], more: true },
  { id: 'connections', href: '/connections', labelKey: 'nav.connections', keywords: ['conexiones', 'connections', 'telegram', 'slack', 'canales', 'channels', 'bots'], more: true },
  { id: 'types', href: '/types', labelKey: 'nav.types', keywords: ['tipos de agente', 'types', 'agent types', 'tipos', 'plantillas', 'templates', 'blueprints'], more: true },
  { id: 'skills', href: '/skills', labelKey: 'nav.skills', keywords: ['skills', 'habilidades', 'instrucciones', 'instructions', 'library', 'biblioteca'], more: true },
  { id: 'sessions', href: '/sessions', labelKey: 'nav.sessions', keywords: ['sesiones', 'sessions', 'historial', 'history', 'conversaciones', 'conversations', 'transcripciones'], more: true },
];

export const MENU_IDS: SectionId[] = SECTIONS.filter((s) => !s.more).map((s) => s.id);
export const MORE_IDS: SectionId[] = SECTIONS.filter((s) => s.more).map((s) => s.id);
export const sectionById = (id: SectionId): Section => SECTIONS.find((s) => s.id === id)!;

export type HomeGroup = 'work' | 'operate' | 'library';
/** The cards of Home, by group and in reading order: every screen but Home itself. */
export const HOME_GROUPS: { id: HomeGroup; ids: SectionId[] }[] = [
  { id: 'work', ids: ['chat', 'agents', 'colony', 'relations'] },
  { id: 'operate', ids: ['resources', 'schedules', 'connections'] },
  { id: 'library', ids: ['types', 'skills', 'sessions'] },
];
