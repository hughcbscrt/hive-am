// The agent sets a RECURRING schedule from a chat, it runs on its own several times, and the agent lists and cancels it. Usage:
//   HIVE_AM_SCHEDULE_MIN_MINUTES=1 HIVE_AM_WAKE_MS_PER_MINUTE=12000 HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4480 npx tsx scripts/sim-schedule.ts <claude|opencode|kiro> [model]
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agents } from '../src/db.js';
import '../src/index.js';
import { FakeAdapter } from '../src/connections/fake.js';
import { registerFactory, startConnection } from '../src/connections/manager.js';
import { connections } from '../src/connections/store.js';
import { listFor, runsOf, listAll } from '../src/schedules.js';

const [provider = 'claude', model = ''] = process.argv.slice(2);
const adapter = new FakeAdapter();
registerFactory('fake', () => adapter);
const agent = agents.create({ name: `sim-${provider}`, role: 'worker', provider: provider as any, model, cwd: mkdtempSync(join(tmpdir(), 'sim-sched-')), permission: 'bypassPermissions' });
const conn = connections.create({ kind: 'fake', name: 'sim', agent_id: agent.id, allowed: [{ id: 'maria', admin: true }], config: { lang: 'en' } });
await startConnection(conn.id);

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const real = () => adapter.sent.filter((s) => !s.text.startsWith('⚠️'));
const ticks = () => real().filter((s) => /TICK-OK/i.test(s.text)).length;

await adapter.say('dm:maria', 'This is a test environment where the minimum interval is lowered to 1 minute, so every_minutes=1 is valid here: just call schedule_create with every_minutes=1 and note "say the word TICK-OK" (do not ask me, do not change the number). Then tell me when the next runs are.', 'maria');
console.log('first turn:', JSON.stringify(real().map((s) => s.text)).slice(0, 300));
check(listFor(agent.id).length === 1, `the agent created a recurring schedule (${listFor(agent.id).length})`);
const before = ticks();
for (let i = 0; i < 120 && ticks() - before < 2; i++) await sleep(1000);
console.log('runs seen:', ticks() - before, '| history:', JSON.stringify(runsOf(listAll()[0]?.id ?? '').map((r) => r.status)));
check(ticks() - before >= 2, 'it ran at least twice on its own, with nobody writing');
check(listAll()[0]?.fire_count >= 2, 'the interface data counts the runs');

adapter.sent.length = 0;
await adapter.say('dm:maria', 'Now list your schedules (schedule_list) and cancel all of them (schedule_cancel). Then confirm to me.', 'maria');
console.log('cancel turn:', JSON.stringify(real().map((s) => s.text)).slice(0, 300));
check(listFor(agent.id).length === 0, 'the agent cancelled its schedule');
const t0 = ticks(); await sleep(30_000);
check(ticks() === t0, 'and it no longer runs');
console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
process.exit(fail ? 1 : 0);
