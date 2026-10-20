// Delegations that outlive a request: background tasks, dispatch_status, the synchronous tool that polls instead of holding one long request,
// the notice to the orchestrator (once, where it asked), restarts, pruning and the limit per orchestrator. No model: workers are stubs.
//   HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4480 npx tsx scripts/test-dispatch-background.ts
import './_guard.js';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.HIVE_AM_WAKE_RETRY_MS = '40';
const { agents, db, dispatches } = await import('../src/db.js');
const { sendTurn } = await import('../src/runtime.js');
const { runners } = await import('../src/providers/index.js');
const { armDispatchNotices, MAX_BACKGROUND } = await import('../src/dispatches.js');
const { setDeliveryForTests } = await import('../src/wake.js');
const { connections, threads } = await import('../src/connections/store.js');
const { retentionPass, KEEP_DISPATCHES } = await import('../src/retention.js');
const { handle } = await import('../src/api.js');

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 5000) => { const end = Date.now() + ms; while (!f() && Date.now() < end) await sleep(20); return f(); };

// ---- the stack: two orchestrators, three workers (w3 is nobody's), stub workers that say, sleep, fail or wait for a gate ----
const w1 = agents.create({ name: 'bg-w1', role: 'worker', provider: 'claude', model: '', cwd: '/tmp', permission: 'acceptEdits' });
const w2 = agents.create({ name: 'bg-w2', role: 'worker', provider: 'claude', model: '', cwd: '/tmp', permission: 'acceptEdits' });
const w3 = agents.create({ name: 'bg-w3', role: 'worker', provider: 'claude', model: '', cwd: '/tmp', permission: 'acceptEdits' });
const o1 = agents.create({ name: 'bg-o1', role: 'orchestrator', provider: 'claude', model: '', cwd: '/tmp', permission: 'acceptEdits', worker_ids: [w1.id, w2.id] });
const o2 = agents.create({ name: 'bg-o2', role: 'orchestrator', provider: 'claude', model: '', cwd: '/tmp', permission: 'acceptEdits', worker_ids: [w2.id] });

let polls = 0;
const server = createServer((req, res) => { if (req.url === '/api/dispatch/status') polls++; void handle(req, res); });
const port = Number(process.env.HIVE_AM_PORT) || 4480;
await new Promise<void>((done) => server.listen(port, '127.0.0.1', done));
const API = `http://127.0.0.1:${port}`;
const post = async (path: string, b: unknown) => { const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, json: await r.json() as any }; };

const active = new Map<string, number>(); let overlap = false;
let gate: () => void = () => {}; let gated = new Promise<void>((r) => { gate = r; });
let fromThread: any = null;
runners.claude = async function* (o: any) {
  if (o.agent.id === o1.id) {
    // The orchestrator answering a chat message delegates in the background: the notice must come back to that thread.
    fromThread = await post('/api/dispatch', { from: o1.id, agent: 'bg-w1', task: 'say:from the thread', background: true });
    yield { t: 'text', delta: 'delegated' }; yield { t: 'done', ok: true }; return;
  }
  const id = o.agent.id;
  active.set(id, (active.get(id) ?? 0) + 1); if (active.get(id)! > 1) overlap = true;
  try {
    const [kind, a, b] = String(o.prompt).split(':');
    if (kind === 'fail') throw new Error(a);
    if (kind === 'sleep') { await sleep(Number(a)); yield { t: 'text', delta: b }; }
    else if (kind === 'hold') { await gated; yield { t: 'text', delta: a }; }
    else if (kind === 'empty') yield { t: 'session', sessionId: 'x' };
    else yield { t: 'text', delta: a };
    yield { t: 'done', ok: true };
  } finally { active.set(id, active.get(id)! - 1); }
};

const sent: { to: any; thread: string; web: string }[] = [];
setDeliveryForTests(async (to, thread, web, beforeSend) => { beforeSend?.(); sent.push({ to, thread, web }); return 'sent'; });
const noticesFor = (id: string) => sent.filter((s) => s.web.includes(`task ${id} `));

// ---- 1. the blocking form and the new start-and-poll form give the same answer and the same row ----
const legacy = await post('/api/dispatch', { from: o1.id, agent: 'bg-w1', task: 'say:hello there' });
check(legacy.status === 200 && legacy.json.ok && legacy.json.text === 'hello there', 'the blocking dispatch still answers with the text');
const started = await post('/api/dispatch', { from: o1.id, agent: 'bg-w1', task: 'say:hello there', poll: true });
check(started.status === 200 && !!started.json.id && started.json.mode === 'sync', 'a polled dispatch returns its id at once');
const polled = await post('/api/dispatch/status', { from: o1.id, id: started.json.id, wait_seconds: 5 });
check(polled.json.status === 'done' && polled.json.result === 'hello there', 'and dispatch_status gives the same text');
const [rowNew, rowOld] = dispatches.recent(2);
check(rowNew.status === rowOld.status && rowNew.result === rowOld.result && rowNew.mode === 'sync' && rowOld.mode === 'sync', 'both leave the same dispatches row (done, the text, sync)');
check(sent.length === 0, 'a synchronous task is never announced');

// ---- 2. the dispatch tool over stdio: a synchronous call polls with short windows and returns the text of a worker that outlasts them ----
const mcp = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), '../mcp/dispatch.mjs')], {
  env: { ...process.env, HIVE_AM_API: API, HIVE_AGENT_ID: o1.id, HIVE_CAPS: 'dispatch', HIVE_AM_DISPATCH_POLL_S: '1' }, stdio: ['pipe', 'pipe', 'inherit'],
});
const answers = new Map<number, (m: any) => void>(); let buf = '', seq = 0;
mcp.stdout.on('data', (d) => { buf += d; let n; while ((n = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, n); buf = buf.slice(n + 1); if (line.trim()) { const m = JSON.parse(line); answers.get(m.id)?.(m); } } });
const rpc = (method: string, params: unknown) => new Promise<any>((ok) => { const id = ++seq; answers.set(id, ok); mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
const listed = await rpc('tools/list', {});
check(['dispatch', 'dispatch_status'].every((n) => listed.result.tools.some((t: any) => t.name === n)) && !!listed.result.tools.find((t: any) => t.name === 'dispatch').inputSchema.properties.background, 'the MCP server offers dispatch (with background) and dispatch_status');
const toolText = (m: any) => m.result?.content?.[0]?.text ?? '';
const short = await rpc('tools/call', { name: 'dispatch', arguments: { agent: 'bg-w1', task: 'say:short answer', background: false } });
check(toolText(short) === 'short answer' && !short.result.isError, 'a short synchronous dispatch returns the text as before');
const silent = await rpc('tools/call', { name: 'dispatch', arguments: { agent: 'bg-w1', task: 'empty', background: false } });
check(toolText(silent) === '(the subagent finished without a text answer)', 'an answer without text keeps the same fallback');
polls = 0;
const t2 = Date.now();
const long = await rpc('tools/call', { name: 'dispatch', arguments: { agent: 'bg-w1', task: 'sleep:3500:after a long while', background: false } });
check(toolText(long) === 'after a long while' && Date.now() - t2 >= 3500, 'a worker that outlasts the poll window still returns its text');
check(polls >= 3, `through several dispatch_status calls (${polls})`);
const failedSync = await rpc('tools/call', { name: 'dispatch', arguments: { agent: 'bg-w1', task: 'fail:disk full', background: false } });
check(!!failedSync.result.isError && /failed/.test(toolText(failedSync)) && /disk full/.test(toolText(failedSync)), 'a failed synchronous task is an error that says why');

// ---- 3 and 4. background: back at once, running, then done; dispatch_status waits, but never long ----
let t0 = Date.now();
const bg = await post('/api/dispatch', { from: o1.id, agent: 'bg-w1', task: 'sleep:3000:background result', background: true });
check(bg.status === 200 && Date.now() - t0 < 1000 && !!bg.json.id && bg.json.mode === 'background', `a background dispatch returns in under 1 s with an id (${Date.now() - t0} ms)`);
check(bg.json.status === 'running' && dispatches.get(bg.json.id)?.status === 'running', 'its row exists and is running');
const now0 = await post('/api/dispatch/status', { from: o1.id, id: bg.json.id });
check(now0.json.status === 'running' && now0.json.result === undefined, 'dispatch_status says running, without a result');
t0 = Date.now();
const w2s = await post('/api/dispatch/status', { from: o1.id, id: bg.json.id, wait_seconds: 2 });
const took = Date.now() - t0;
check(w2s.json.status === 'running' && took >= 1900 && took < 2600, `wait_seconds 2 on an unfinished task answers after about 2 s (${took} ms)`);
const mcpStatus = await rpc('tools/call', { name: 'dispatch_status', arguments: { id: bg.json.id, wait_seconds: 5 } });
check(/: done\. Result:\nbackground result$/.test(toolText(mcpStatus)), 'dispatch_status over MCP waits for the end and gives the result');
check(dispatches.get(bg.json.id)!.read_at !== null, 'reading the result marks it read');
const capped = await post('/api/dispatch/status', { from: o1.id, id: bg.json.id, wait_seconds: 120 });
check(capped.json.status === 'done' && /capped at 60/.test(capped.json.note ?? ''), 'wait_seconds above 60 is capped, and the answer says so');
const negative = await post('/api/dispatch/status', { from: o1.id, id: bg.json.id, wait_seconds: -1 });
check(negative.status === 400, 'a negative wait is refused');
const quick = await post('/api/dispatch', { from: o1.id, agent: 'bg-w1', task: 'sleep:400:quick one', background: true });
t0 = Date.now();
const early = await post('/api/dispatch/status', { from: o1.id, id: quick.json.id, wait_seconds: 10 });
check(early.json.status === 'done' && Date.now() - t0 < 1500, `a wait ends as soon as the task does (${Date.now() - t0} ms)`);

// ---- 5. exactly one notice per background task, to the orchestrator, with the id, the subagent and the result ----
await until(() => noticesFor(bg.json.id).length > 0 && noticesFor(quick.json.id).length > 0);
await sleep(200);
const nb = noticesFor(bg.json.id);
check(nb.length === 1 && nb[0].to.agent_id === o1.id && nb[0].to.thread_id === null, 'a background task is announced once, to its orchestrator, in its web conversation');
check(nb[0].web.includes(`Delegated task ${bg.json.id} to bg-w1 finished (done). Result:\nbackground result`), 'the notice names the task, the subagent and the result');
check(!!dispatches.get(bg.json.id)!.notified_at, 'and the row records that it was handed over');
const bf = await post('/api/dispatch', { from: o1.id, agent: 'bg-w1', task: 'fail:the build broke', background: true });
await until(() => noticesFor(bf.json.id).length > 0);
check(noticesFor(bf.json.id).length === 1 && /finished \(failed\)\. Result:\nthe build broke/.test(noticesFor(bf.json.id)[0].web), 'a failed task is announced as failed, with the error');

// From a chat thread: the notice goes back to that thread, mentioning who asked in the group.
const conn = connections.create({ kind: 'fake' as any, name: 'bg-chat', agent_id: o1.id, allowed: [], config: {} });
const th = threads.touch(conn.id, 'room-1', { title: 'room', target: { chat: 'room-1' }, user: 'maria' });
await sendTurn(o1.id, 'please delegate', 'user', undefined, undefined, { connectionId: conn.id, threadId: th.id, externalKey: 'room-1', platform: 'fake' as any, place: 'room', userName: 'Maria', addressed: true, replied: false, userId: 'u-maria', group: true } as any);
check(fromThread?.status === 200 && !!fromThread.json.id, 'an orchestrator answering a chat thread can delegate in the background');
await until(() => noticesFor(fromThread.json.id).length > 0);
const nt = noticesFor(fromThread.json.id);
check(nt.length === 1 && nt[0].to.thread_id === th.id && nt[0].to.connection_id === conn.id && nt[0].to.req_name === 'Maria', 'its notice goes to that thread, for the person who asked');
check(/channel_reply/.test(nt[0].thread) && /from the thread/.test(nt[0].thread), 'the thread text carries the result and says to answer with channel_reply');

// ---- 6. nobody waiting: a polled task whose caller went away, and a blocking request cut halfway, still store their result ----
const gone = await post('/api/dispatch', { from: o1.id, agent: 'bg-w1', task: 'sleep:300:nobody asked', poll: true });
await until(() => dispatches.get(gone.json.id)?.status === 'done');
check(dispatches.get(gone.json.id)?.result === 'nobody asked', 'a task nobody polls still stores its result');
const late = await post('/api/dispatch/status', { from: o1.id, id: gone.json.id });
check(late.json.status === 'done' && late.json.result === 'nobody asked', 'and it can be read later');
const ac = new AbortController();
const cut = fetch(`${API}/api/dispatch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: o1.id, agent: 'bg-w1', task: 'sleep:500:after the cut' }), signal: ac.signal }).catch(() => 'aborted');
await sleep(150); ac.abort();
check(await cut === 'aborted', 'a blocking request can be cut by its client');
await until(() => dispatches.recent(1)[0].status === 'done');
check(dispatches.recent(1)[0].result === 'after the cut', 'the worker still finishes and its result is stored');
const bgNever = await post('/api/dispatch', { from: o1.id, agent: 'bg-w1', task: 'sleep:200:never asked', background: true });
await until(() => noticesFor(bgNever.json.id).length > 0);
check(noticesFor(bgNever.json.id).length === 1 && (await post('/api/dispatch/status', { from: o1.id, id: bgNever.json.id })).json.result === 'never asked', 'a background task never asked about is announced and still readable');

// ---- 7. a busy subagent: the second task waits, queued, then runs, never at the same time ----
overlap = false;
const first = await post('/api/dispatch', { from: o1.id, agent: 'bg-w2', task: 'sleep:800:first', background: true });
const second = await post('/api/dispatch', { from: o1.id, agent: 'bg-w2', task: 'sleep:300:second', background: true });
check(first.json.status === 'running' && second.json.status === 'queued' && dispatches.get(second.json.id)?.status === 'queued', 'the second task for a busy subagent is queued');
check(/: queued\. Not finished yet\.$/.test(toolText(await rpc('tools/call', { name: 'dispatch_status', arguments: { id: second.json.id } }))), 'and dispatch_status says so');
await until(() => dispatches.get(second.json.id)?.status === 'running');
check(dispatches.get(first.json.id)?.status === 'done' && dispatches.get(second.json.id)?.status === 'running', 'it runs once the first one is done');
await until(() => dispatches.get(second.json.id)?.status === 'done');
check(!overlap, 'the two never ran together');
const viaMcp = await rpc('tools/call', { name: 'dispatch', arguments: { agent: 'bg-w2', task: 'sleep:300:via mcp' } });
check(/^Task \S+ sent to bg-w2 \((running|queued)\)\. You will be woken with the result when it finishes; you can also ask with dispatch_status\.$/.test(toolText(viaMcp)), `the background dispatch tool says the id, the subagent and the state (${toolText(viaMcp)})`);

// ---- 8. ownership ----
const other = await post('/api/dispatch/status', { from: o2.id, id: bg.json.id });
check(other.status === 403 && /not started by you/.test(other.json.error), 'an orchestrator cannot read another one\'s task');
const notMine = await post('/api/dispatch', { from: o1.id, agent: 'bg-w3', task: 'say:x', background: true });
check(notMine.status === 400 && /not assigned/.test(notMine.json.error), 'nor send a task to an agent that is not assigned to it');
const unknown = await post('/api/dispatch/status', { from: o1.id, id: 'nope' });
check(unknown.status === 404 && /no delegated task with id "nope"/.test(unknown.json.error), 'an unknown id is a clear error');
const unknownMcp = await rpc('tools/call', { name: 'dispatch_status', arguments: { id: 'nope' } });
check(!!unknownMcp.result.isError && /no delegated task/.test(toolText(unknownMcp)), 'and the tool reports it as an error');

// ---- 11. at most MAX_BACKGROUND unfinished background tasks per orchestrator ----
gated = new Promise<void>((r) => { gate = r; });
const held: string[] = [];
for (let i = 0; i < MAX_BACKGROUND; i++) held.push((await post('/api/dispatch', { from: o2.id, agent: 'bg-w2', task: `hold:held ${i}`, background: true })).json.id);
check(held.every(Boolean) && dispatches.unfinished(o2.id) === MAX_BACKGROUND, `${MAX_BACKGROUND} background tasks are accepted`);
const eleventh = await post('/api/dispatch', { from: o2.id, agent: 'bg-w2', task: 'say:one too many', background: true });
check(eleventh.status === 400 && eleventh.json.error.includes(`${MAX_BACKGROUND} background tasks`), `the ${MAX_BACKGROUND + 1}th is refused, saying the limit (${eleventh.json.error})`);
const syncStill = await post('/api/dispatch', { from: o1.id, agent: 'bg-w1', task: 'say:not limited', poll: true });
check(syncStill.status === 200, 'another orchestrator is not affected');
gate();
await until(() => held.every((id) => dispatches.get(id)?.status === 'done'), 10_000);
check(dispatches.unfinished(o2.id) === 0, 'once they finish, the orchestrator can send again');
await until(() => held.every((id) => noticesFor(id).length === 1));

// ---- 9. restart: what was running is interrupted and announced, an unannounced result is announced, each once ----
await until(() => dispatches.recent(100).every((r) => r.status !== 'queued' && r.status !== 'running'));
const ins = db.prepare("INSERT INTO dispatches (id, from_id, to_id, task, status, result, created_at, finished_at, mode, origin, notified_at) VALUES (?,?,?,?,?,?,?,?, 'background', NULL, NULL)");
ins.run('r-running', o1.id, w1.id, 'long work', 'running', null, Date.now(), null);
ins.run('r-queued', o1.id, w1.id, 'more work', 'queued', null, Date.now(), null);
ins.run('r-done', o1.id, w1.id, 'finished work', 'done', 'all good', Date.now(), Date.now());
db.prepare("INSERT INTO dispatches (id, from_id, to_id, task, status, result, created_at, mode) VALUES ('r-sync', ?, ?, 'sync work', 'running', NULL, ?, 'sync')").run(o1.id, w1.id, Date.now());
const before = sent.length;
armDispatchNotices();
await until(() => sent.length >= before + 3);
await sleep(200);
check(dispatches.get('r-running')?.status === 'interrupted' && dispatches.get('r-queued')?.status === 'interrupted' && dispatches.get('r-sync')?.status === 'interrupted', 'after a restart, queued and running tasks are interrupted');
check(noticesFor('r-running').length === 1 && /finished \(interrupted\)\. Result:\nhive-am restarted while bg-w1 was working on it; check the branch or the files and send the task again if needed\./.test(noticesFor('r-running')[0].web), 'the interrupted one is announced, saying what to do');
check(noticesFor('r-done').length === 1 && /Result:\nall good/.test(noticesFor('r-done')[0].web), 'a finished one that was never announced is announced');
check(noticesFor('r-sync').length === 0 && sent.length === before + 3, 'a synchronous one is not announced');
armDispatchNotices();
await sleep(300);
check(sent.length === before + 3, 'a second start announces nothing again');

// A delivery that cannot be made yet (the platform is not connected) is tried again; one with nobody to tell is not repeated.
let tries = 0;
setDeliveryForTests(async (_to, _t, _w, beforeSend) => { if (++tries < 3) return 'retry'; beforeSend?.(); return 'sent'; });
ins.run('r-retry', o1.id, w1.id, 'w', 'done', 'r', Date.now(), Date.now());
armDispatchNotices();
await until(() => !!dispatches.get('r-retry')?.notified_at);
check(tries === 3 && !!dispatches.get('r-retry')?.notified_at, `a delivery that must wait is tried again until it goes (${tries} tries)`);
setDeliveryForTests(async () => 'dropped');
ins.run('r-dropped', o1.id, w1.id, 'w', 'done', 'r', Date.now(), Date.now());
armDispatchNotices();
await until(() => !!dispatches.get('r-dropped')?.notified_at);
check(!!dispatches.get('r-dropped')?.notified_at && (await post('/api/dispatch/status', { from: o1.id, id: 'r-dropped' })).json.result === 'r', 'one with nobody to tell is not tried again, and stays readable');

// ---- 10. pruning keeps a result nobody has had yet ----
const old = Date.now() - 400 * 86_400_000;
ins.run('p-unread', o1.id, w1.id, 'w', 'done', 'keep me', old, old);
db.prepare("INSERT INTO dispatches (id, from_id, to_id, task, status, result, created_at, finished_at, mode, read_at) VALUES ('p-read', ?, ?, 'w', 'done', 'r', ?, ?, 'background', ?)").run(o1.id, w1.id, old, old, old);
db.prepare("INSERT INTO dispatches (id, from_id, to_id, task, status, result, created_at, finished_at, mode, notified_at) VALUES ('p-told', ?, ?, 'w', 'done', 'r', ?, ?, 'background', ?)").run(o1.id, w1.id, old, old, old);
const fill = db.prepare("INSERT INTO dispatches (id, from_id, to_id, task, status, created_at) VALUES (?,?,?,?,'done',?)");
for (let i = 0; i < KEEP_DISPATCHES + 20; i++) fill.run(`p-fill-${i}`, o1.id, w1.id, 'w', Date.now() + i);
retentionPass();
check(!!dispatches.get('p-unread'), 'pruning keeps a background result that was neither announced nor read');
check(!dispatches.get('p-read') && !dispatches.get('p-told'), 'and removes the ones that were read or announced');

mcp.kill();
server.close();
setDeliveryForTests(null);
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
