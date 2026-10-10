// The agent starts a job in the background, asks to be woken when it ends, and reports on its own (mentioning who asked, in a group). Usage:
//   HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4500 npx tsx scripts/sim-watch.ts <claude|opencode|kiro> [model]
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agents } from '../src/db.js';
import '../src/index.js';
import { FakeAdapter } from '../src/connections/fake.js';
import { registerFactory, startConnection } from '../src/connections/manager.js';
import { connections } from '../src/connections/store.js';
import { pendingWatches } from '../src/watch.js';

const [provider = 'claude', model = ''] = process.argv.slice(2);
const adapter = new FakeAdapter();
registerFactory('fake', () => adapter);
const cwd = mkdtempSync(join(tmpdir(), 'sim-watch-'));
const agent = agents.create({ name: `sim-${provider}`, role: 'worker', provider: provider as any, model, cwd, permission: 'bypassPermissions' });
const conn = connections.create({ kind: 'fake', name: 'sim', agent_id: agent.id, allowed: [{ id: 'maria', admin: true }], config: { lang: 'en' } });
await startConnection(conn.id);

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const real = () => adapter.sent.filter((s) => !s.text.startsWith('⚠️'));

await adapter.say('team:t1', `Run this in the background, in your working folder, with the shell: nohup sh -c 'sleep 20; echo "all steps finished" > job.log; date +%s%N > end.txt' > /dev/null 2>&1 & echo $!   Then call wake_when_done with that pid (log: job.log, note: "tell me JOB-DONE and the last line of job.log"), and tell me with channel_reply that you will report when it ends. Do not wait for it and do not poll.`, 'maria', undefined, { group: true, addressed: true });
console.log('first turn:', JSON.stringify(real().map((s) => s.text)).slice(0, 260));
const before = real().length;
check(pendingWatches().length === 1, `the agent is watching the process (${pendingWatches().length})`);
const seen: number[] = [];   // when each message after the first turn arrived
const poller = setInterval(() => { while (before + seen.length < real().length) seen.push(Date.now()); }, 150);
for (let i = 0; i < 160 && !real().slice(before).some((s) => /JOB-DONE/i.test(s.text)); i++) await sleep(500);
clearInterval(poller);
const after = real().slice(before);
console.log('after it ended:', JSON.stringify(after.map((s) => s.text)).slice(0, 420));
const report = after.find((s) => /JOB-DONE/i.test(s.text));
const endMs = existsSync(join(cwd, 'end.txt')) ? Number(readFileSync(join(cwd, 'end.txt'), 'utf8').trim()) / 1e6 : 0;
check(!!report, 'the agent wrote again on its own');
check(/JOB-DONE/i.test(report?.text ?? '') && /all steps finished/i.test(report?.text ?? ''), 'its report follows its note and what the job said in the log');
check((report?.text ?? '').startsWith('@maria'), 'the report mentions the person who asked');
const notice = after[0];
check(!!notice && notice !== report && /@maria/.test(notice.text) && /(finished|Terminó)/i.test(notice.text), 'a short notice that it finished arrives first, mentioning the person');
if (endMs && seen[0]) {
  const n = (seen[0] - endMs) / 1000, r = ((seen[after.indexOf(report!)] ?? Date.now()) - endMs) / 1000;
  console.log(`the notice came ${n.toFixed(1)} s after the job ended; the agent's report ${r.toFixed(1)} s after`);
  check(n >= 0 && n < 5, 'the notice came within a few seconds of the end (not at a fixed time)');
}
check(pendingWatches().length === 0, 'the watch is consumed');
console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
process.exit(fail ? 1 : 0);
