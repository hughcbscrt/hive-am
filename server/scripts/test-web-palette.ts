// What the web's command palette lists (web/lib/paletteRules.ts): order, filter without accents, the agent caps, hidden sections,
// "More sections" and the synonyms of web/lib/sections.ts in English and Spanish. No model, no browser.
// Usage: HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-web-palette.ts
import './_guard.js';
import { EMPTY_AGENTS, MAX_AGENTS, normalize, paletteSections, type GoTo, type PaletteAgent, type PaletteInput } from '../../web/lib/paletteRules.ts';
import { MENU_IDS, MORE_IDS, SECTIONS } from '../../web/lib/sections.ts';
import { en } from '../../web/lib/i18n/en.ts';
import { es } from '../../web/lib/i18n/es.ts';
let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); if (!ok) fail++; };

const ag = (id: string, over: Partial<PaletteAgent> = {}): PaletteAgent => ({ id, name: id, role: 'worker', description: '', provider: 'claude', model: '', status: 'idle', colony_id: null, updated_at: 0, ...over });
// The screens as the palette builds them (components/CommandPalette.tsx), with the interface in English or in Spanish.
type Dict = Record<keyof typeof en, string>;
const goToIn = (dict: Dict): GoTo[] => SECTIONS.map((s) => ({ id: s.id, label: dict[s.labelKey as keyof Dict], href: s.href, keywords: s.keywords, more: s.more }));
const goTo = goToIn(en);
const actionsIn = (dict: Dict) => [{ id: 'activity', label: dict['cmd.act.activity'] }, { id: 'jumpUnread', label: dict['cmd.act.jumpUnread'], needsUnread: true }, { id: 'markAll', label: dict['attn.markAll'], needsUnread: true }, { id: 'theme', label: dict['nav.switchTheme'] }, { id: 'shortcuts', label: dict['cmd.act.shortcuts'] }];
const actions = actionsIn(en);
const input = (over: Partial<PaletteInput> = {}): PaletteInput => ({ query: '', ready: true, agents: [], colonies: [], unread: {}, lastChat: '', goTo, actions, ...over });
const ids = (r: ReturnType<typeof paletteSections>, section: string) => r.sections.find((s) => s.id === section)?.items.map((i) => i.key) ?? null;

eq('normalize: accents and case', normalize('Ágil Ñandú'), 'agil nandu');
eq('normalize: "agil" finds "Ágil"', normalize('Revisor Ágil').includes(normalize('agil')), true);
eq('normalize: query with accents finds plain text', normalize('agil').includes(normalize('Ágil')), true);

// order with an empty query
const agents = [ag('old', { updated_at: 1 }), ag('new', { updated_at: 9 }), ag('mid', { updated_at: 5 }), ag('busy', { status: 'running', updated_at: 0 }), ag('last', { updated_at: 2 })];
const r = paletteSections(input({ agents, lastChat: 'last', unread: { mid: { kind: 'done', at: 5, snippet: '' }, old: { kind: 'error', at: 9, snippet: '' }, gone: { kind: 'done', at: 10, snippet: '' } } }));
eq('sections in order', r.sections.map((s) => s.id), ['unread', 'more', 'agents', 'screens', 'actions']);
eq('unread: most recent first, agents that no longer exist left out', ids(r, 'unread'), ['u:old', 'u:mid']);
eq('agents: working, then the last chat, then most recently active', ids(r, 'agents'), ['a:busy', 'a:last', 'a:new', 'a:mid', 'a:old']);
eq('flat list follows the sections', r.items.length, 2 + MORE_IDS.length + 5 + MENU_IDS.length + 5);
eq('with notices the unread actions show', ids(r, 'actions'), ['x:activity', 'x:jumpUnread', 'x:markAll', 'x:theme', 'x:shortcuts']);
eq('empty query: More sections holds the five out of the menu, in order', ids(r, 'more'), MORE_IDS.map((id) => `s:${id}`));
eq('empty query: More sections is Relations, Connections, Agent types, Skills and Sessions', MORE_IDS, ['relations', 'connections', 'types', 'skills', 'sessions']);
eq('empty query: Go to lists only the menu screens, no repeats', ids(r, 'screens'), MENU_IDS.map((id) => `s:${id}`));
eq('empty query: More sections comes before Agents', r.sections.findIndex((s) => s.id === 'more') < r.sections.findIndex((s) => s.id === 'agents'), true);

// no notices
const none = paletteSections(input({ agents }));
eq('no notices: no Unread section', none.sections.map((s) => s.id), ['more', 'agents', 'screens', 'actions']);
eq('no notices: jump and mark all are hidden', ids(none, 'actions'), ['x:activity', 'x:theme', 'x:shortcuts']);

// cap
const sixty = Array.from({ length: 60 }, (_, i) => ag(`a${i}`, { updated_at: i }));
const capped = paletteSections(input({ agents: sixty }));
eq('empty query, 60 agents: 5 rows', ids(capped, 'agents')?.length, EMPTY_AGENTS);
eq('empty query, 60 agents: more is set', capped.more, true);
eq('empty query, 6 agents: 5 rows and more', [ids(paletteSections(input({ agents: sixty.slice(0, 6) })), 'agents')?.length, paletteSections(input({ agents: sixty.slice(0, 6) })).more], [5, true]);
eq('empty query, 5 agents: no more', paletteSections(input({ agents: sixty.slice(0, 5) })).more, false);
eq('empty query, 27 agents: the 5 most recently active', ids(paletteSections(input({ agents: sixty.slice(0, 27) })), 'agents'), ['a:a26', 'a:a25', 'a:a24', 'a:a23', 'a:a22']);
const typed = paletteSections(input({ agents: sixty, query: 'a' }));
eq('query, 60 agents: 50 rows', ids(typed, 'agents')?.length, MAX_AGENTS);
eq('query, 60 agents: more is set', typed.more, true);
eq('query, 50 agents: no more', paletteSections(input({ agents: sixty.slice(0, 50), query: 'a' })).more, false);
eq('query: no More sections, the five go back to Go to', paletteSections(input({ query: 's' })).sections.some((s) => s.id === 'more'), false);
const many = Array.from({ length: 200 }, (_, i) => ag(`agent${i}`, { name: `Agent ${i}`, description: i % 2 ? 'reviews code' : 'writes docs' }));
const t0 = performance.now();
const filtered = paletteSections(input({ agents: many, query: 'Agent 19' }));
const ms = performance.now() - t0;
eq('200 agents filtered: Agent 19 and 190 to 199', ids(filtered, 'agents')?.length, 11);
eq('200 agents filtered: fast', ms < 50, true);
eq('200 agents, broad filter: still capped with more', [ids(paletteSections(input({ agents: many, query: 'docs' })), 'agents')?.length, paletteSections(input({ agents: many, query: 'docs' })).more], [50, true]);

// filter fields
const fields = [ag('r', { name: 'Revisor', colony_id: 'c1' }), ag('k', { name: 'Kiro helper', provider: 'kiro' }), ag('m', { name: 'Modeler', model: 'claude-sonnet-5-5' }), ag('d', { name: 'Docs', description: 'Escribe la documentación' })];
const cols = [{ id: 'c1', name: 'Equipo Ágil' }];
eq('filter: by colony, without accents', ids(paletteSections(input({ agents: fields, colonies: cols, query: 'agil' })), 'agents'), ['a:r']);
eq('filter: by provider id', ids(paletteSections(input({ agents: fields, query: 'kiro' })), 'agents'), ['a:k']);
eq('filter: by provider name', ids(paletteSections(input({ agents: fields, query: 'claude code', providerNames: { claude: 'Claude Code' } })), 'agents'), ['a:r', 'a:m', 'a:d']);
eq('filter: by model', ids(paletteSections(input({ agents: fields, query: 'sonnet' })), 'agents'), ['a:m']);
eq('filter: by description, without accents', ids(paletteSections(input({ agents: fields, query: 'documentacion' })), 'agents'), ['a:d']);
eq('filter: case does not matter', ids(paletteSections(input({ agents: fields, query: 'REVISOR' })), 'agents'), ['a:r']);
eq('filter: screens and actions too', [ids(paletteSections(input({ query: 'sess' })), 'screens'), ids(paletteSections(input({ query: 'theme' })), 'actions')], [['s:sessions'], ['x:theme']]);
eq('filter: empty sections are hidden', paletteSections(input({ agents: fields, query: 'revisor' })).sections.map((s) => s.id), ['agents']);
eq('filter: nothing matches', paletteSections(input({ agents: fields, query: 'zzz' })).items.length, 0);
eq('filter: unread follows the query', ids(paletteSections(input({ agents: fields, query: 'docs', unread: { d: { kind: 'done', at: 1, snippet: '' }, r: { kind: 'done', at: 2, snippet: '' } } })), 'unread'), ['u:d']);

// loading
const loading = paletteSections(input({ ready: false, agents: fields, unread: { r: { kind: 'done', at: 1, snippet: '' } } }));
eq('loading: no agents, only the screens and Actions', loading.sections.map((s) => s.id), ['more', 'screens', 'actions']);
eq('loading, with a query: no agents', paletteSections(input({ ready: false, agents: fields, query: 'revisor' })).items.length, 0);

// synonyms: each of the five is the first screen for its Spanish name, its English name and its keywords, in either interface language
const label = (dict: Dict, id: string) => dict[SECTIONS.find((s) => s.id === id)!.labelKey as keyof Dict];
for (const [lang, dict] of [['en', en], ['es', es]] as const) {
  for (const id of MORE_IDS) {
    for (const query of [label(es, id), label(en, id), ...SECTIONS.find((s) => s.id === id)!.keywords]) {
      eq(`${lang} interface: "${query}" finds ${id} first`, ids(paletteSections(input({ query, goTo: goToIn(dict), actions: actionsIn(dict) })), 'screens')?.[0], `s:${id}`);
    }
  }
  // the searches of the design, with Enter on the first screen
  const searches: [string, string][] = [['skills', 'skills'], ['sesiones', 'sessions'], ['sessions', 'sessions'], ['conexiones', 'connections'], ['telegram', 'connections'], ['tipos', 'types'], ['types', 'types'], ['relaciones', 'relations'], ['grafo', 'relations'], ['habilidades', 'skills'], ['historial', 'sessions']];
  for (const [query, id] of searches) eq(`${lang} interface: design search "${query}" opens ${id}`, paletteSections(input({ query, goTo: goToIn(dict) })).sections.find((s) => s.id === 'screens')?.items[0]?.key, `s:${id}`);
  // with text, every screen is in Go to
  for (const s of SECTIONS) eq(`${lang} interface: its own name finds ${s.id}`, ids(paletteSections(input({ query: label(dict, s.id), goTo: goToIn(dict) })), 'screens')?.includes(`s:${s.id}`), true);
}
const via = (query: string, dict: Dict) => { const i = paletteSections(input({ query, goTo: goToIn(dict) })).sections.find((s) => s.id === 'screens')?.items[0]; return i?.kind === 'screen' ? i.via ?? null : 'none'; };
eq('via: the keyword that matched shows', via('telegram', es), 'telegram');
eq('via: a partial keyword shows whole', via('teleg', en), 'telegram');
eq('via: not when the label matched', [via('conexiones', es), via('connections', en)], [null, null]);
eq('via: the other language is a keyword', [via('conexiones', en), via('sessions', es)], ['conexiones', 'sessions']);
eq('via: a screen found by name goes before one found by keyword', ids(paletteSections(input({ query: 'tipos', goTo: goToIn(es) })), 'screens'), ['s:types']);
eq('via: never with an empty query', paletteSections(input({})).items.some((i) => i.kind === 'screen' && i.via !== undefined), false);
// the Keyboard shortcuts action, by its label in each language
for (const [query, dict] of [['shortcuts', en], ['keyboard', en], ['atajos', es], ['teclado', es]] as const) eq(`action: "${query}" finds Keyboard shortcuts`, ids(paletteSections(input({ query, actions: actionsIn(dict) })), 'actions'), ['x:shortcuts']);
console.log(fail ? `${fail} FAILED` : 'ALL PASSED'); process.exit(fail ? 1 : 0);
