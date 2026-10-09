// "Tell me the moment it finishes", without a model: the watcher sees a process end, a marker file appear, the time run out, and refuses bad input. Usage:
//   HIVE_AM_WATCH_POLL_MS=300 HIVE_AM_WAKE_MS_PER_MINUTE=1500 HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4480 npx tsx scripts/test-watch.ts
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agents, db } from '../src/db.js';
import '../src/index.js';
import { setDeliveryForTests } from '../src/wake.js';
import { WatchError, cancelWatchFor, createWatch, isAlive, pendingWatches, processStamp } from '../src/watch.js';

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const throws = (fn: () => unknown, re: RegExp) => { try { fn(); return false; } catch (e) { return e instanceof WatchError && re.test(e.message); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms = 8000) => { for (let t = 0; t < ms && !cond(); t += 100) await sleep(100); return cond(); };

const sent: { text: string; web: string }[] = [];
setDeliveryForTests(async (_to, threadText, webText, beforeSend) => { beforeSend?.(); sent.push({ text: threadText, web: webText }); return 'sent'; });

const cwd = mkdtempSync(join(tmpdir(), 'watch-'));
const a = agents.create({ name: 'watch-a', role: 'worker', provider: 'opencode', model: '', cwd, permission: 'acceptEdits' });
const job = (seconds: number) => spawn('sleep', [String(seconds)], { stdio: 'ignore' });

// 1. A job that ends: the agent is told once it is over, not before.
const j1 = job(2); j1.on('exit', () => undefined);
const w1 = createWatch(a.id, { pid: j1.pid, log: '~/job.log', note: 'tell me how the deploy went' });
check(!w1.reused && pendingWatches().length === 1, 'a watch is created for a running process');
await sleep(800);
check(sent.length === 0, 'while it runs, nothing is sent');
check(await until(() => sent.length === 1), 'when the process ends, the agent is woken');
check(/has ended/.test(sent[0]?.text ?? '') && /~\/job\.log/.test(sent[0]?.text ?? '') && /how the deploy went/.test(sent[0]?.text ?? ''), 'the message says it ended, where the log is and the note');
check(pendingWatches().length === 0, 'the watch is consumed');
await sleep(800); check(sent.length === 1, 'and it is told only once');

// 2. A marker file that appears.
sent.length = 0;
const j2 = job(30); const marker = join(cwd, 'done.flag');
createWatch(a.id, { pid: j2.pid, file: 'done.flag', note: 'marker test' });
await sleep(700); check(sent.length === 0, 'no marker yet: nothing is sent');
writeFileSync(marker, 'ok');
check(await until(() => sent.length === 1), 'when the marker file appears, the agent is woken');
check(/marker file/.test(sent[0]?.text ?? ''), 'and it is told it was the marker');
j2.kill();

// 3. Still running when the waiting time ends.
sent.length = 0;
const j3 = job(60);
createWatch(a.id, { pid: j3.pid, note: 'slow job', max_minutes: 1 });
check(await until(() => sent.length === 1, 6000), 'at the time limit the agent is woken even if it is still running');
check(/still running/.test(sent[0]?.text ?? ''), 'and it is told so');
j3.kill();

// 4. A job that finished but nobody collected (zombie) counts as finished; a reused pid is not the job.
const j4 = job(60); const st = processStamp(j4.pid!);
check(st !== null && isAlive(j4.pid!, st), 'a running process is alive');
check(!isAlive(j4.pid!, 'not-the-same-start-time'), 'a pid that now belongs to another process is not the job');
j4.kill(); await sleep(300);
check(!isAlive(j4.pid!, st), 'a killed process is not alive');

// 5. Bad input.
sent.length = 0;
const alive = job(30);
check(throws(() => createWatch(a.id, { pid: 999999, note: 'x' }), /not running/), 'a process that is not running is refused (look at the result now)');
check(throws(() => createWatch(a.id, { pid: 'abc', note: 'x' }), /pid must be/), 'a pid that is not a number is refused');
check(throws(() => createWatch(a.id, { pid: process.pid, note: 'x' }), /not the process you started/), 'hive-am itself cannot be watched');
check(throws(() => createWatch(a.id, { pid: alive.pid, note: '' }), /note/), 'an empty note is refused');
check(throws(() => createWatch(a.id, { pid: alive.pid, note: 'x', file: '/etc/passwd' }), /marker file must be inside/), 'a marker file outside the allowed folders is refused');
check(throws(() => createWatch(a.id, { pid: alive.pid, note: 'x', max_minutes: 999 }), /max_minutes/), 'a waiting time above the limit is refused');
const first = createWatch(a.id, { pid: alive.pid, note: 'x' });
check(createWatch(a.id, { pid: alive.pid, note: 'again' }).reused === true && pendingWatches().length === 1, 'the same process twice is one watch');
check(throws(() => cancelWatchFor('someone-else', first.id), /not waiting/), 'another agent cannot cancel it');
check(cancelWatchFor(a.id, first.id) && pendingWatches().length === 0, 'the agent cancels its own');
const many = Array.from({ length: 5 }, () => job(30));
many.forEach((j) => createWatch(a.id, { pid: j.pid, note: 'n' }));
const extra = job(30);
check(throws(() => createWatch(a.id, { pid: extra.pid, note: 'n' }), /already waiting for 5/), 'at most 5 at once');
[alive, extra, ...many].forEach((j) => j.kill());
db.prepare('DELETE FROM agent_watches').run();
setDeliveryForTests(null);
console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
process.exit(fail ? 1 : 0);
