// Who may talk in an authorized group: everyone in it, or only its own members (plus the connection's people list). No model. Usage:
//   HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-chat-access.ts
import './_guard.js';
const { agents } = await import('../src/db.js');
const { connections, threadMessages, threads } = await import('../src/connections/store.js');
const { handleInbound, senderOf } = await import('../src/connections/router.js');
const { FakeAdapter } = await import('../src/connections/fake.js');
const { createConnection, updateConnection } = await import('../src/services/connections.js');
const { HttpError } = await import('../src/http/errors.js');
import type { Inbound } from '../src/connections/types.js';

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const eq = (what: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); check(ok, ok ? what : `${what}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

const chats = [
  { id: 'old', name: 'Old shape' },
  { id: 'team', name: 'Team', mode: 'members', members: [{ id: 'ana', name: 'Ana P.' }] },
  { id: 'empty', mode: 'members', members: [] },
];
const allowed = [{ id: 'maria', name: 'María', admin: true }];

// The rule on its own.
const conn0 = connections.create({ kind: 'fake', name: 'rule', agent_id: null, allowed, config: { lang: 'en', chats } });
const msg = (userId: string, chat: string, group = true, thread?: string): Inbound => ({ externalId: 'x', externalKey: chat, userId, userName: userId, text: 'hi', place: chat, target: { chat, thread }, group });
eq('old shape: anyone in the group', senderOf(conn0, msg('luis', 'old')), { id: 'luis', name: 'luis' });
eq('restricted: a member, with the name the chat gave them', senderOf(conn0, msg('ana', 'team')), { id: 'ana', name: 'Ana P.' });
eq('restricted: a stranger is out', senderOf(conn0, msg('luis', 'team')), undefined);
eq('people list: in, with admin', senderOf(conn0, msg('maria', 'team')), allowed[0]);
eq('empty members: only the people list', [senderOf(conn0, msg('ana', 'empty')), senderOf(conn0, msg('maria', 'empty'))?.id], [undefined, 'maria']);
eq('a topic or thread is judged by its chat', [senderOf(conn0, msg('luis', 'team', true, '7')), senderOf(conn0, msg('ana', 'team', true, '7'))?.id], [undefined, 'ana']);
eq('by DM a chat member is nobody', senderOf(conn0, msg('ana', 'ana', false)), undefined);
eq('an unlisted chat stays closed', senderOf(conn0, msg('luis', 'other')), undefined);
eq('a members entry is never admin', senderOf(conn0, msg('ana', 'team'))?.admin, undefined);

// Through the router: without an agent, someone let in is told "no agent linked"; someone kept out is told how to get in.
const adapter = new FakeAdapter();
const conn = connections.create({ kind: 'fake', name: 'access', agent_id: null, allowed, config: { lang: 'en', group_mode: 'open', chats } });
await adapter.start((m) => handleInbound(conn.id, adapter, m));
const NO_AGENT = 'This connection has no agent linked.';
const member = (user: string, chat: string) => `This chat only admits the people on its list. To use me here, add your id (${user}) to this chat's members (${chat}) or to the connection's people list.`;
async function said(key: string, user: string, opts: { group?: boolean; addressed?: boolean } = { group: true }, text = 'hello') {
  adapter.sent.length = 0;
  await adapter.say(key, text, user, undefined, opts);
  return adapter.sent.map((s) => s.text);
}
const stored = (key: string) => { const t = threads.forConnection(conn.id).find((x) => x.external_key === key); return t ? threadMessages.recent(t.id).filter((r) => r.direction === 'in').map((r) => r.user_id) : []; };

eq('1. old shape: a group member gets in', await said('old', 'luis'), [NO_AGENT]);
eq('2. restricted: the member gets in', await said('team', 'ana'), [NO_AGENT]);
eq('2. restricted: a stranger who calls the agent gets the new notice with both ids', await said('team', 'luis'), [member('luis', 'team')]);
eq('2. ...only once', await said('team', 'luis'), []);
eq('2. a stranger\'s chatter gets nothing', await said('team', 'pedro', { group: true, addressed: false }), []);
check(!stored('team').includes('pedro') && !stored('team').includes('luis'), `2. strangers' messages are not stored (${JSON.stringify(stored('team'))})`);
eq('3. the people list gets in a restricted chat', await said('team', 'maria'), [NO_AGENT]);
eq('4. empty members: a stranger is out', await said('empty', 'ana'), [member('ana', 'empty')]);
eq('4. empty members: the people list is in', await said('empty', 'maria'), [NO_AGENT]);
eq('5. a chat member by DM is told as before', await said('ana', 'ana', {}), ['You don\'t have access. Ask to add your id: ana']);
eq('5. the people list by DM still works', await said('maria', 'maria', {}), [NO_AGENT]);
eq('6. another chat keeps its own mode', await said('old', 'pedro'), [NO_AGENT]);
eq('6. an unlisted chat stays closed (old notice)', await said('other', 'luis'), ['You don\'t have access. To use me here, add your id (luis) or this chat (other) to the connection.']);
eq('6. the notice is remembered per chat', await said('other', 'luis'), []);
eq('7. a stranger does not get in through a thread', await said('team:7', 'pedro'), [member('pedro', 'team')]);
eq('7. a member does', await said('team:7', 'ana'), [NO_AGENT]);
eq('/id of a stranger only gets the notice', await said('team', 'rosa', { group: true }, '/id'), [member('rosa', 'team')]);

// Admin: a chat member is never one; the people list keeps its flag. With an agent, `/new` answers without running a turn.
const agent = agents.create({ name: 'access', role: 'worker', provider: 'claude', model: '', cwd: '/tmp', permission: 'acceptEdits' });
const adapter2 = new FakeAdapter();
const conn2 = connections.create({ kind: 'fake', name: 'admins', agent_id: agent.id, allowed, config: { lang: 'en', chats } });
await adapter2.start((m) => handleInbound(conn2.id, adapter2, m));
const cmd = async (user: string, text: string) => { adapter2.sent.length = 0; await adapter2.say('team', text, user, undefined, { group: true }); return adapter2.sent.map((s) => s.text); };
eq('3. a chat member is not admin', await cmd('ana', '/new'), ['Only an admin can use /new.']);
check((await cmd('maria', '/new'))[0]?.startsWith('This wipes'), '3. the people list keeps admin (asks to confirm)');
eq('3. ...and can confirm', await cmd('maria', '/new confirm'), ['🆕 New conversation.']);

// The API: what is refused (400) and how the rest is cleaned.
async function refused(what: string, kind: 'telegram' | 'slack', chat: unknown, want: string) {
  const config = kind === 'telegram' ? { token: 'x', chats: [chat] } : { bot_token: 'x', app_token: 'y', chats: [chat] };
  try { await createConnection({ kind, name: `bad ${what}`, enabled: false, config }); check(false, `400: ${what} (accepted)`); }
  catch (e) { check(e instanceof HttpError && e.status === 400 && e.message === want, `400: ${what} (${e instanceof Error ? e.message : e})`); }
}
const BAD_ID = 'member ids must be numbers on Telegram and start with U or W on Slack';
await refused('an unknown mode', 'telegram', { id: '-100', mode: 'some' }, 'chat mode must be everyone or members');
await refused('51 members', 'telegram', { id: '-100', mode: 'members', members: Array.from({ length: 51 }, (_, i) => ({ id: String(i + 1) })) }, 'a chat can list at most 50 members');
await refused('members that are not a list', 'telegram', { id: '-100', mode: 'members', members: 'ana' }, 'a chat can list at most 50 members');
await refused('a Telegram id with letters', 'telegram', { id: '-100', mode: 'members', members: [{ id: 'abc' }] }, BAD_ID);
await refused('a negative Telegram id', 'telegram', { id: '-100', mode: 'members', members: [{ id: '-100' }] }, BAD_ID);
await refused('a Slack id without U or W', 'slack', { id: 'C1', mode: 'members', members: [{ id: 'C0123ABC' }] }, BAD_ID);
await refused('a Slack id in lowercase', 'slack', { id: 'C1', mode: 'members', members: [{ id: 'u0123abc' }] }, BAD_ID);
await refused('a Slack id with symbols', 'slack', { id: 'C1', mode: 'members', members: [{ id: 'U01-23' }] }, BAD_ID);

const tg = await createConnection({ kind: 'telegram', name: 'tg', enabled: false, config: { token: 'x', chats: [
  { id: ' -100 ', name: ' Ops ', mode: 'members', members: [{ id: ' 123 ', name: ' Ana ' }, { id: '123' }, { id: '' }, { id: '456' }] },
  { id: '-200', mode: 'everyone', members: [{ id: '789' }] },
  { id: '-300', name: 'Old' },
  { id: '-100', name: 'duplicate' },
] } });
eq('normalized: trimmed, de-duplicated, blanks dropped, everyone kept as { id, name }', tg.config.chats, [
  { id: '-100', name: 'Ops', mode: 'members', members: [{ id: '123', name: 'Ana' }, { id: '456' }] },
  { id: '-200' },
  { id: '-300', name: 'Old' },
]);
const back = connections.get(tg.id)!.config.chats;
eq('stored as returned', back, tg.config.chats);
const up = await updateConnection(tg.id, { config: { chats: [{ id: '-100', mode: 'members', members: [] }, { id: '-200' }] } });
eq('update: an empty member list stays restricted', up.config.chats, [{ id: '-100', mode: 'members', members: [] }, { id: '-200' }]);
const sl = await createConnection({ kind: 'slack', name: 'sl', enabled: false, config: { bot_token: 'x', app_token: 'y', chats: [{ id: 'C0123', mode: 'members', members: [{ id: 'U0123ABC' }, { id: 'W0ABC' }] }] } });
eq('Slack: U and W ids are accepted', sl.config.chats, [{ id: 'C0123', mode: 'members', members: [{ id: 'U0123ABC' }, { id: 'W0ABC' }] }]);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
