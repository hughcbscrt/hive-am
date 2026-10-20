// Who may talk in an authorized group: everyone in it, or only its own members (the connection's people list does not open it). No model. Usage:
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
  { id: 'both', mode: 'members', members: [{ id: 'maria' }, { id: 'ana' }] },
];
const allowed = [{ id: 'maria', name: 'María', admin: true }];

// The rule on its own.
const conn0 = connections.create({ kind: 'fake', name: 'rule', agent_id: null, allowed, config: { lang: 'en', chats } });
const msg = (userId: string, chat: string, group = true, thread?: string): Inbound => ({ externalId: 'x', externalKey: chat, userId, userName: userId, text: 'hi', place: chat, target: { chat, thread }, group });
eq('old shape: anyone in the group', senderOf(conn0, msg('luis', 'old')), { id: 'luis', name: 'luis' });
eq('restricted: a member, with the name the chat gave them', senderOf(conn0, msg('ana', 'team')), { id: 'ana', name: 'Ana P.' });
eq('restricted: a stranger is out', senderOf(conn0, msg('luis', 'team')), undefined);
eq('people list: out of a restricted chat', senderOf(conn0, msg('maria', 'team')), undefined);
eq('people list: in an unlisted chat, with admin', senderOf(conn0, msg('maria', 'other')), allowed[0]);
eq('people list: in an everyone chat, with admin', senderOf(conn0, msg('maria', 'old')), allowed[0]);
eq('people list: by DM, with admin', senderOf(conn0, msg('maria', 'maria', false)), allowed[0]);
eq('a member who is also in the people list keeps admin', senderOf(conn0, msg('maria', 'both')), { id: 'maria', name: 'maria', admin: true });
eq('empty members: nobody', [senderOf(conn0, msg('ana', 'empty')), senderOf(conn0, msg('maria', 'empty'))], [undefined, undefined]);
eq('a topic or thread is judged by its chat', [senderOf(conn0, msg('luis', 'team', true, '7')), senderOf(conn0, msg('ana', 'team', true, '7'))?.id], [undefined, 'ana']);
eq('by DM a chat member is nobody', senderOf(conn0, msg('ana', 'ana', false)), undefined);
eq('an unlisted chat stays closed', senderOf(conn0, msg('luis', 'other')), undefined);
eq('a members entry is never admin', senderOf(conn0, msg('ana', 'team'))?.admin, undefined);

// Through the router: without an agent, someone let in is told "no agent linked"; someone kept out is told how to get in.
const adapter = new FakeAdapter();
const conn = connections.create({ kind: 'fake', name: 'access', agent_id: null, allowed, config: { lang: 'en', group_mode: 'open', chats } });
await adapter.start((m) => handleInbound(conn.id, adapter, m));
const NO_AGENT = 'This connection has no agent linked.';
const member = (user: string, chat: string) => `This chat only admits the people on its list. To use me here, add your id (${user}) to this chat's members (${chat}).`;
async function said(key: string, user: string, opts: { group?: boolean; addressed?: boolean } = { group: true }, text = 'hello') {
  adapter.sent.length = 0;
  await adapter.say(key, text, user, undefined, opts);
  return adapter.sent.map((s) => s.text);
}
const stored = (key: string) => { const t = threads.forConnection(conn.id).find((x) => x.external_key === key); return t ? threadMessages.recent(t.id).filter((r) => r.direction === 'in').map((r) => r.user_id) : []; };

eq('1. old shape: a group member gets in', await said('old', 'luis'), [NO_AGENT]);
eq('2. restricted: the member gets in', await said('team', 'ana'), [NO_AGENT]);
eq('2. restricted: a stranger who calls the agent gets the new notice with both ids', await said('team', 'luis'), [member('luis', 'team')]);
eq('2. ...and again at the next message', await said('team', 'luis'), [member('luis', 'team')]);
eq('2. a stranger\'s chatter gets nothing', await said('team', 'pedro', { group: true, addressed: false }), []);
check(!stored('team').includes('pedro') && !stored('team').includes('luis'), `2. strangers' messages are not stored (${JSON.stringify(stored('team'))})`);
eq('3. the people list is told in a restricted chat it is not a member of', await said('team', 'maria'), [member('maria', 'team')]);
eq('3. ...but gets in where it is a member', await said('both', 'maria'), [NO_AGENT]);
eq('4. empty members: a stranger is out', await said('empty', 'ana'), [member('ana', 'empty')]);
eq('4. empty members: the people list is out too', await said('empty', 'maria'), [member('maria', 'empty')]);
eq('5. a chat member by DM is told as before', await said('ana', 'ana', {}), ['You don\'t have access. Ask to add your id: ana']);
eq('5. the people list by DM still works', await said('maria', 'maria', {}), [NO_AGENT]);
eq('6. another chat keeps its own mode', await said('old', 'pedro'), [NO_AGENT]);
eq('6. an unlisted chat stays closed (old notice)', await said('other', 'luis'), ['You don\'t have access. To use me here, add your id (luis) or this chat (other) to the connection.']);
eq('6. ...and again at the next message', await said('other', 'luis'), ['You don\'t have access. To use me here, add your id (luis) or this chat (other) to the connection.']);
eq('6. the people list still talks in an unlisted chat', await said('other', 'maria'), [NO_AGENT]);
eq('6. a DM stranger is told at every message', [await said('rosa', 'rosa', {}), await said('rosa', 'rosa', {})], [['You don\'t have access. Ask to add your id: rosa'], ['You don\'t have access. Ask to add your id: rosa']]);
eq('7. a stranger does not get in through a thread', await said('team:7', 'pedro'), [member('pedro', 'team')]);
eq('7. a member does', await said('team:7', 'ana'), [NO_AGENT]);
eq('/id of a stranger only gets the notice', await said('team', 'rosa', { group: true }, '/id'), [member('rosa', 'team')]);

// The notice limit: 5 per person and chat, 20 per chat, per minute; topics and threads share their chat's bucket.
const adapter3 = new FakeAdapter();
const conn3 = connections.create({ kind: 'fake', name: 'flood', agent_id: null, allowed, config: { lang: 'en', chats: [{ id: 'f', mode: 'members', members: [] }, { id: 'g', mode: 'members', members: [] }, { id: 'crowd', mode: 'members', members: [] }] } });
await adapter3.start((m) => handleInbound(conn3.id, adapter3, m));
const told = async (key: string, user: string) => { adapter3.sent.length = 0; await adapter3.say(key, 'hello', user, undefined, { group: true }); return adapter3.sent.length; };
let got = 0;
for (let i = 0; i < 8; i++) got += await told(i % 2 ? 'f:7' : 'f', 'luis');
eq('limit: 8 calls in a minute (chat and topic mixed) give 5 notices', got, 5);
eq('limit: another stranger in the same chat is still told', await told('f', 'pedro'), 1);
eq('limit: the same stranger in another chat is still told', await told('g', 'luis'), 1);
got = 0;
for (let i = 0; i < 21; i++) got += await told('crowd', `p${i}`);
eq('limit: at most 20 notices per chat per minute', got, 20);
check(!threads.forConnection(conn3.id).length, 'limit: nothing of the refused messages is stored');

// The texts: Spanish, and the Slack variant says channel.
const notice = async (kind: string, lang: string) => {
  const a = new FakeAdapter();
  const c = connections.create({ kind: kind as 'fake', name: `text ${kind} ${lang}`, agent_id: null, allowed, config: { lang, chats } });
  await a.start((m) => handleInbound(c.id, a, m));
  await a.say('team', 'hello', 'luis', undefined, { group: true });
  return a.sent.map((s) => s.text);
};
eq('text: es', await notice('fake', 'es'), ['Este chat solo admite a personas de su lista. Para usarme aquí, añade tu id (luis) a los miembros de este chat (team).']);
eq('text: Slack en', await notice('slack', 'en'), ['This channel only admits the people on its list. To use me here, add your id (luis) to this channel\'s members (team).']);
eq('text: Slack es', await notice('slack', 'es'), ['Este canal solo admite a personas de su lista. Para usarme aquí, añade tu id (luis) a los miembros de este canal (team).']);

// Admin: a chat member is only one if the people list says so. With an agent, `/new` answers without running a turn.
const agent = agents.create({ name: 'access', role: 'worker', provider: 'claude', model: '', cwd: '/tmp', permission: 'acceptEdits' });
const adapter2 = new FakeAdapter();
const conn2 = connections.create({ kind: 'fake', name: 'admins', agent_id: agent.id, allowed, config: { lang: 'en', chats } });
await adapter2.start((m) => handleInbound(conn2.id, adapter2, m));
const cmd = async (user: string, text: string, key = 'team') => { adapter2.sent.length = 0; await adapter2.say(key, text, user, undefined, { group: true }); return adapter2.sent.map((s) => s.text); };
eq('3. a chat member is not admin', await cmd('ana', '/new'), ['Only an admin can use /new.']);
eq('3. ...not even in a chat shared with an admin', await cmd('ana', '/new', 'both'), ['Only an admin can use /new.']);
eq('3. an admin who is not a member gets the notice', await cmd('maria', '/new'), [member('maria', 'team')]);
check((await cmd('maria', '/new', 'both'))[0]?.startsWith('This wipes'), '3. a member who is also an admin keeps it (asks to confirm)');
eq('3. ...and can confirm', await cmd('maria', '/new confirm', 'both'), ['🆕 New conversation.']);
check((await cmd('maria', '/new', 'old'))[0]?.startsWith('This wipes'), '3. the people list keeps admin in an everyone chat');

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
