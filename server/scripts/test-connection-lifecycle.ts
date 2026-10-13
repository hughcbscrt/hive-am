// Starting a connection twice at once builds one adapter that stays, and the other is stopped (no poller left running unseen).
//   HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-connection-lifecycle.ts
import './_guard.js';
const { agents } = await import('../src/db.js');
const { connections } = await import('../src/connections/store.js');
const { adapterFor, registerFactory, startConnection, stopConnection } = await import('../src/connections/manager.js');
import type { ChannelAdapter } from '../src/connections/types.js';

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const made: { stopped: boolean; started: boolean }[] = [];
registerFactory('telegram', () => {
  const rec = { stopped: false, started: false }; made.push(rec);
  const a: ChannelAdapter = {
    kind: 'telegram',
    async start() { await sleep(60); rec.started = true; },
    async stop() { rec.stopped = true; },
    async send() { return { externalId: '1' }; },
    async busy() {},
    status() { return { state: 'connected' }; },
  };
  return a;
});
const agent = agents.create({ name: 'life', role: 'worker', provider: 'claude', model: '', cwd: '/tmp', permission: 'acceptEdits' });
const conn = connections.create({ kind: 'telegram', name: 'life-bot', agent_id: agent.id, config: {}, allowed: [] });

await Promise.all([startConnection(conn.id), startConnection(conn.id), startConnection(conn.id)]);
check(made.length === 3, 'each start built an adapter');
check(made.filter((m) => !m.stopped).length === 1, `exactly one stays running (${made.filter((m) => !m.stopped).length})`);
check(!!adapterFor(conn.id) && made[made.length - 1].started && !made[made.length - 1].stopped, 'the running one is the last, and it finished starting');
await stopConnection(conn.id);
check(made.every((m) => m.stopped) && !adapterFor(conn.id), 'stopping leaves nothing running');

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
