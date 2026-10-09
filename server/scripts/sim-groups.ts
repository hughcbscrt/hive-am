// Group behaviour through a fake platform: open chats, quiet-on-request, mute/unmute, whole-group access. Usage:
//   HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4420 npx tsx scripts/sim-groups.ts <claude|opencode|kiro> [model]
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agents } from '../src/db.js';
import '../src/index.js';
import { bus, liveTurn, queueDepth } from '../src/runtime.js';
import { FakeAdapter } from '../src/connections/fake.js';
import { registerFactory, startConnection } from '../src/connections/manager.js';
import { connections, threadMessages, threads } from '../src/connections/store.js';

const [provider = 'claude', model = '', permission = 'acceptEdits'] = process.argv.slice(2);
const adapter = new FakeAdapter();
registerFactory('fake', () => adapter);

const agent = agents.create({ name: `sim-${provider}`, role: 'worker', provider: provider as any, model, cwd: mkdtempSync(join(tmpdir(), 'sim-')), permission: permission as any });
const conn = connections.create({
  kind: 'fake', name: 'sim', agent_id: agent.id, allowed: [{ id: 'maria', admin: true }],
  config: { lang: 'en', group_mode: 'open', chats: [{ id: 'team', name: 'Team' }], aliases: ['Sim'] },
});
await startConnection(conn.id);

const prompts: string[] = [];
bus.on('msg', (m: any) => { if (m.kind === 'turn_start') prompts.push(m.prompt); });
let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Waits for the quiet window to pass and for the agent to finish whatever it was handed. */
async function settle(extra = 0) {
  await sleep(5000);
  for (let i = 0; i < 240 && (liveTurn(agent.id) || queueDepth(agent.id) > 0); i++) await sleep(500);
  await sleep(extra);
}
const group = (text: string, user: string, addressed: boolean, key = 'team') => adapter.say(key, text, user, undefined, { group: true, addressed });
const thread = () => threads.forConnection(conn.id).find((t) => t.external_key === 'team')!;
const out = () => adapter.sent.filter((s) => !s.text.startsWith('⚠️'));
const reset = () => { adapter.sent.length = 0; };

// 1. Access: anyone in an allowed group may talk; a stranger's chatter in another group is ignored; addressed strangers are told how.
await group('hello everyone', 'ana', false, 'other-group');
check(adapter.sent.length === 0 && !agent.session_id, 'chatter from a group that is not allowed is ignored silently');
await adapter.say('other-group', 'hey bot', 'ana', undefined, { group: true, addressed: true });
check(adapter.sent.length === 1 && adapter.sent[0].text.includes('other-group'), 'an addressed stranger is told the chat id to add');
reset();

// 2. Chatter nobody aimed at the agent: it listens, and stays silent when there is nothing to add.
await group('anyone up for lunch at 1?', 'ana', false);
await group('yes, the new place on 5th', 'luis', false);
await settle();
check(out().length === 0, 'small talk gets no reply');
check(prompts.length === 1 && /Addressed: no/.test(prompts[0]) && /new place on 5th/.test(prompts[0]) && /lunch at 1/.test(prompts[0]), 'the burst became ONE turn (flagged Addressed: no) that carries both messages');
check(adapter.cues.length === 0, 'and no typing cue is shown for it');
check(threadMessages.recent(thread().id).length >= 2, 'the chatter is recorded');
reset();

// 3. Called by name (alias) without @: it answers, and it was handed the earlier chatter as context.
await group('Sim, what is 17 * 3? Answer with channel_reply, only the number.', 'ana', false);
await settle();
check(out().some((s) => /51/.test(s.text)), 'a message that names the agent gets an answer');
check(/Addressed: yes/.test(prompts[prompts.length - 1]), 'called by name counts as addressed');
reset();

// 4. A question in open chat that it can answer (not addressed to anyone): it may chime in. (Not asserted: it is a judgement call.)
// 5. Asked to be quiet: it mutes the thread.
await group('Sim, please stop replying in this chat from now on. You can say one short goodbye.', 'ana', false);
await settle();
check(thread().muted === true, 'asked to be quiet, the agent muted the thread');
reset();

// 6. While muted, chatter does not wake it, even when it names a topic it knows.
const before = agents.get(agent.id)!.session_id;
await group('what is 2 + 2? anyone?', 'luis', false);
await settle();
check(out().length === 0, 'muted: chatter gets no reply');
check(prompts.length === 3, 'muted: chatter did not wake the agent (no new turn)');
const turnsBefore = threadMessages.recent(thread().id).filter((m) => m.direction === 'out').length;

// 7. Asked to talk again (mention): it unmutes and answers.
await group('Sim, you can talk again. Confirm with channel_reply.', 'ana', true);
await settle();
check(thread().muted === false, 'asked to talk again, the agent unmuted the thread');
check(out().length >= 1, 'and it answered');
reset();

// 8. /mute and /unmute commands work without the agent.
await group('/mute', 'luis', true);
check(thread().muted === true && /quiet/i.test(adapter.sent[0]?.text ?? ''), '/mute mutes the thread by command');
reset();
await group('/unmute', 'luis', true);
check(thread().muted === false, '/unmute brings it back');
void before; void turnsBefore;
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
