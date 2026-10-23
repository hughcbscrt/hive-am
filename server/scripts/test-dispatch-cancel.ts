// Cancelling a delegated task: from the orchestrator (dispatch_cancel, dispatch_list) and from the web, queued or running, the race with the
// end of the turn, the one notice, restarts, pruning and the limit per orchestrator. No model: workers are stubs that honour the abort signal.
//   HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4481 npx tsx scripts/test-dispatch-cancel.ts
import './_guard.js';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.HIVE_AM_WAKE_RETRY_MS = '40';
const { agents, db, dispatches } = await import('../src/db.js');
const { bus, liveTurn, queueDepth, sendTurn } = await import('../src/runtime.js');
const { runners } = await import('../src/providers/index.js');
const { armDispatchNotices, cancelTask, MAX_BACKGROUND } = await import('../src/dispatches.js');
const { setDeliveryForTests } = await import('../src/wake.js');
const { connections, threads } = await import('../src/connections/store.js');
const { retentionPass, KEEP_DISPATCHES } = await import('../src/retention.js');
const { handle } = await import('../src/api.js');

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 5000) => { const end = Date.now() + ms; while (!f() && Date.now() < end) await sleep(20); return f(); };

// ---- the stack: two orchestrators, two workers; `hold:<name>` writes some text and waits for release(name) or the abort ----
const w1 = agents.create({ name: 'cx-w1', role: 'worker', provider: 'claude', model: '', cwd: '/tmp', permission: 'acceptEdits' });
const w2 = agents.create({ name: 'cx-w2', role: 'worker', provider: 'claude', model: '', cwd: '/tmp', permission: 'acceptEdits' });
const o1 = agents.create({ name: 'cx-o1', role: 'orchestrator', provider: 'claude', model: '', cwd: '/tmp', permission: 'acceptEdits', worker_ids: [w1.id, w2.id] });
const o2 = agents.create({ name: 'cx-o2', role: 'orchestrator', provider: 'claude', model: '', cwd: '/tmp', permission: 'acceptEdits', worker_ids: [w2.id] });

const server = createServer((req, res) => { void handle(req, res); });
const port = Number(process.env.HIVE_AM_PORT) || 4481;
await new Promise<void>((done) => server.listen(port, '127.0.0.1', done));
const API = `http://127.0.0.1:${port}`;
const post = async (path: string, b: unknown) => { const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, json: await r.json() as any }; };
const send = async (from: string, agent: string, task: string) => (await post('/api/dispatch', { from, agent, task, background: true })).json;

const calls: string[] = [];
const aborted = new Set<string>();
const gates = new Map<string, () => void>();
const release = (name: string) => gates.get(name)?.();
let fromThread: any = null;
runners.claude = async function* (o: any) {
  if (o.agent.id === o1.id) {
    // The orchestrator answering a chat message delegates in the background: a cancel by the person is announced in that thread.
    fromThread = await send(o1.id, 'cx-w1', 'hold:T');
    yield { t: 'text', delta: 'delegated' }; yield { t: 'done', ok: true }; return;
  }
  calls.push(String(o.prompt));
  const [kind, a] = String(o.prompt).split(':');
  if (kind === 'hold') {
    yield { t: 'text', delta: `partial ${a}` };
    await new Promise<void>((ok) => { gates.set(a, ok); o.signal.addEventListener('abort', () => { aborted.add(a); ok(); }, { once: true }); });
    if (o.signal.aborted) return;
    yield { t: 'text', delta: ` and ${a} finished` };
  } else yield { t: 'text', delta: a };
  yield { t: 'done', ok: true };
};

const sent: { to: any; thread: string; web: string }[] = [];
setDeliveryForTests(async (to, thread, web, beforeSend) => { beforeSend?.(); sent.push({ to, thread, web }); return 'sent'; });
const noticesFor = (id: string) => sent.filter((s) => s.web.includes(`task ${id} `));
const statuses: { agentId: string; status: string; queued: number }[] = [];
bus.on('msg', (m: any) => { if (m.kind === 'status') statuses.push(m); });
const row = (id: string) => dispatches.get(id)!;
const idle = (id: string) => until(() => !liveTurn(id) && queueDepth(id) === 0 && agents.get(id)?.status === 'idle');

// The MCP server over stdio, as the orchestrator's CLI runs it.
const mcpFor = (caps: string) => {
  const p = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), '../mcp/dispatch.mjs')], {
    env: { ...process.env, HIVE_AM_API: API, HIVE_AGENT_ID: o1.id, HIVE_CAPS: caps, HIVE_AM_DISPATCH_POLL_S: '1' }, stdio: ['pipe', 'pipe', 'inherit'],
  });
  const answers = new Map<number, (m: any) => void>(); let buf = '', seq = 0;
  p.stdout.on('data', (d) => { buf += d; let n; while ((n = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, n); buf = buf.slice(n + 1); if (line.trim()) { const m = JSON.parse(line); answers.get(m.id)?.(m); } } });
  const rpc = (method: string, params: unknown) => new Promise<any>((ok) => { const id = ++seq; answers.set(id, ok); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  return { p, rpc };
};
const mcp = mcpFor('dispatch');
const rpc = mcp.rpc;
await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
const toolText = (m: any) => m.result?.content?.[0]?.text ?? '';
const listed = await rpc('tools/list', {});
check(['dispatch_cancel', 'dispatch_list'].every((n) => listed.result.tools.some((t: any) => t.name === n)), 'the MCP server offers dispatch_cancel and dispatch_list with the dispatch capability');
const plain = mcpFor('channel');
await plain.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
const plainTools = (await plain.rpc('tools/list', {})).result.tools.map((t: any) => t.name);
check(!plainTools.includes('dispatch_cancel') && !plainTools.includes('dispatch_list'), 'an agent without the dispatch capability does not see them');
plain.p.kill();

// ---- S32.1 and S32.3: A runs, B and C wait; cancelling B (queued) takes it out at once and leaves A alone ----
const A = await send(o1.id, 'cx-w1', 'hold:A');
const B = await send(o1.id, 'cx-w1', 'hold:B');
const C = await send(o1.id, 'cx-w1', 'say:C answered');
check(A.status === 'running' && B.status === 'queued' && C.status === 'queued' && queueDepth(w1.id) === 2, 'A runs and B and C are queued behind it');
const cb = await rpc('tools/call', { name: 'dispatch_cancel', arguments: { id: B.id } });
check(toolText(cb) === `Task ${B.id} for cx-w1 cancelled before it started.` && !cb.result.isError, `dispatch_cancel on a queued task says so (${toolText(cb)})`);
check(row(B.id).status === 'cancelled' && !!row(B.id).finished_at && row(B.id).result === 'Cancelled by the orchestrator before it finished.', 'its row is cancelled, with the finish time and the fixed text');
const lastStatus = statuses.filter((s) => s.agentId === w1.id).at(-1);
check(queueDepth(w1.id) === 1 && lastStatus?.queued === 1 && lastStatus.status === 'running', 'the worker\'s queue count drops at once, and the status event says so');
check(!aborted.has('A') && row(A.id).status === 'running', 'cancelling B does not touch A, which keeps running');

// ---- S32.2 and S32.9: cancelling A (running) aborts its turn; the end of that turn does not turn it into failed ----
const ca = await post('/api/dispatch/cancel', { from: o1.id, id: A.id });
check(ca.status === 200 && ca.json.cancelled === true && ca.json.was === 'running' && ca.json.status === 'cancelled', 'the HTTP cancel of a running task answers it was running and is now cancelled');
const finishedA = row(A.id).finished_at;
await until(() => row(C.id).status === 'done');
check(aborted.has('A'), 'the worker saw the abort signal');
check(row(A.id).status === 'cancelled' && row(A.id).result === 'Cancelled by the orchestrator before it finished.' && !/partial/.test(row(A.id).result ?? ''), 'after its turn ended the row still says cancelled, with the fixed text and not the partial one');
check(row(A.id).finished_at === finishedA, 'and its finish time is the time of the cancel');
check(row(C.id).result === 'C answered' && !calls.includes('hold:B'), 'the task after them ran normally, and B never reached the worker');
check(await idle(w1.id), 'the worker is idle again');

// ---- S32.3: with D running and E queued, cancelling D does not cancel E, which starts next ----
const D = await send(o1.id, 'cx-w1', 'hold:D');
const E = await send(o1.id, 'cx-w1', 'hold:E');
await rpc('tools/call', { name: 'dispatch_cancel', arguments: { id: D.id } }).then((m) => check(/was working on it and was stopped/.test(toolText(m)), `dispatch_cancel on a running task says the subagent was stopped (${toolText(m)})`));
await until(() => row(E.id).status === 'running' && gates.has('E'));
check(row(D.id).status === 'cancelled' && row(E.id).status === 'running', 'cancelling D leaves E, which starts right after');
release('E');
await until(() => row(E.id).status === 'done');
check(row(E.id).result === 'partial E and E finished', 'and E ends with its own answer');
await idle(w1.id);
await sleep(150);
check([A, B, D].every((x) => noticesFor(x.id).length === 0) && [A, B, D].every((x) => !!row(x.id).notified_at), 'a task the orchestrator cancelled is never announced to it');
check(noticesFor(C.id).length === 1 && noticesFor(E.id).length === 1, 'the tasks that finished are announced once each, as before');

// ---- S32.4: cancelling a finished task changes nothing and answers its state ----
const before4 = sent.length;
const again = await post('/api/dispatch/cancel', { from: o1.id, id: A.id });
check(again.status === 200 && again.json.cancelled === false && again.json.status === 'cancelled' && row(A.id).finished_at === finishedA, 'cancelling a cancelled task again is not an error and changes nothing');
const ins = db.prepare("INSERT INTO dispatches (id, from_id, to_id, task, status, result, created_at, finished_at, mode, origin, notified_at) VALUES (?,?,?,?,?,?,?,?, 'background', NULL, ?)");
const t4 = Date.now() - 1000;
ins.run('f-failed', o1.id, w1.id, 'w', 'failed', 'broke', t4, t4, t4);
ins.run('f-interrupted', o1.id, w1.id, 'w', 'interrupted', null, t4, t4, t4);
for (const id of [C.id, 'f-failed', 'f-interrupted']) {
  const was = row(id).status;
  const r = await post('/api/dispatch/cancel', { from: o1.id, id });
  check(r.status === 200 && r.json.cancelled === false && r.json.status === was && row(id).status === was && row(id).finished_at === (id === C.id ? row(C.id).finished_at : t4), `cancelling a ${was} task answers ${was} and leaves it as it was`);
}
const byPersonDone = await post(`/api/dispatches/${C.id}/cancel`, {});
check(byPersonDone.status === 200 && byPersonDone.json.status === 'done' && byPersonDone.json.cancelled === false, 'the same from the web');
const doneMcp = await rpc('tools/call', { name: 'dispatch_cancel', arguments: { id: C.id } });
check(/had already finished \(done\); nothing changed\. Result:\nC answered$/.test(toolText(doneMcp)) && !doneMcp.result.isError, 'and the tool says it had already finished, with its result');
await sleep(150);
check(sent.length === before4, 'none of these sends a message');

// ---- S32.5: only the orchestrator that started a task cancels it; an unknown id is a clear error ----
const F = await send(o1.id, 'cx-w1', 'hold:F');
const other = await post('/api/dispatch/cancel', { from: o2.id, id: F.id });
check(other.status === 403 && /not started by you/.test(other.json.error) && row(F.id).status === 'running', 'another orchestrator cannot cancel it (403), and it keeps running');
const unknown = await post('/api/dispatch/cancel', { from: o1.id, id: 'nope' });
check(unknown.status === 404 && /no delegated task with id "nope"/.test(unknown.json.error), 'an unknown id is 404, said clearly');
const unknownMcp = await rpc('tools/call', { name: 'dispatch_cancel', arguments: { id: 'nope' } });
check(!!unknownMcp.result.isError && /no delegated task/.test(toolText(unknownMcp)), 'and the tool reports it as an error');
check((await post('/api/dispatch/cancel', { id: F.id })).status === 400, 'the orchestrator route needs from');

// ---- S32.6 and S32.7: the person cancels from the web, queued at once or running; the orchestrator is told once each ----
const G = await send(o1.id, 'cx-w1', 'hold:G');
const webQueued = await post(`/api/dispatches/${G.id}/cancel`, {});
check(webQueued.status === 200 && webQueued.json.status === 'cancelled' && webQueued.json.was === 'queued', 'the web cancels a queued task and answers cancelled');
await until(() => noticesFor(G.id).length > 0, 1000);
check(noticesFor(G.id).length === 1 && row(F.id).status === 'running', 'its notice goes at once, while the worker is still busy with the task before it');
check(noticesFor(G.id)[0].to.agent_id === o1.id && noticesFor(G.id)[0].web.includes(`Delegated task ${G.id} to cx-w1 finished (cancelled). Result:\nCancelled by the person before it finished.`), 'to its orchestrator, naming the task, the subagent and cancelled');
const webRunning = await post(`/api/dispatches/${F.id}/cancel`, {});
check(webRunning.status === 200 && webRunning.json.status === 'cancelled' && webRunning.json.was === 'running', 'the web cancels a running task');
await idle(w1.id);
await sleep(200);
check(noticesFor(F.id).length === 1 && noticesFor(G.id).length === 1, 'each is announced exactly once, also after the aborted turn ended');
check(!calls.includes('hold:G'), 'the queued one never reached the worker');
check((await post('/api/dispatches/nope/cancel', {})).status === 404, 'an unknown id from the web is 404');

// From a chat thread: the notice of a cancel by the person goes back to the thread where the task was delegated.
const conn = connections.create({ kind: 'fake' as any, name: 'cx-chat', agent_id: o1.id, allowed: [], config: {} });
const th = threads.touch(conn.id, 'room-1', { title: 'room', target: { chat: 'room-1' }, user: 'maria' });
await sendTurn(o1.id, 'please delegate', 'user', undefined, undefined, { connectionId: conn.id, threadId: th.id, externalKey: 'room-1', platform: 'fake' as any, place: 'room', userName: 'Maria', addressed: true, replied: false, userId: 'u-maria', group: true } as any);
await until(() => row(fromThread.id).status === 'running');
await post(`/api/dispatches/${fromThread.id}/cancel`, {});
await until(() => noticesFor(fromThread.id).length > 0);
await idle(w1.id);
await sleep(150);
const nt = noticesFor(fromThread.id);
check(nt.length === 1 && nt[0].to.thread_id === th.id && nt[0].to.connection_id === conn.id && /finished \(cancelled\)/.test(nt[0].thread), 'it goes once to that thread, saying cancelled');

// ---- S32.8: a synchronous dispatch whose task is cancelled returns the cancel, it does not hang nor say failed ----
const syncCall = rpc('tools/call', { name: 'dispatch', arguments: { agent: 'cx-w1', task: 'hold:S', background: false } });
await until(() => gates.has('S') && dispatches.recent(1)[0].status === 'running');
const S = dispatches.recent(1)[0];
await post(`/api/dispatches/${S.id}/cancel`, {});
const syncOut = await Promise.race([syncCall, sleep(8000).then(() => null)]);
check(!!syncOut && !!syncOut.result.isError && toolText(syncOut) === 'cx-w1 task was cancelled: Cancelled by the person before it finished.', `the synchronous dispatch ends with the cancel (${syncOut ? toolText(syncOut) : 'it hung'})`);
check(noticesFor(S.id).length === 0, 'a synchronous task is not announced');
await idle(w1.id);

// ---- S32.14: cancel and end in the same tick leave one final state and at most one notice ----
for (const by of [o1.id, null]) {
  const H = await send(o1.id, 'cx-w1', `hold:H${by ? 'o' : 'p'}`);
  await until(() => gates.has(`H${by ? 'o' : 'p'}`));
  release(`H${by ? 'o' : 'p'}`);
  const r = cancelTask(by, H.id);
  await idle(w1.id);
  await sleep(150);
  check(r.cancelled && row(H.id).status === 'cancelled' && noticesFor(H.id).length === (by ? 0 : 1), `the turn ending as it is cancelled (${by ? 'orchestrator' : 'person'}): one state, cancelled, and ${by ? 'no notice' : 'one notice'}`);
}
const twice = await send(o1.id, 'cx-w1', 'hold:Tw');
await until(() => gates.has('Tw'));
const [p1, p2] = await Promise.all([post(`/api/dispatches/${twice.id}/cancel`, {}), post(`/api/dispatches/${twice.id}/cancel`, {})]);
await idle(w1.id);
await sleep(150);
check([p1, p2].filter((p) => p.json.cancelled).length === 1 && noticesFor(twice.id).length === 1, 'two cancels at once: one of them cancels, and one message goes');
const late = await send(o1.id, 'cx-w1', 'say:quick');
await until(() => row(late.id).status === 'done');
const lateCancel = cancelTask(null, late.id);
await sleep(150);
check(!lateCancel.cancelled && lateCancel.status === 'done' && noticesFor(late.id).length === 1, 'a task that ended first stays done, announced once');

// ---- S32.12 and S32.13: the limit counts only unfinished tasks; dispatch_list shows exactly the caller's ----
const K = await send(o1.id, 'cx-w1', 'hold:K');
const held: string[] = [];
for (let i = 0; i < MAX_BACKGROUND; i++) held.push((await send(o2.id, 'cx-w2', `hold:L${i}`)).id);
const eleventh = await post('/api/dispatch', { from: o2.id, agent: 'cx-w2', task: 'say:one too many', background: true });
check(held.every(Boolean) && eleventh.status === 400, `with ${MAX_BACKGROUND} unfinished tasks the next one is refused`);
const listO2 = await post('/api/dispatch/list', { from: o2.id });
check(listO2.status === 200 && listO2.json.length === MAX_BACKGROUND && listO2.json.every((t: any) => held.includes(t.id)) && listO2.json[0].status === 'running' && listO2.json[1].status === 'queued' && listO2.json[0].agent === 'cx-w2', 'the list of an orchestrator has exactly its unfinished tasks, oldest first');
const listMcp = toolText(await rpc('tools/call', { name: 'dispatch_list', arguments: {} }));
check(listMcp.startsWith(`${K.id} · cx-w1 · running · background · `) && listMcp.includes('hold:K') && held.every((id) => !listMcp.includes(id)), `dispatch_list shows the caller's and not another orchestrator's (${listMcp.split('\n')[0]})`);
check(dispatches.recent(3).some((r) => r.id === K.id) && dispatches.recent(3).some((r) => r.id === held[0]), 'the dispatch log keeps unfinished tasks older than its row limit');
await post('/api/dispatch/cancel', { from: o2.id, id: held[MAX_BACKGROUND - 1] });
const accepted = await post('/api/dispatch', { from: o2.id, agent: 'cx-w2', task: 'say:now there is room', background: true });
check(accepted.status === 200 && !!accepted.json.id, 'after cancelling one of them, the next one is accepted');
for (const id of [...held].reverse()) await post('/api/dispatch/cancel', { from: o2.id, id });
await post('/api/dispatch/cancel', { from: o1.id, id: K.id });
await idle(w1.id); await idle(w2.id);
check(dispatches.unfinished(o2.id) === 0 && row(accepted.json.id).status === 'done' && calls.filter((c) => /^hold:L[1-9]/.test(c)).length === 0, 'cancelling the rest empties the queue: the queued ones never ran and the last one did');
check((await post('/api/dispatch/list', { from: o2.id })).json.length === 0 && toolText(await rpc('tools/call', { name: 'dispatch_list', arguments: {} })) === 'You have no delegated tasks that have not finished.', 'and the list is empty');

// ---- S32.10: restart; a cancelled task is not changed nor announced again, an unannounced cancel is announced once ----
await until(() => dispatches.recent(200).every((r) => r.status !== 'queued' && r.status !== 'running'));
await sleep(150);
const t10 = Date.now();
ins.run('r-told', o1.id, w1.id, 'w', 'cancelled', 'Cancelled by the person before it finished.', t10, t10, t10);
ins.run('r-untold', o1.id, w1.id, 'w', 'cancelled', 'Cancelled by the person before it finished.', t10, t10, null);
ins.run('r-running', o1.id, w1.id, 'w', 'running', null, t10, null, null);
const before10 = sent.length;
armDispatchNotices();
await until(() => sent.length >= before10 + 2);
await sleep(200);
check(row('r-told').status === 'cancelled' && row('r-told').finished_at === t10 && noticesFor('r-told').length === 0, 'after a restart an announced cancel is left alone and not announced');
check(noticesFor('r-untold').length === 1 && /finished \(cancelled\)/.test(noticesFor('r-untold')[0].web) && row('r-untold').status === 'cancelled', 'a cancel not announced yet is announced once');
check(row('r-running').status === 'interrupted' && noticesFor('r-running').length === 1, 'a running one is interrupted and announced once');
armDispatchNotices();
await sleep(300);
check(sent.length === before10 + 2, 'a second start announces nothing again');

// ---- S32.11: pruning treats a cancelled task as finished, but keeps one whose cancel nobody has had yet ----
const old = Date.now() - 400 * 86_400_000;
ins.run('p-told', o1.id, w1.id, 'w', 'cancelled', 'r', old, old, old);
ins.run('p-untold', o1.id, w1.id, 'w', 'cancelled', 'r', old, old, null);
const fill = db.prepare("INSERT INTO dispatches (id, from_id, to_id, task, status, created_at) VALUES (?,?,?,?,'done',?)");
for (let i = 0; i < KEEP_DISPATCHES + 20; i++) fill.run(`p-fill-${i}`, o1.id, w1.id, 'w', Date.now() + i);
retentionPass();
check(!dispatches.get('p-told') && !!dispatches.get('p-untold'), 'pruning removes an announced cancelled task and keeps one not announced nor read');

mcp.p.kill();
server.close();
setDeliveryForTests(null);
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
