// When the web's global shortcuts fire (web/lib/hotkeyRules.ts): Mod K / B / . and `?`, on Linux and on a Mac. No model, no browser.
// Usage: HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-web-hotkeys.ts
import './_guard.js';
import { isMacPlatform, keysText, matchHotkey, type KeyEnv, type KeyInfo } from '../../web/lib/hotkeyRules.ts';
let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); if (!ok) fail++; };

const key = (k: string, over: Partial<KeyInfo> = {}): KeyInfo => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, defaultPrevented: false, ...over });
const env = (over: Partial<KeyEnv> = {}): KeyEnv => ({ mac: false, inField: false, inOwn: false, layers: 0, paletteOpen: false, menuOpen: false, ...over });
const ctrl = (k: string, over: Partial<KeyInfo> = {}) => key(k, { ctrlKey: true, ...over });
const meta = (k: string, over: Partial<KeyInfo> = {}) => key(k, { metaKey: true, ...over });

// Linux and Windows: Ctrl
eq('linux: Ctrl+K opens the palette', matchHotkey(ctrl('k'), env()), 'palette');
eq('linux: Ctrl+B folds the rail', matchHotkey(ctrl('b'), env()), 'rail');
eq('linux: Ctrl+. jumps to the latest unread', matchHotkey(ctrl('.'), env()), 'unread');
eq('linux: Ctrl+K with caps lock (K)', matchHotkey(ctrl('K'), env()), 'palette');
eq('linux: another layout, physical key K', matchHotkey(ctrl('л', { code: 'KeyK' }), env()), 'palette');
eq('linux: Meta+K is nothing', matchHotkey(meta('k'), env()), null);
eq('linux: Ctrl+Meta+K is nothing', matchHotkey(ctrl('k', { metaKey: true }), env()), null);
eq('linux: Ctrl+Shift+K is nothing (Firefox console)', matchHotkey(ctrl('K', { shiftKey: true }), env()), null);
eq('linux: Ctrl+J is not ours', matchHotkey(ctrl('j'), env()), null);
eq('linux: plain K is nothing', matchHotkey(key('k'), env()), null);
// Mac: only ⌘
eq('mac: ⌘K opens the palette', matchHotkey(meta('k'), env({ mac: true })), 'palette');
eq('mac: ⌘B folds the rail', matchHotkey(meta('b'), env({ mac: true })), 'rail');
eq('mac: ⌘. jumps to the latest unread', matchHotkey(meta('.'), env({ mac: true })), 'unread');
eq('mac: Ctrl+K is nothing', matchHotkey(ctrl('k'), env({ mac: true })), null);
eq('mac: Ctrl+⌘+K is nothing', matchHotkey(meta('k', { ctrlKey: true }), env({ mac: true })), null);
eq('mac: ⌘⇧K is nothing', matchHotkey(meta('K', { shiftKey: true }), env({ mac: true })), null);
// `?`
eq('?: with Shift opens the sheet', matchHotkey(key('?', { shiftKey: true }), env()), 'help');
eq('?: without Shift (a layout with its own key) too', matchHotkey(key('?'), env()), 'help');
eq('?: with Ctrl is nothing', matchHotkey(ctrl('?', { shiftKey: true }), env()), null);
eq('?: with Meta is nothing', matchHotkey(meta('?', { shiftKey: true }), env({ mac: true })), null);
// always ignored
for (const [name, over] of [['isComposing', { isComposing: true }], ['repeat', { repeat: true }], ['altKey', { altKey: true }], ['defaultPrevented', { defaultPrevented: true }]] as const) {
  eq(`ignored with ${name}: Mod K`, matchHotkey(ctrl('k', over), env()), null);
  eq(`ignored with ${name}: ?`, matchHotkey(key('?', { shiftKey: true, ...over }), env()), null);
}
// where the focus is
eq('own (xterm, editors): Mod K is theirs', matchHotkey(ctrl('k'), env({ inOwn: true, inField: true })), null);
eq('own: Mod B is theirs', matchHotkey(ctrl('b'), env({ inOwn: true, inField: true })), null);
eq('own: Mod . is theirs', matchHotkey(ctrl('.'), env({ inOwn: true })), null);
eq('own: ? is typed', matchHotkey(key('?', { shiftKey: true }), env({ inOwn: true })), null);
eq('text field: Mod K works', matchHotkey(ctrl('k'), env({ inField: true })), 'palette');
eq('text field: Mod B works', matchHotkey(ctrl('b'), env({ inField: true })), 'rail');
eq('text field: Mod . works', matchHotkey(ctrl('.'), env({ inField: true })), 'unread');
eq('text field: ? is typed', matchHotkey(key('?', { shiftKey: true }), env({ inField: true })), null);
eq('combobox: ? is typed', matchHotkey(key('?', { shiftKey: true }), env({ inField: true })), null);
// layers and menus
eq('a dialog open: Mod B does nothing', matchHotkey(ctrl('b'), env({ layers: 1 })), null);
eq('a dialog open: Mod . does nothing', matchHotkey(ctrl('.'), env({ layers: 1 })), null);
eq('a dialog open: Mod K does nothing', matchHotkey(ctrl('k'), env({ layers: 1 })), null);
eq('the palette open: Mod K closes it', matchHotkey(ctrl('k'), env({ layers: 1, paletteOpen: true, inField: true })), 'palette');
eq('the palette open: Mod B does nothing', matchHotkey(ctrl('b'), env({ layers: 1, paletteOpen: true, inField: true })), null);
eq('a dialog open: ? does nothing', matchHotkey(key('?', { shiftKey: true }), env({ layers: 1 })), null);
eq('a menu open: ? does nothing', matchHotkey(key('?', { shiftKey: true }), env({ menuOpen: true })), null);
// `/` stays free for the git explorer
eq('/ is never ours', matchHotkey(key('/'), env()), null);
eq('Ctrl+/ is never ours', matchHotkey(ctrl('/'), env()), null);
eq('Ctrl+` is the dock\'s, not ours', matchHotkey(ctrl('`'), env()), null);
// platform and labels
eq('platform: MacIntel is a Mac', isMacPlatform('MacIntel'), true);
eq('platform: macOS (userAgentData) is a Mac', isMacPlatform('macOS'), true);
eq('platform: iPad is a Mac', isMacPlatform('iPad'), true);
eq('platform: Linux x86_64 is not', isMacPlatform('Linux x86_64'), false);
eq('platform: Win32 is not', isMacPlatform('Win32'), false);
eq('platform: unknown is not', isMacPlatform(undefined), false);
eq('label: Ctrl K', keysText(['Mod', 'K'], false), 'Ctrl K');
eq('label: ⌘ K', keysText(['Mod', 'K'], true), '⌘ K');
console.log(fail ? `${fail} FAILED` : 'ALL PASSED'); process.exit(fail ? 1 : 0);
