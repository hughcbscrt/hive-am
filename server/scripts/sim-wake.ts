// The agent promises to tell someone later: it must schedule a wake-up, and when the time comes it writes without being asked. Usage:
//   HIVE_AM_WAKE_MS_PER_MINUTE=10000 HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4460 npx tsx scripts/sim-wake.ts <claude|opencode|kiro> [model]
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agents } from '../src/db.js';
import '../src/index.js';
import { FakeAdapter } from '../src/connections/fake.js';
import { registerFactory, startConnection } from '../src/connections/manager.js';
import { connections } from '../src/connections/store.js';
import { pendingWakeups } from '../src/wake.js';
import { bus, sendTurn } from '../src/runtime.js';
import { WAKEUPS_SKILL_ID } from '../src/skills/defaults.js';

const [provider = 'claude', model = ''] = process.argv.slice(2);
process.env.HIVE_AM_WAKE_MS_PER_MINUTE ??= '10000';
const adapter = new FakeAdapter();
registerFactory('fake', () => adapter);
const agent = agents.create({ name: `sim-${provider}`, role: 'worker', provider: provider as any, model, cwd: mkdtempSync(join(tmpdir(), 'sim-wake-')), permission: 'bypassPermissions' });
const conn = connections.create({ kind: 'fake', name: 'sim', agent_id: agent.id, allowed: [{ id: 'maria', admin: true }], config: { lang: 'en' } });
await startConnection(conn.id);

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const real = () => adapter.sent.filter((s) => !s.text.startsWith('⚠️'));

adapter.sent.length = 0;
await adapter.say('team:t1', 'A deploy will finish in about 1 minute. Please tell me when it is done: schedule a wake-up in 1 minute with channel_wake (note: "say the word DEPLOYED-OK"), tell me the time with channel_reply, and when you wake up tell me "DEPLOYED-OK".', 'maria', undefined, { group: true, addressed: true });
console.log('first turn replies:', JSON.stringify(real().map((s) => s.text)));
check(real().length >= 1, 'the agent answered the first message');
check(pendingWakeups().length >= 1, `a wake-up was scheduled (${pendingWakeups().length} pending)`);
const before = real().length;
// Nobody writes now: the agent has to speak by itself once the wake-up is due.
for (let i = 0; i < 90 && real().length === before; i++) await sleep(1000);
console.log('after the wake-up:', JSON.stringify(real().slice(before).map((s) => s.text)));
check(real().length > before, 'the agent wrote again without anybody asking');
check(real().slice(before).some((s) => /DEPLOYED-OK/i.test(s.text)), 'what it wrote follows its note');
check(real().slice(before)[0]?.text.startsWith('@maria'), 'asked in a group, the reminder starts by mentioning the person who asked');
check(real().slice(0, before).every((s) => !s.text.startsWith('@maria')), 'the answer to the first message is not a mention');

// --- The hive-am web chat: no connection at all, just the Wake-ups skill.
const web = agents.create({ name: `web-${provider}`, role: 'worker', provider: provider as any, model, cwd: mkdtempSync(join(tmpdir(), 'sim-wake-web-')), permission: 'bypassPermissions', skill_ids: [WAKEUPS_SKILL_ID], skill_loads: { [WAKEUPS_SKILL_ID]: 'always' } });
let wakeTurn = false; let wakeText = '';
bus.on('msg', (m: any) => {
  if (m.agentId !== web.id) return;
  if (m.kind === 'turn_start' && /Scheduled wake-up/.test(m.prompt ?? '')) wakeTurn = true;
  if (m.kind === 'event' && wakeTurn && m.event?.t === 'text') wakeText += m.event.delta;
});
const r = await sendTurn(web.id, 'A build will finish in about 1 minute. Tell me when it is done: schedule a wake-up in 1 minute with wake_me (note: "say the word BUILD-OK"), tell me the time, and when you wake up tell me "BUILD-OK".');
console.log('web first turn:', JSON.stringify(r.text.slice(0, 200)));
check(r.ok && pendingWakeups().some((w) => w.agent_id === web.id), 'web chat: the agent scheduled a wake-up');
for (let i = 0; i < 90 && !/BUILD-OK/i.test(wakeText); i++) await sleep(1000);
console.log('web after the wake-up:', JSON.stringify(wakeText.slice(0, 200)));
check(wakeTurn, 'web chat: a new turn started by itself when the wake-up was due');
check(/BUILD-OK/i.test(wakeText), 'web chat: the agent followed its note');
console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
process.exit(fail ? 1 : 0);
