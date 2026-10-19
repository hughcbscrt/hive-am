// What an agent can do with colony objects, through the real MCP script and the real HTTP API (no model): the tools exist only with the
// "Colony objects" skill, an agent sees only the objects of its own colony, read-only agents cannot act, and nothing can be created or
// changed. Usage:
//   HIVE_AM_OBJECT_POLL_MS=60000 HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4482 npx tsx scripts/test-object-tools.ts
import './_guard.js';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agents, colonies, skills } from '../src/db.js';
import '../src/index.js';
import { composeInstructions, mcpCaps } from '../src/instructions.js';
import { DATABASES_SKILL_ID, DEFAULT_SKILLS, OBJECTS_SKILL_ID } from '../src/skills/defaults.js';
import Database from 'better-sqlite3';
import { createObject, removeObject, setAgentObjects, setObjectManager, stateOf } from '../src/objects/index.js';
import { objectsStore } from '../src/objects/store.js';

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => Promise<boolean> | boolean, ms = 10000) => { for (let t = 0; t < ms; t += 150) { if (await cond()) return true; await sleep(150); } return false; };

skills.seedDefaults(DEFAULT_SKILLS);
const dir = mkdtempSync(join(tmpdir(), 'objtools-'));
const colony = colonies.create({ name: 'tools-colony', color: '#2f8f5b', cwd: dir, permission: 'acceptEdits', system_prompt: '', skill_ids: [] } as any);
const mk = (name: string, o: Record<string, unknown>) => agents.create({ name, role: 'worker', provider: 'claude', model: '', cwd: dir, permission: 'acceptEdits', ...o } as any);
const manager = mk('manager', { colony_id: colony.id, skill_ids: [OBJECTS_SKILL_ID] });
const loner = mk('loner', { skill_ids: [OBJECTS_SKILL_ID] });                       // no colony
const reader = mk('reader', { colony_id: colony.id, permission: 'plan', skill_ids: [OBJECTS_SKILL_ID] });
const plain = mk('plain', { colony_id: colony.id });                                // no skill

const mine = createObject({ name: 'colony-job', kind: 'server', colony_id: colony.id, config: { cwd: dir, start: 'sleep 300' } });
const free = createObject({ name: 'free-job', kind: 'server', config: { cwd: dir, start: 'sleep 300' } });

/** One MCP session over stdio, as an agent's CLI would run it. */
function session(agentId: string, caps: string) {
  const child = spawn('node', [join(import.meta.dirname, '..', 'mcp', 'dispatch.mjs')], { env: { ...process.env, HIVE_AGENT_ID: agentId, HIVE_CAPS: caps, HIVE_AM_API: `http://127.0.0.1:${process.env.HIVE_AM_PORT}` }, stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = ''; const waiting = new Map<number, (m: any) => void>(); let n = 0;
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); waiting.get(m.id)?.(m); } catch { /* not json */ } } });
  const rpc = (method: string, params?: unknown) => new Promise<any>((res) => { const id = ++n; waiting.set(id, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  return {
    tools: async () => (await rpc('tools/list')).result.tools.map((t: any) => t.name) as string[],
    call: async (name: string, args: Record<string, unknown> = {}) => { const r = (await rpc('tools/call', { name, arguments: args })).result; return { err: !!r.isError, text: r.content[0].text as string }; },
    close: () => child.kill(),
  };
}

check(mcpCaps(manager).includes('objects') && !mcpCaps(plain).includes('objects'), 'only agents with the skill get the objects tools');
check(/object_list/.test(composeInstructions(manager)) && !/object_list/.test(composeInstructions(plain)), 'and are told about them in their instructions');
check(/read-only/.test(composeInstructions(reader)), 'a read-only agent is told it cannot act');

const m = session(manager.id, 'objects');
const names = await m.tools();
check(['object_list', 'object_logs', 'object_action'].every((x) => names.includes(x)) && names.length === 3, 'the MCP script offers exactly the three object tools');
check(!names.some((x) => /create|delete|update|edit/.test(x)), 'there is no tool to create, edit or delete objects');

const l1 = await m.call('object_list');
check(!l1.err && l1.text.includes('colony-job') && !l1.text.includes('free-job'), 'a manager sees the objects of its colony and not the others');
const l2 = session(loner.id, 'objects'); const lr = await l2.call('object_list');
check(lr.text.includes('free-job') && !lr.text.includes('colony-job'), 'an agent with no colony sees the objects that have none');

const x = await m.call('object_action', { name: 'free-job', action: 'start' });
check(x.err && /no resource named/.test(x.text), 'acting on an object of another colony is refused, as if it did not exist');
const bad = await m.call('object_action', { name: 'colony-job', action: 'delete' });
check(bad.err && /start, stop or restart/.test(bad.text), 'an unknown action is refused');

const s = await m.call('object_action', { name: 'COLONY-JOB', action: 'start' });
check(!s.err && /colony-job: (running|starting)/.test(s.text), 'start works (names are case-insensitive)');
check(await until(async () => (await stateOf(objectsStore.get(mine.id)!)).status === 'running'), 'and the object is really running');
const lg = await m.call('object_logs', { name: 'colony-job', tail: 20 });
check(!lg.err && lg.text.includes('manager asked to start'), 'the log says which agent asked for it');
const l3 = await m.call('object_list');
check(/colony-job · server · running/.test(l3.text), 'the list shows the new state');

const rd = session(reader.id, 'objects');
const rl = await rd.call('object_list'); const rlog = await rd.call('object_logs', { name: 'colony-job' });
check(!rl.err && !rlog.err, 'a read-only agent can list and read logs');
const ra = await rd.call('object_action', { name: 'colony-job', action: 'stop' });
check(ra.err && /read-only/.test(ra.text), 'but not stop anything');
check((await stateOf(objectsStore.get(mine.id)!)).status === 'running', 'and the object is still running');

const pl = session(plain.id, 'objects'); const pr = await pl.call('object_list');
check(pr.err && /skill/.test(pr.text), 'an agent without the skill is refused even if it reaches the tools');
const ghost = session('no-such-agent', 'objects'); check((await ghost.call('object_list')).err, 'and so is an unknown agent');

// Choosing the manager: one agent, even from another colony or without the skill (it gets the skill); the colony's agents then step aside.
const link = setObjectManager(mine.id, plain.id);
check(link.skillAdded && agents.get(plain.id)!.skill_ids.includes(OBJECTS_SKILL_ID), 'choosing an agent without the skill as manager gives it the skill');
check(objectsStore.managers().get(mine.id) === plain.id, 'the manager is stored (one per resource)');
check(!(await m.call('object_list')).text.includes('colony-job'), 'the other agents of the colony no longer see it');
const lk = session(plain.id, 'objects'); const lkr = await lk.call('object_list');
check(lkr.text.includes('colony-job'), 'the chosen manager sees it');
check(!(await lk.call('object_action', { name: 'colony-job', action: 'restart' })).err, 'and can act on it');
setObjectManager(mine.id, loner.id);
check(!(await lk.call('object_list')).text.includes('colony-job') && (await l2.call('object_list')).text.includes('colony-job'), 'changing the manager moves it to the new one (even from another colony)');
setAgentObjects(loner.id, []);
check(objectsStore.managers().get(mine.id) === undefined && (await m.call('object_list')).text.includes('colony-job') && !(await l2.call('object_list')).text.includes('colony-job'), 'with none chosen it goes back to the agents of its colony');
setAgentObjects(manager.id, [mine.id, free.id]);
check(objectsStore.managers().get(free.id) === manager.id, 'from the agent side: the resources it looks after are set');
setAgentObjects(manager.id, [mine.id]);
check(objectsStore.managers().get(free.id) === undefined && objectsStore.managers().get(mine.id) === manager.id, 'and removing one sends it back to its colony');
setObjectManager(mine.id, null);
lk.close();

const st = await m.call('object_action', { name: 'colony-job', action: 'stop' });
check(!st.err && /stopped/.test(st.text), 'stop works');
const r1 = await m.call('object_action', { name: 'colony-job', action: 'restart' });
check(!r1.err && await until(async () => (await stateOf(objectsStore.get(mine.id)!)).status === 'running'), 'restart works');

// A database can be given a manager too: the agent gets the "Database management" skill (not the other one), and starting or stopping it is still refused.
const dbFile = join(dir, 'tools.db'); new Database(dbFile).close();
const dbo = createObject({ name: 'tools-db', kind: 'database', colony_id: colony.id, config: { engine: 'sqlite', file: dbFile } });
check((await m.call('object_list')).text.includes('tools-db · database'), 'a database shows in object_list with its state');
const ba = await m.call('object_action', { name: 'tools-db', action: 'start' });
check(ba.err && /not started or stopped/.test(ba.text), 'object_action still refuses to start or stop a database');
const dbMgr = mk('db-manager', { colony_id: colony.id });
const dl = setObjectManager(dbo.id, dbMgr.id);
check(dl.skillAdded && agents.get(dbMgr.id)!.skill_ids.includes(DATABASES_SKILL_ID) && !agents.get(dbMgr.id)!.skill_ids.includes(OBJECTS_SKILL_ID), 'a database can be given a manager, which gets the Database management skill and not Colony resources');
check(objectsStore.managers().get(dbo.id) === dbMgr.id, 'and the manager is stored');
setAgentObjects(dbMgr.id, [dbo.id, mine.id]);
check(agents.get(dbMgr.id)!.skill_ids.includes(OBJECTS_SKILL_ID) && agents.get(dbMgr.id)!.skill_ids.includes(DATABASES_SKILL_ID), 'from the agent side, a mix of a server and a database gives both skills');
setObjectManager(dbo.id, null); setObjectManager(mine.id, null);
await removeObject(dbo.id);

for (const c of [m, l2, rd, pl, ghost]) c.close();
await removeObject(mine.id); await removeObject(free.id);
console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
