// Turns and wake-ups that fail halfway must not leave the agent stuck: a failure while preparing a turn is that turn's error (the agent is
// not "running" forever and the next message works), and a wake-up whose delivery failed is tried again instead of being stranded.
//   HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-runtime-recovery.ts
import './_guard.js';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.HIVE_AM_TURN_STALL_MS = '400';
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

// ---- a failure in the very first write of the turn is the turn's error too ----
const realSetStatus = agents.setStatus.bind(agents);
let boom = true;
(agents as any).setStatus = (id: string, st: string) => { if (boom && st === 'running') { boom = false; throw new Error('the disk went away'); } return realSetStatus(id, st as any); };
const lost = await sendTurn(a.id, 'lost?');
check(!lost.ok && /disk went away/.test(lost.error ?? '') && liveTurn(a.id) === null, 'a write failing as the turn starts is reported, not lost');
(agents as any).setStatus = realSetStatus;

// ---- a burst: every message runs, and a failing one does not stop the ones behind it ----
const order: string[] = [];
runners.claude = async function* (o: any) { order.push(o.prompt); if (o.prompt === 'fail') throw new Error('boom'); yield { t: 'text', delta: o.prompt }; yield { t: 'done', ok: true }; };
const burst = await Promise.all(['m1', 'fail', 'm3', 'm4', ...Array.from({ length: 30 }, (_, i) => `n${i}`)].map((m) => sendTurn(a.id, m)));
check(order.length === 34 && burst.filter((r) => r.ok).length === 33 && !burst[1].ok, 'a burst of 34 runs all 34 turns, in order, and only the failing one fails');
check(queueDepth(a.id) === 0 && liveTurn(a.id) === null, 'the queue is empty afterwards');

// ---- a CLI that goes silent is cut, and the queue moves on ----
const dir = mkdtempSync(join(tmpdir(), 'stall-'));
const sh = (name: string, body: string) => { const f = join(dir, name); writeFileSync(f, `#!/bin/sh\n${body}\n`); chmodSync(f, 0o755); return f; };
const hung = sh('hung.sh', `echo '{"x":1}'\nsleep 30`);
const chatty = sh('chatty.sh', `for i in 1 2 3 4 5 6; do echo '{"x":1}'; sleep 0.2; done`);
const { spawnJson } = await import('../src/providers/spawn.js');
runners.claude = async function* (o: any) {
  const cmd = o.prompt === 'hang' ? hung : chatty;
  for await (const ev of spawnJson({ cmd, args: [], cwd: dir, signal: o.signal })) yield { t: 'text', delta: String(ev.x) };
  yield { t: 'done', ok: true };
};
const t0 = Date.now();
const [h, next] = await Promise.all([sendTurn(a.id, 'hang'), sendTurn(a.id, 'chat')]);
check(!h.ok && /stopped answering/.test(h.error ?? '') && !/Stopped$/.test(h.error ?? ''), `a silent CLI is cut and the turn says so (${h.error})`);
check(next.ok && next.text === '111111', 'the message behind it runs');
check(Date.now() - t0 < 8000 && agents.get(a.id)?.status === 'idle' && queueDepth(a.id) === 0, 'the agent ends idle with an empty queue');
check(Date.now() - t0 > 1200, 'a turn that keeps emitting is not cut although it outlasts the deadline');

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
