// What the web's Home page shows (web/lib/homeModel.ts) and where every screen lives (web/lib/sections.ts): state, the "Now"
// pills, the three groups of cards and their numbers, with 0, 1 and many agents. No model, no browser.
// Usage: HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-web-home.ts
import './_guard.js';
import { homeModel, type HomeInput, type HomeView } from '../../web/lib/homeModel.ts';
import { HOME_GROUPS, SECTIONS } from '../../web/lib/sections.ts';
let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); if (!ok) fail++; };

type Status = HomeInput['agents'][number]['status'];
const ag = (id: string, status: Status = 'idle') => ({ id, name: `Agent ${id}`, status });
const conn = (state: 'connecting' | 'connected' | 'error' | 'stopped') => ({ status: { state } }) as HomeInput['connections'][number];
const input = (over: Partial<HomeInput> = {}): HomeInput => ({ ready: true, error: null, agents: [], types: [], skills: [], colonies: [], connections: [], objects: [], dispatches: [], unreadCount: 0, lastChat: '', ...over });
const card = (v: HomeView, id: string) => v.groups.flatMap((g) => g.cards).find((c) => c.id === id);
const cardIds = (v: HomeView) => v.groups.map((g) => [g.id, g.cards.map((c) => c.id)]);

// groups
const zero = homeModel(input());
eq('groups: Work, Operate, Library and history with 4, 3 and 3 cards', cardIds(zero), [['work', ['chat', 'agents', 'colony', 'relations']], ['operate', ['resources', 'schedules', 'connections']], ['library', ['types', 'skills', 'sessions']]]);
eq('groups: ten cards, each screen once', zero.groups.flatMap((g) => g.cards.map((c) => c.id)).sort(), SECTIONS.map((s) => s.id).filter((id) => HOME_GROUPS.some((g) => g.ids.includes(id))).sort());
eq('groups: every card links to its screen', zero.groups.flatMap((g) => g.cards).filter((c) => c.id !== 'chat').every((c) => c.href === SECTIONS.find((s) => s.id === c.id)!.href), true);

// states
eq('state: loading while the store has not answered', homeModel(input({ ready: false })).state, 'loading');
eq('state: error wins over loading', homeModel(input({ ready: false, error: 'boom' })).state, 'error');
eq('state: error after a load too', homeModel(input({ error: 'boom', agents: [ag('a')] })).state, 'error');
eq('state: empty with no agents', zero.state, 'empty');
eq('state: ready with one agent', homeModel(input({ agents: [ag('a')] })).state, 'ready');
for (const [name, v] of [['loading', homeModel(input({ ready: false }))], ['error', homeModel(input({ error: 'boom', agents: [ag('a')], types: [1], unreadCount: 2 }))]] as const) {
  eq(`${name}: no Now strip and no quiet line`, [v.pills, v.quiet], [[], false]);
  eq(`${name}: the ten cards still link, without numbers`, v.groups.flatMap((g) => g.cards).map((c) => [Boolean(c.href), c.count ?? null, c.last ?? null, c.errors ?? null]), Array.from({ length: 10 }, () => [true, null, null, null]));
}

// 0 agents
eq('0 agents: quiet line, no pills', [zero.pills, zero.quiet], [[], true]);
eq('0 agents: totals are 0, Colony counts the colonies', ['agents', 'colony', 'resources', 'connections', 'types', 'skills'].map((id) => [card(zero, id)?.count, card(zero, id)?.countKind]), [[0, 'total'], [0, 'colonies'], [0, 'total'], [0, 'total'], [0, 'total'], [0, 'total']]);
eq('0 agents: Chat goes to the chat home, with no last chat', [card(zero, 'chat')?.href, card(zero, 'chat')?.last], ['/chat', undefined]);
eq('no number where the client has none: Relations, Schedules, Sessions', ['relations', 'schedules', 'sessions'].map((id) => card(zero, id)?.count ?? null), [null, null, null]);

// 1 agent
const one = homeModel(input({ agents: [ag('solo')], lastChat: 'solo', colonies: [{}] }));
eq('1 agent: Chat names the last chat', [card(one, 'chat')?.href, card(one, 'chat')?.last], ['/agents/solo', 'Agent solo']);
eq('1 agent: Agents is 1, Colony shows the one colony', [card(one, 'agents')?.count, card(one, 'colony')?.count, card(one, 'colony')?.countKind], [1, 1, 'colonies']);
eq('1 agent, idle: quiet', one.quiet, true);
eq('last chat gone: Chat goes to the first agent, no name', [card(homeModel(input({ agents: [ag('x')], lastChat: 'gone' })), 'chat')?.href, card(homeModel(input({ agents: [ag('x')], lastChat: 'gone' })), 'chat')?.last], ['/agents/x', undefined]);

// many agents
const many = Array.from({ length: 27 }, (_, i) => ag(`a${i}`, i < 3 ? 'running' : i === 3 ? 'error' : 'idle'));
const busy = homeModel(input({
  agents: many, types: [1, 2], skills: [1, 2, 3, 4], colonies: [1, 2], objects: [1, 2, 3],
  connections: [conn('connected'), conn('error'), conn('connecting'), conn('error')],
  dispatches: [{ status: 'queued' }, { status: 'running' }, { status: 'done' }, { status: 'failed' }, { status: 'interrupted' }],
  unreadCount: 3, lastChat: 'a5',
}));
eq('27 agents: ready', busy.state, 'ready');
eq('27 agents: pills in order with their numbers', busy.pills.map((p) => [p.id, p.count, p.href ?? null]), [['running', 3, '/agents'], ['unread', 3, null], ['tasks', 2, '#recent'], ['errors', 2, '/connections']]);
eq('27 agents: not quiet', busy.quiet, false);
eq('27 agents: Colony shows the agents working', [card(busy, 'colony')?.count, card(busy, 'colony')?.countKind], [3, 'working']);
eq('27 agents: totals', ['agents', 'resources', 'connections', 'types', 'skills'].map((id) => card(busy, id)?.count), [27, 3, 4, 2, 4]);
eq('27 agents: Connections carries its errors', card(busy, 'connections')?.errors, 2);
eq('27 agents: Chat names the last chat', card(busy, 'chat')?.last, 'Agent a5');

// pills only above 0
eq('pills: only unread', homeModel(input({ agents: [ag('a')], unreadCount: 1 })).pills.map((p) => p.id), ['unread']);
eq('pills: only a delegation in progress', homeModel(input({ agents: [ag('a')], dispatches: [{ status: 'running' }, { status: 'done' }] })).pills.map((p) => [p.id, p.count]), [['tasks', 1]]);
eq('pills: only a connection error, with no agents', homeModel(input({ connections: [conn('error')] })).pills.map((p) => p.id), ['errors']);
eq('pills: stopped and connecting are not errors', homeModel(input({ connections: [conn('stopped'), conn('connecting')] })).pills, []);
eq('Connections with no error carries none', card(homeModel(input({ connections: [conn('connected')] })), 'connections')?.errors, undefined);
console.log(fail ? `${fail} FAILED` : 'ALL PASSED'); process.exit(fail ? 1 : 0);
