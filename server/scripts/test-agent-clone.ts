// Cloning an agent and the notebook they share (no model): the clone copies the configuration and nothing that was done or attached, runs in
// parallel with its source, reads and writes the same notebook (each reader has its own `seen`), can separate from it, and deleting a reader
// keeps the notebook for the rest while deleting the last one removes it. The routes are tried over HTTP. Usage:
//   HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4488 npx tsx scripts/test-agent-clone.ts
import './_guard.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agents, colonies, db, skills } from '../src/db.js';
import '../src/index.js';
import { composeInstructions } from '../src/instructions.js';
import { liveTurn, sendTurn } from '../src/runtime.js';
import { runners } from '../src/providers/index.js';
import { NOTEBOOK_SKILL_ID, DEFAULT_SKILLS } from '../src/skills/defaults.js';
import { notebooks } from '../src/skills/notebook.js';
import { noteSource } from '../src/services/notebook.js';
import { cloneAgent, removeAgent } from '../src/services/agents.js';
import { connections } from '../src/connections/store.js';
import { createObject, setObjectManager } from '../src/objects/index.js';
import { objectsStore } from '../src/objects/store.js';

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const throws = (f: () => unknown, re?: RegExp) => { try { f(); return false; } catch (e) { return !re || re.test(e instanceof Error ? e.message : String(e)); } };
const API = `http://127.0.0.1:${process.env.HIVE_AM_PORT}`;
const call = async (method: string, path: string, body?: unknown) => { const r = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null) as any }; };
const nbRows = () => (db.prepare('SELECT COUNT(*) n FROM notebooks').get() as { n: number }).n;
const orphans = () => (db.prepare('SELECT COUNT(*) n FROM notebooks WHERE id NOT IN (SELECT notebook_id FROM notebook_readers)').get() as { n: number }).n;

skills.seedDefaults(DEFAULT_SKILLS);
const dir = mkdtempSync(join(tmpdir(), 'clone-'));
const colony = colonies.create({ name: 'clone-colony', color: '#2f8f5b', cwd: dir, permission: 'acceptEdits', system_prompt: '', skill_ids: [] } as any);
const other = colonies.create({ name: 'clone-other', color: '#555555', cwd: '', permission: 'acceptEdits', system_prompt: '', skill_ids: [] } as any);
const worker = agents.create({ name: 'helper', role: 'worker', provider: 'claude', model: '', cwd: dir } as any);
const src = agents.create({
  name: 'Maggie', description: 'Reviews pull requests', role: 'orchestrator', provider: 'opencode', model: 'opencode/some-model', system_prompt: 'Be careful.',
  permission: 'bypassPermissions', cwd: dir, colony_id: colony.id, overrides: ['permission'], skill_ids: [NOTEBOOK_SKILL_ID, 's-custom'].filter((id) => id !== 's-custom'),
  skill_loads: { [NOTEBOOK_SKILL_ID]: 'always' }, worker_ids: [worker.id],
} as any);

// Things the source has or is attached to, which a clone must NOT get.
agents.setSession(agents.get(src.id)!, 'src-session-1');
const conn = connections.create({ kind: 'telegram', name: 'clone-bot', agent_id: src.id, config: {}, allowed: [] });
db.prepare("INSERT INTO agent_wakeups (id, agent_id, due_at, note, created_at) VALUES ('w-src', ?, ?, 'ping', ?)").run(src.id, Date.now() + 3_600_000, Date.now());
const srv = createObject({ name: 'clone-server', kind: 'server', colony_id: colony.id, config: { cwd: dir, start: 'sleep 300' } });
setObjectManager(srv.id, src.id);
notebooks.save(src.id, '## Team\n- Valeria is on call', 'agent', true);
notebooks.markSeen(src.id, notebooks.get(src.id).version);

// ---- the clone copies the configuration ----
const c = cloneAgent(src.id, { name: 'Maggie 2' });
check(c.id !== src.id && c.name === 'Maggie 2' && c.status === 'idle' && c.session_id === null, 'the clone is its own agent, idle, with no conversation');
check(c.description === src.description && c.role === 'orchestrator' && c.provider === 'opencode' && c.model === 'opencode/some-model' && c.system_prompt === 'Be careful.' && c.permission === 'bypassPermissions' && c.cwd === dir, 'it copies description, role, provider, model, prompt, permission and folder');
check(c.colony_id === colony.id && JSON.stringify(c.overrides) === JSON.stringify(['permission']), 'it is in the source\'s colony by default and keeps its overrides');
check(c.skill_ids.includes(NOTEBOOK_SKILL_ID) && c.skill_loads[NOTEBOOK_SKILL_ID] === 'always', 'it copies the skills and how each one loads');
check(c.worker_ids.length === 1 && c.worker_ids[0] === worker.id, 'an orchestrator keeps its team');
const w = cloneAgent(worker.id, { name: 'helper 2' });
check(w.worker_ids.length === 0, 'a worker has no team to copy');

// ---- and nothing it did or is attached to ----
check(agents.sessions(c.id).length === 0 && (db.prepare('SELECT COUNT(*) n FROM agent_wakeups WHERE agent_id=?').get(c.id) as { n: number }).n === 0, 'no sessions and no wake-ups');
check(connections.get(conn.id)!.agent_id === src.id && connections.forAgent(c.id).length === 0, 'a channel keeps answering for the source only');
check(objectsStore.managers().get(srv.id) === src.id, 'a resource keeps its one manager');
check((db.prepare('SELECT COUNT(*) n FROM agent_schedules WHERE agent_id=?').get(c.id) as { n: number }).n === 0 && (db.prepare('SELECT COUNT(*) n FROM agent_watches WHERE agent_id=?').get(c.id) as { n: number }).n === 0, 'no schedules and no watches');
check(agents.get(src.id)!.session_id === 'src-session-1' && agents.get(src.id)!.worker_ids.length === 1, 'the source is untouched');

// ---- the colony, and what is refused ----
const moved = cloneAgent(src.id, { name: 'Maggie in other', colony_id: other.id });
check(moved.colony_id === other.id && moved.cwd === dir, 'the colony can be chosen, and the folder travels with the agent');
const none = cloneAgent(src.id, { name: 'Maggie nowhere', colony_id: '' });
check(none.colony_id === null, 'or none');
const before = agents.list().length;
check(throws(() => cloneAgent(src.id, { name: 'maggie 2' }), /already exists/), 'a repeated name is refused (any case)');
check(throws(() => cloneAgent(src.id, { name: '   ' }), /name/i) && throws(() => cloneAgent(src.id, {}), /name/i), 'so is an empty name');
check(throws(() => cloneAgent(src.id, { name: 'ghost colony', colony_id: 'nope' }), /colony/i), 'and a colony that does not exist');
const folderless = agents.create({ name: 'folderless', role: 'worker', provider: 'claude', model: '', cwd: '', colony_id: colony.id } as any);   // gets its folder from the colony
check(throws(() => cloneAgent(folderless.id, { name: 'no folder clone', colony_id: '' }), /folder/i) && !agents.byName('no folder clone'), 'a clone left with no folder is not created (nothing half-made)');
check(agents.list().length === before + 1 && orphans() === 0, 'and no agent or notebook is left over');
check(throws(() => cloneAgent('no-such-agent', { name: 'x' }), /not found/i), 'a missing source is a not-found');

// ---- the notebook is shared ----
check(notebooks.get(c.id).content === '## Team\n- Valeria is on call' && notebooks.get(c.id).version === notebooks.get(src.id).version, 'the clone reads the notebook of its source from its first turn');
check(notebooks.sharedWith(src.id).some((r) => r.id === c.id) && notebooks.sharedWith(c.id).some((r) => r.id === src.id) && notebooks.sharedWith(c.id).length === 3, 'each reader knows who else reads it');
check(notebooks.get(c.id).seen === 0 && notebooks.get(src.id).seen === notebooks.get(src.id).version, '`seen` is per reader: the clone has seen nothing, the source has seen it all');
notebooks.add(c.id, 'Infra', 'Staging runs on port 8443.', noteSource(c.id), true);
check(/port 8443/.test(notebooks.get(src.id).content), 'a note written by the clone is read by the source');
check(notebooks.get(c.id).seen === notebooks.get(c.id).version && notebooks.get(src.id).seen < notebooks.get(src.id).version, 'the writer\'s conversation has it, the other reader has not yet (it is sent the text on its next turn)');
check(/· Maggie 2$/.test(noteSource(c.id)) && /\(\d{4}-\d{2}-\d{2} · Maggie 2\)/.test(notebooks.get(src.id).content), 'in a shared notebook a note says which agent wrote it');
const stale = notebooks.get(src.id).version - 1;
check(throws(() => notebooks.rewrite(src.id, 'x', stale, true), /changed since you read it/) && throws(() => notebooks.rewrite(c.id, 'x', stale, true), /changed since you read it/), 'a rewrite against an old version is refused, for either');
notebooks.markSeen(src.id, notebooks.get(src.id).version);
check(notebooks.get(src.id).seen === notebooks.get(src.id).version, 'and markSeen moves only that reader');
check(/SHARED/.test(composeInstructions(agents.get(src.id)!)) && /Maggie 2/.test(composeInstructions(agents.get(src.id)!)) && !/SHARED/.test(composeInstructions(agents.get(worker.id)!)), 'the instructions tell the agent when its notebook is shared, and with whom');

// ---- they run in parallel ----
let running = 0, peak = 0;
runners.claude = runners.opencode = runners.kiro = async function* () { running++; peak = Math.max(peak, running); await sleep(400); running--; yield { t: 'text', delta: 'ok' }; yield { t: 'done', ok: true }; };
const t0 = Date.now();
const [r1, r2] = await Promise.all([sendTurn(src.id, 'one'), sendTurn(c.id, 'two')]);
check(r1.ok && r2.ok && peak === 2 && Date.now() - t0 < 750, `two clones hold a conversation at the same time (${Date.now() - t0} ms for two 400 ms turns)`);
const q0 = Date.now();
await Promise.all([sendTurn(src.id, 'a'), sendTurn(src.id, 'b')]);
check(Date.now() - q0 >= 780 && liveTurn(src.id) === null, 'while the turns of one agent still run one after another');

// ---- over HTTP ----
const hc = await call('POST', `/api/agents/${src.id}/clone`, { name: 'Maggie http' });
check(hc.status === 200 && hc.json.name === 'Maggie http' && hc.json.id !== src.id, 'POST /api/agents/:id/clone makes the clone');
check((await call('POST', `/api/agents/${src.id}/clone`, { name: 'Maggie http' })).status === 400, 'and a repeated name is a 400');
check((await call('POST', '/api/agents/nope/clone', { name: 'zzz' })).status === 404, 'a missing agent is a 404');
const nbv = await call('GET', `/api/agents/${src.id}/notebook`);
check(nbv.status === 200 && Array.isArray(nbv.json.shared_with) && nbv.json.shared_with.map((x: any) => x.name).includes('Maggie http') && /8443/.test(nbv.json.content), 'GET /api/agents/:id/notebook says who it is shared with');
check((await call('GET', `/api/agents/${worker.id}/notebook`)).json.shared_with.length === 1, 'an agent that was cloned reads as shared too');

// ---- separating ----
const sep = await call('POST', `/api/agents/${hc.json.id}/notebook/separate`);
check(sep.status === 200 && sep.json.shared_with.length === 0 && /8443/.test(sep.json.content), 'Separate gives the agent its own copy of the text');
notebooks.add(hc.json.id, 'Own', 'Only mine.', '2026-01-01', true);
check(!/Only mine/.test(notebooks.get(src.id).content) && !notebooks.sharedWith(src.id).some((r) => r.id === hc.json.id), 'and what it writes afterwards stays out of the shared one');
check(/8443/.test(notebooks.get(src.id).content) && notebooks.sharedWith(src.id).length === 3, 'which the rest keep reading');
check((await call('POST', `/api/agents/${hc.json.id}/notebook/separate`)).status === 200 && notebooks.get(hc.json.id).content.includes('Only mine'), 'separating an agent that shares nothing changes nothing');

// ---- deleting ----
const sharedText = notebooks.get(src.id).content, sharedSeen = notebooks.get(src.id).seen, sharedVersion = notebooks.get(src.id).version;
removeAgent(c.id);
check(notebooks.get(src.id).content === sharedText && notebooks.get(src.id).seen === sharedSeen && notebooks.get(src.id).version === sharedVersion, 'deleting a clone keeps the notebook for the others, with its text, version and their `seen`');
check(notebooks.sharedWith(src.id).every((r) => r.id !== c.id) && orphans() === 0, 'and it stops being a reader');
removeAgent(src.id);
check(notebooks.get(moved.id).content === sharedText && notebooks.sharedWith(moved.id).length >= 1, 'deleting the source keeps the notebook for the clones, which keep working');
check((await sendTurn(moved.id, 'still here')).ok, 'a clone whose source is gone still runs a turn');
const remaining = notebooks.sharedWith(moved.id).map((r) => r.id);
for (const id of [moved.id, ...remaining]) removeAgent(id);
check(orphans() === 0, 'deleting the last reader removes the notebook: no orphan rows are left');
check(nbRows() === (db.prepare('SELECT COUNT(DISTINCT notebook_id) n FROM notebook_readers').get() as { n: number }).n, 'every notebook still in the table has at least one reader');
// An agent that never shared anything: deleting it still takes its notebook with it, as before.
const solo = agents.create({ name: 'solo', role: 'worker', provider: 'claude', model: '', cwd: dir } as any);
notebooks.add(solo.id, 'Mine', 'Just me.', '', true);
const n0 = nbRows();
removeAgent(solo.id);
check(nbRows() === n0 - 1 && orphans() === 0, 'an agent that never shared anything takes its notebook with it');

// ---- clearing is for everybody ----
const a1 = agents.create({ name: 'p1', role: 'worker', provider: 'claude', model: '', cwd: dir } as any);
notebooks.add(a1.id, 'S', 'Shared note.', '', true);
const a2 = cloneAgent(a1.id, { name: 'p2' });
const wipe = await call('PUT', `/api/agents/${a2.id}/notebook`, { content: '' });
check(wipe.status === 200 && notebooks.get(a1.id).content === '', 'clearing the notebook empties it for every reader');

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
