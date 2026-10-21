// Rules of the web's unread notices (web/lib/attentionRules.ts): when a turn leaves one, pruning, badge, title and dots. No model, no server.
// Usage: HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-web-attention.ts
import './_guard.js';
import {
  MAX_AGE_MS, SNIPPET_MAX, addNotice, badgeOf, dotState, markAll, markRead, orderedNotices, pruneUnread, shouldPrune, shouldRecord, snippetOf, tabTitle, turnEnd,
  type TurnLike, type Unread,
} from '../../web/lib/attentionRules.ts';
let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); if (!ok) fail++; };

const NOW = 1_800_000_000_000;
const turn = (over: Partial<TurnLike> = {}): TurnLike => ({ source: 'user', blocks: [{ type: 'text', text: 'All done.' }], ...over });

// turnEnd: the same condition that bumps `finished` in the store
eq('turnEnd: idle with a live turn is done', turnEnd('a', turn(), 'idle', false, NOW), { agentId: 'a', kind: 'done', source: 'user', at: NOW, snippet: 'All done.' });
eq('turnEnd: error with a live turn is error', turnEnd('a', turn({ error: 'boom' }), 'error', false, NOW)?.kind, 'error');
eq('turnEnd: no live turn, nothing', turnEnd('a', undefined, 'idle', false, NOW), null);
eq('turnEnd: running is not an end', turnEnd('a', turn(), 'running', false, NOW), null);
eq('turnEnd: silent (clearLive) is not an end', turnEnd('a', turn({ error: 'boom' }), 'idle', true, NOW), null);
eq('turnEnd: keeps the source', turnEnd('a', turn({ source: 'dispatch' }), 'idle', false, NOW)?.source, 'dispatch');
eq('turnEnd: an idle end does not use the error as excerpt', turnEnd('a', turn({ error: 'old' }), 'idle', false, NOW)?.snippet, 'All done.');

// shouldRecord
const end = (kind: 'done' | 'error', source: 'user' | 'dispatch') => ({ agentId: 'a', kind, source, at: NOW, snippet: '' });
eq('shouldRecord: seen, no', shouldRecord(end('done', 'user'), true), false);
eq('shouldRecord: seen error, no', shouldRecord(end('error', 'user'), true), false);
eq('shouldRecord: delegated and fine, no', shouldRecord(end('done', 'dispatch'), false), false);
eq('shouldRecord: delegated and failed, yes', shouldRecord(end('error', 'dispatch'), false), true);
eq('shouldRecord: own turn not seen, yes', shouldRecord(end('done', 'user'), false), true);

// addNotice: one per agent
let u: Unread = {};
u = addNotice(u, { ...end('done', 'user'), agentId: 'a', at: NOW - 10 });
u = addNotice(u, { ...end('error', 'user'), agentId: 'a', at: NOW, snippet: 'again' });
eq('addNotice: a second notice replaces the first', u, { a: { kind: 'error', at: NOW, snippet: 'again' } });
u = addNotice(addNotice(u, { ...end('done', 'user'), agentId: 'b' }), { ...end('done', 'user'), agentId: 'c' });
eq('addNotice: three agents, three notices', Object.keys(u).length, 3);
eq('markRead drops one', Object.keys(markRead(u, 'b')).sort(), ['a', 'c']);
eq('markRead of an unknown id keeps the same object', markRead(u, 'zz') === u, true);
eq('markAll empties', markAll(), {});
eq('orderedNotices: most recent first', orderedNotices({ x: { kind: 'done', at: 1, snippet: '' }, y: { kind: 'done', at: 3, snippet: '' }, z: { kind: 'done', at: 2, snippet: '' } }).map((n) => n.id), ['y', 'z', 'x']);

// pruneUnread
const ids = new Set(['a', 'b']);
eq('prune: an agent that no longer exists goes', Object.keys(pruneUnread({ a: { kind: 'done', at: NOW, snippet: '' }, gone: { kind: 'done', at: NOW, snippet: '' } }, ids, NOW)), ['a']);
eq('prune: exactly 7 days stays', Object.keys(pruneUnread({ a: { kind: 'done', at: NOW - MAX_AGE_MS, snippet: '' } }, ids, NOW)), ['a']);
eq('prune: 7 days and 1 ms goes', Object.keys(pruneUnread({ a: { kind: 'done', at: NOW - MAX_AGE_MS - 1, snippet: '' } }, ids, NOW)), []);
const many: Unread = {}; const all = new Set<string>();
for (let i = 0; i < 120; i++) { many[`g${i}`] = { kind: 'done', at: NOW - i * 1000, snippet: '' }; all.add(`g${i}`); }
const kept = pruneUnread(many, all, NOW);
eq('prune: 120 notices keep 100', Object.keys(kept).length, 100);
eq('prune: the 100 most recent are kept', Object.keys(kept).includes('g99') && !Object.keys(kept).includes('g100'), true);
eq('prune: nothing to drop keeps the same object', pruneUnread(kept, all, NOW) === kept, true);
eq('prune guard: not while the agents are loading', shouldPrune(false), false);
eq('prune guard: once they loaded', shouldPrune(true), true);

// snippetOf
eq('snippet: the last text block', snippetOf([{ type: 'text', text: 'first' }, { type: 'tool', id: '1', name: 'Read', input: {} }, { type: 'text', text: 'last' }]), 'last');
eq('snippet: whitespace collapsed', snippetOf([{ type: 'text', text: '  two\n\nlines\there  ' }]), 'two lines here');
const long = 'x'.repeat(SNIPPET_MAX + 1);
eq('snippet: 141 code points become 139 and an ellipsis', [Array.from(snippetOf([{ type: 'text', text: long }])).length, snippetOf([{ type: 'text', text: long }]).endsWith('…')], [SNIPPET_MAX, true]);
eq('snippet: exactly 140 stays whole', snippetOf([{ type: 'text', text: 'y'.repeat(SNIPPET_MAX) }]), 'y'.repeat(SNIPPET_MAX));
eq('snippet: an error uses its message', snippetOf([{ type: 'text', text: 'partial' }], 'The CLI failed'), 'The CLI failed');
eq('snippet: no text is empty', snippetOf([{ type: 'thinking', text: 'hmm' }]), '');
const emoji = '🐝'.repeat(SNIPPET_MAX + 5);
const cut = snippetOf([{ type: 'text', text: emoji }]);
eq('snippet: an emoji is never split', [Array.from(cut).length, Array.from(cut).slice(0, -1).every((c) => c === '🐝')], [SNIPPET_MAX, true]);

// badgeOf and tabTitle
const n = (k: number, kind: 'done' | 'error' = 'done'): Unread => Object.fromEntries(Array.from({ length: k }, (_, i) => [`n${i}`, { kind, at: NOW, snippet: '' }]));
eq('badge: none at 0', badgeOf({}), { count: 0, text: '0', tone: null });
eq('title: 0 is just hive-am', tabTitle(0), 'hive-am');
eq('title: 1', tabTitle(1), '(1) hive-am');
eq('badge: 99 says 99', badgeOf(n(99)).text, '99');
eq('badge: 100 says 99+', badgeOf(n(100)).text, '99+');
eq('title: 100 says 99+', tabTitle(100), '(99+) hive-am');
eq('badge: all done is ok', badgeOf(n(3)).tone, 'ok');
eq('badge: one error makes it err', badgeOf({ ...n(3), e: { kind: 'error', at: NOW, snippet: '' } }).tone, 'err');

// dotState
const done = { kind: 'done' as const, at: NOW, snippet: '' }, failed = { kind: 'error' as const, at: NOW, snippet: '' };
eq('dot: running beats an error notice', dotState('running', failed), 'running');
eq('dot: running beats an unread one', dotState('running', done), 'running');
eq('dot: error status beats unread', dotState('error', done), 'err');
eq('dot: error notice on an idle agent', dotState('idle', failed), 'err');
eq('dot: done and idle is unread', dotState('idle', done), 'unread');
eq('dot: nothing', dotState('idle'), null);

console.log(fail ? `${fail} FAILED` : 'ALL PASSED'); process.exit(fail ? 1 : 0);
