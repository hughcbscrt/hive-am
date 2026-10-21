// What the web's command palette lists (web/lib/paletteRules.ts): order, filter without accents, the 50-row cap, hidden sections. No model, no browser.
// Usage: HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-web-palette.ts
import './_guard.js';
import { MAX_AGENTS, normalize, paletteSections, type PaletteAgent, type PaletteInput } from '../../web/lib/paletteRules.ts';
let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); if (!ok) fail++; };

const ag = (id: string, over: Partial<PaletteAgent> = {}): PaletteAgent => ({ id, name: id, role: 'worker', description: '', provider: 'claude', model: '', status: 'idle', colony_id: null, updated_at: 0, ...over });
const goTo = [{ id: 'chat', label: 'Chat', href: '/chat' }, { id: 'colony', label: 'Colony', href: '/' }, { id: 'sessions', label: 'Sessions', href: '/sessions' }];
const actions = [{ id: 'activity', label: 'Show activity' }, { id: 'jumpUnread', label: 'Jump to latest unread', needsUnread: true }, { id: 'markAll', label: 'Mark all as read', needsUnread: true }, { id: 'theme', label: 'Switch theme' }];
const input = (over: Partial<PaletteInput> = {}): PaletteInput => ({ query: '', ready: true, agents: [], colonies: [], unread: {}, lastChat: '', goTo, actions, ...over });
const ids = (r: ReturnType<typeof paletteSections>, section: string) => r.sections.find((s) => s.id === section)?.items.map((i) => i.key) ?? null;

eq('normalize: accents and case', normalize('Ágil Ñandú'), 'agil nandu');
eq('normalize: "agil" finds "Ágil"', normalize('Revisor Ágil').includes(normalize('agil')), true);
eq('normalize: query with accents finds plain text', normalize('agil').includes(normalize('Ágil')), true);

// order with an empty query
const agents = [ag('old', { updated_at: 1 }), ag('new', { updated_at: 9 }), ag('mid', { updated_at: 5 }), ag('busy', { status: 'running', updated_at: 0 }), ag('last', { updated_at: 2 })];
const r = paletteSections(input({ agents, lastChat: 'last', unread: { mid: { kind: 'done', at: 5, snippet: '' }, old: { kind: 'error', at: 9, snippet: '' }, gone: { kind: 'done', at: 10, snippet: '' } } }));
eq('sections in order', r.sections.map((s) => s.id), ['unread', 'agents', 'screens', 'actions']);
eq('unread: most recent first, agents that no longer exist left out', ids(r, 'unread'), ['u:old', 'u:mid']);
eq('agents: working, then the last chat, then most recently active', ids(r, 'agents'), ['a:busy', 'a:last', 'a:new', 'a:mid', 'a:old']);
eq('flat list follows the sections', r.items.length, 2 + 5 + 3 + 4);
eq('with notices the unread actions show', ids(r, 'actions'), ['x:activity', 'x:jumpUnread', 'x:markAll', 'x:theme']);

// no notices
const none = paletteSections(input({ agents }));
eq('no notices: no Unread section', none.sections.map((s) => s.id), ['agents', 'screens', 'actions']);
eq('no notices: jump and mark all are hidden', ids(none, 'actions'), ['x:activity', 'x:theme']);

// cap
const sixty = Array.from({ length: 60 }, (_, i) => ag(`a${i}`, { updated_at: i }));
const capped = paletteSections(input({ agents: sixty }));
eq('60 agents: 50 rows', ids(capped, 'agents')?.length, MAX_AGENTS);
eq('60 agents: more is set', capped.more, true);
eq('50 agents: no more', paletteSections(input({ agents: sixty.slice(0, 50) })).more, false);
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
eq('loading: only Go to and Actions', loading.sections.map((s) => s.id), ['screens', 'actions']);
console.log(fail ? `${fail} FAILED` : 'ALL PASSED'); process.exit(fail ? 1 : 0);
