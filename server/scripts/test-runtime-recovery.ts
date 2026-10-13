// Turns and wake-ups that fail halfway must not leave the agent stuck: a failure while preparing a turn is that turn's error (the agent is
// not "running" forever and the next message works), and a wake-up whose delivery failed is tried again instead of being stranded.
//   HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-runtime-recovery.ts
import './_guard.js';
process.env.HIVE_AM_WAKE_MS_PER_MINUTE = '40';
process.env.HIVE_AM_WAKE_RETRY_MS = '40';
const { agents, db } = await import('../src/db.js');
const { liveTurn, queueDepth, sendTurn } = await import('../src/runtime.js');
const { runners } = await import('../src/providers/index.js');
const { armWakeups, pendingWakeups, scheduleWake, setDeliveryForTests } = await import('../src/wake.js');

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const a = agents.create({ name: 'rec-a', role: 'worker', provider: 'claude', model: '', cwd: '/tmp', permission: 'acceptEdits' });
runners.claude = async function* () { yield { t: 'text', delta: 'hello' }; yield { t: 'done', ok: true }; };

// ---- a turn ----
check((await sendTurn(a.id, 'hi')).text === 'hello', 'a normal turn answers');
db.exec('ALTER TABLE agent_notebooks RENAME TO nb_tmp');   // makes preparing the turn throw before the model is called
const bad = await sendTurn(a.id, 'hi again');
check(!bad.ok && /agent_notebooks/.test(bad.error ?? ''), 'a failure while preparing the turn is reported as its error');
check(liveTurn(a.id) === null && queueDepth(a.id) === 0, 'nothing is left live or queued');
check(agents.get(a.id)?.status === 'error', 'the agent is marked as failed, not "running" forever');
db.exec('ALTER TABLE nb_tmp RENAME TO agent_notebooks');
const again = await sendTurn(a.id, 'and now?');
check(again.ok && again.text === 'hello' && agents.get(a.id)?.status === 'idle', 'the next message works');

// ---- a wake-up whose delivery fails once ----
let calls = 0;
setDeliveryForTests(async (_to, _t, _w, beforeSend) => { calls++; if (calls === 1) throw new Error('platform hiccup'); beforeSend?.(); return 'sent'; });
const w = scheduleWake(a.id, 1, 'check the build');
check(pendingWakeups().length === 1, 'the wake-up is stored');
await sleep(400);
check(calls >= 2, `its delivery is tried again after a failure (${calls} tries)`);
check(pendingWakeups().length === 0, 'and it is gone once delivered');

// ---- one that keeps failing gives up instead of lingering ----
calls = 0;
setDeliveryForTests(async () => { calls++; throw new Error('always down'); });
scheduleWake(a.id, 1, 'check the deploy');
await sleep(1500);
check(calls === 13 && pendingWakeups().length === 0, `a delivery that never works is dropped after the retries (${calls} tries)`);

// ---- a restart re-arms what was stored ----
calls = 0;
setDeliveryForTests(async (_to, _t, _w, beforeSend) => { calls++; beforeSend?.(); return 'sent'; });
db.prepare('INSERT INTO agent_wakeups (id,agent_id,due_at,note,created_at) VALUES (?,?,?,?,?)').run('stored', a.id, Date.now() + 60, 'after restart', Date.now());
armWakeups();
await sleep(300);
check(calls === 1 && pendingWakeups().length === 0, 'a wake-up stored before a restart fires after it');
setDeliveryForTests(null);
void w;

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
