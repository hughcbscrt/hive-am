// Simulates two Slack-like threads talking to ONE agent through a fake platform. Usage:
//   HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4420 npx tsx scripts/sim-channel.ts <claude|opencode|kiro> [model]
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agents } from '../src/db.js';
import '../src/index.js';
import { FakeAdapter } from '../src/connections/fake.js';
import { registerFactory, startConnection } from '../src/connections/manager.js';
import { connections, threadMessages, threads } from '../src/connections/store.js';

const [provider = 'claude', model = '', permission = 'acceptEdits'] = process.argv.slice(2);
const adapter = new FakeAdapter();
registerFactory('fake', () => adapter);

const agent = agents.create({ name: `sim-${provider}`, role: 'worker', provider: provider as any, model, cwd: mkdtempSync(join(tmpdir(), 'sim-')), permission: permission as any });
const conn = connections.create({ kind: 'fake', name: 'sim', agent_id: agent.id, allowed: [{ id: 'maria', admin: true }], config: { lang: 'en' } });
await startConnection(conn.id);

const show = (label: string) => console.log(`\n--- ${label}\n` + adapter.sent.map((s) => `[${s.to.chat}:${s.to.thread ?? '-'}] ${s.text}`).join('\n'));
let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };

// A stranger is refused and told their id, once.
await adapter.say('general:t1', 'hello', 'stranger');
await adapter.say('general:t1', 'hello again', 'stranger', 'in-x2');
check(adapter.sent.length === 1 && adapter.sent[0].text.includes('stranger'), 'stranger is refused once with their id');
adapter.sent.length = 0;

await adapter.say('deploys:A', 'Remember this secret code word for later: PINEAPPLE. Answer with channel_reply, one short sentence.', 'maria');
show('thread A');
const real = (s: { text: string }) => !s.text.startsWith('⚠️');
const a = adapter.sent.filter((s) => s.to.thread === 'A' && real(s));
check(a.length >= 1, 'thread A got a reply through channel_reply');

adapter.sent.length = 0;
await adapter.say('ops:B', 'What was the secret code word I told you before? Answer with channel_reply, only the word.', 'maria');
show('thread B');
const b = adapter.sent.filter((s) => s.to.thread === 'B' && real(s));
check(b.length >= 1, 'thread B got a reply');
check(b.some((s) => /pineapple/i.test(s.text)), 'thread B reply knows the word from thread A (one shared session)');
check(!adapter.sent.some((s) => s.to.thread === 'A'), 'thread B reply did not leak into thread A');

adapter.sent.length = 0;
await adapter.say('ops:B', '/status', 'maria');
check(adapter.sent[0]?.text.includes(agent.name), '/status answers without using the agent');

const t = threads.forConnection(conn.id);
check(t.length === 3 || t.length === 2, `threads recorded (${t.length})`);
check(threadMessages.recent(t.find((x) => x.external_key === 'deploys:A')!.id).some((m) => m.direction === 'out'), 'outgoing replies are logged');
check(adapter.cues.some((c) => c.state === 'done'), 'busy cue ended as done');
console.log(`\nsession: ${agents.get(agent.id)!.session_id}`);
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
