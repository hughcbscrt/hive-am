import type { MessageKey } from './i18n/en';

/*
 * When a global shortcut fires, in one pure function (no DOM), so `server/scripts/test-web-hotkeys.ts` checks every case.
 * `Mod` is Ctrl, or ⌘ on a Mac (where Ctrl is never accepted: it belongs to the terminal and readline).
 */

export type HotkeyId = 'palette' | 'help' | 'rail' | 'unread';
/** The parts of a KeyboardEvent the rules read. */
export interface KeyInfo { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; repeat: boolean; isComposing: boolean; defaultPrevented: boolean }
export interface KeyEnv {
  mac: boolean;
  /** The focus is in an input, textarea, select, contenteditable or combobox. */
  inField: boolean;
  /** The focus is inside `[data-hotkeys="own"]` (xterm, the Markdown, code and query editors): their keys are theirs. */
  inOwn: boolean;
  /** Layers open (`dialogDepth()`). */
  layers: number;
  /** The open layer is the command palette. */
  paletteOpen: boolean;
  /** A `[role="menu"]` is open. */
  menuOpen: boolean;
}

const MOD_KEYS: Record<string, HotkeyId> = { k: 'palette', b: 'rail', '.': 'unread' };
const MOD_CODES: Record<string, HotkeyId> = { KeyK: 'palette', KeyB: 'rail', Period: 'unread' };

export function matchHotkey(e: KeyInfo, env: KeyEnv): HotkeyId | null {
  if (e.isComposing || e.repeat || e.altKey || e.defaultPrevented) return null;
  if (e.key === '?') {
    if (e.ctrlKey || e.metaKey) return null;
    return env.inField || env.inOwn || env.layers > 0 || env.menuOpen ? null : 'help';
  }
  const mod = env.mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod || e.shiftKey) return null;
  // The letter as typed. The physical key counts only on layouts that type no ASCII there (Cyrillic, Greek):
  // on Dvorak or Colemak, Ctrl+X sits on the B key and Ctrl+V on the period, and those are cut and paste.
  const id = /^[\x20-\x7e]$/.test(e.key) ? MOD_KEYS[e.key.toLowerCase()] : e.code ? MOD_CODES[e.code] : undefined;
  if (!id || env.inOwn) return null;
  if (env.layers > 0) return id === 'palette' && env.paletteOpen ? 'palette' : null;
  return id;
}

export const isMacPlatform = (platform: string | undefined): boolean => /mac|iphone|ipad|ipod/i.test(platform ?? '');

/** A key of the shortcuts sheet: `Mod` is shown as Ctrl or ⌘; the rest as written. */
export type KeyCap = 'Mod' | 'Ctrl' | 'Esc' | 'Enter' | string;
export interface HotkeyDef { id: string; keys: KeyCap[]; label: MessageKey; group: 'anywhere' | 'outside' | 'existing' }
/** Every shortcut, as the sheet and the palette show them. */
export const HOTKEYS: HotkeyDef[] = [
  { id: 'palette', keys: ['Mod', 'K'], label: 'keys.open', group: 'anywhere' },
  { id: 'rail', keys: ['Mod', 'B'], label: 'keys.rail', group: 'anywhere' },
  { id: 'unread', keys: ['Mod', '.'], label: 'keys.unread', group: 'anywhere' },
  { id: 'help', keys: ['?'], label: 'keys.help', group: 'outside' },
  { id: 'terminal', keys: ['Ctrl', '`'], label: 'keys.terminal', group: 'existing' },
  { id: 'close', keys: ['Esc'], label: 'keys.close', group: 'existing' },
  { id: 'send', keys: ['Mod', 'Enter'], label: 'keys.send', group: 'existing' },
];

/** How a combination reads on screen (`Ctrl K`, `⌘ K`). */
export const keysText = (keys: KeyCap[], mac: boolean): string => keys.map((k) => (k === 'Mod' ? (mac ? '⌘' : 'Ctrl') : k)).join(' ');
