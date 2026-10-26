// What an agent with the "Colony builder" skill can do, through the real MCP script and the real HTTP API (no model): the `colony_*` tools exist only
// with the skill (its own or its colony's), they create, read, change and delete colonies, agents and resources of any colony with the checks of the
// web app, no secret goes out or comes in, read-only agents only look, deleting needs the exact name, and no change can cut off the caller's own access.
// Usage:
//   HIVE_AM_OBJECT_POLL_MS=60000 HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4486 npx tsx scripts/test-colony-tools.ts
import './_guard.js';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agents, colonies, db, dispatches, skills } from '../src/db.js';
import '../src/index.js';
import { connections } from '../src/connections/store.js';
import { composeInstructions, mcpCaps } from '../src/instructions.js';
import { bus } from '../src/runtime.js';
import { COLONIES_SKILL_ID, DATABASES_SKILL_ID, DEFAULT_SKILLS, NOTEBOOK_SKILL_ID, OBJECTS_SKILL_ID } from '../src/skills/defaults.js';
import { objectsStore } from '../src/objects/store.js';
import type { DatabaseConfig, HttpConfig, ServerConfig } from '../src/objects/model.js';

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const eq = (a: unknown, b: unknown, what: string) => { const ok = JSON.stringify(a) === JSON.stringify(b); check(ok, what); if (!ok) console.log('   got', JSON.stringify(a), '\n   want', JSON.stringify(b)); };
const API = `http://127.0.0.1:${process.env.HIVE_AM_PORT}`;
const TOOLS = ['colony_options', 'colony_list', 'colony_get', 'colony_create', 'colony_update', 'colony_delete', 'colony_agent_list', 'colony_agent_get', 'colony_agent_create',
  'colony_agent_update', 'colony_agent_delete', 'colony_skill_list', 'colony_resource_list', 'colony_resource_get', 'colony_resource_create', 'colony_resource_update',
  'colony_resource_delete', 'colony_resource_manager'];

skills.seedDefaults(DEFAULT_SKILLS);
const root = mkdtempSync(join(tmpdir(), 'colonytools-'));
const dir = (n: string) => { const d = join(root, n); mkdirSync(d, { recursive: true }); return d; };
const home = colonies.create({ name: 'Home', cwd: dir('home'), permission: 'acceptEdits', system_prompt: 'home rules', skill_ids: [] } as any);
const lending = colonies.create({ name: 'Lending', cwd: dir('lending'), permission: 'acceptEdits', system_prompt: '', skill_ids: [COLONIES_SKILL_ID] } as any);
const mk = (name: string, o: Record<string, unknown>) => agents.create({ name, role: 'worker', provider: 'claude', model: '', cwd: '', permission: 'acceptEdits', ...o } as any);
const builder = mk('Builder', { colony_id: home.id, skill_ids: [COLONIES_SKILL_ID, NOTEBOOK_SKILL_ID] });
const heir = mk('Heir', { colony_id: lending.id });                                          // the skill comes from its colony
const reader = mk('Reader', { cwd: dir('reader'), permission: 'plan', skill_ids: [COLONIES_SKILL_ID] });
const plain = mk('Plain', { cwd: dir('plain') });

/** One MCP session over stdio, as an agent's CLI would run it. */
function session(agentId: string, caps: string) {
  const child = spawn('node', [join(import.meta.dirname, '..', 'mcp', 'dispatch.mjs')], { env: { ...process.env, HIVE_AGENT_ID: agentId, HIVE_CAPS: caps, HIVE_AM_API: API }, stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = ''; const waiting = new Map<number, (m: any) => void>(); let n = 0;
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); waiting.get(m.id)?.(m); } catch { /* not json */ } } });
  const rpc = (method: string, params?: unknown) => new Promise<any>((res) => { const id = ++n; waiting.set(id, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  return {
    tools: async () => (await rpc('tools/list')).result.tools.map((t: any) => t.name) as string[],
    call: async (name: string, args: Record<string, unknown> = {}) => { const r = (await rpc('tools/call', { name, arguments: args })).result; return { err: !!r.isError, text: r.content[0].text as string }; },
    close: () => child.kill(),
  };
}
const api = async (op: string, body: Record<string, unknown>) => { const r = await fetch(`${API}/api/agent-colonies/${op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json() as any }; };
/** Everything a change could touch, to prove a refused change left it exactly as it was. */
const snapshot = () => JSON.stringify({ a: agents.list(), c: colonies.list(), w: db.prepare('SELECT * FROM assignments ORDER BY orchestrator_id, worker_id').all() });
const events: string[] = [];
bus.on('msg', (m: { kind: string }) => { if (m.kind === 'agents_changed' || m.kind === 'objects_changed') events.push(m.kind); });
const emitted = async (kind: string, run: () => Promise<unknown>) => { events.length = 0; await run(); return events.includes(kind); };

// ---- 1, 2: the capability, the tools and the skill --------------------------------------------------------------------------------------
check(mcpCaps(agents.get(builder.id)!).includes('colonies'), 'an agent with the skill of its own gets the colonies capability');
check(mcpCaps({ ...agents.get(heir.id)!, skill_ids: agents.get(heir.id)!.effective.skill_ids }).includes('colonies'), 'and so does one that inherits it from its colony');
check(!mcpCaps(agents.get(plain.id)!).includes('colonies'), 'an agent without it does not');
const withCap = session(builder.id, 'colonies'), without = session(builder.id, 'memory,objects,databases,wake,dispatch');
eq((await withCap.tools()).sort(), [...TOOLS].sort(), 'with the capability the MCP offers exactly the 18 colony tools');
check(!(await without.tools()).some((t) => t.startsWith('colony_')), 'without it there is no colony_* tool');
check(!(await withCap.tools()).some((t) => /connection|telegram|slack/.test(t)), 'no tool reaches chat connections');
without.close();

const def = DEFAULT_SKILLS.find((s) => s.slug === 'colonies');
check(!!def && def.name === 'Colony builder' && def.load === 'on_demand' && skills.get(COLONIES_SKILL_ID)?.name === 'Colony builder', 'the default skill "Colony builder" (default-colonies, on demand) is seeded');
const before = skills.list().length; skills.seedDefaults(DEFAULT_SKILLS);
check(skills.list().length === before, 'seeding again adds nothing');
skills.update('default-git-workflow', { content: 'edited by the person' });
db.prepare("DELETE FROM seeded_skills WHERE slug='colonies'").run(); db.prepare('DELETE FROM agent_skills WHERE skill_id=?').run(COLONIES_SKILL_ID);
const keep = db.prepare('SELECT * FROM agent_skills').all();
db.prepare('DELETE FROM colony_skills WHERE skill_id=?').run(COLONIES_SKILL_ID); db.prepare('DELETE FROM skills WHERE id=?').run(COLONIES_SKILL_ID);
skills.seedDefaults(DEFAULT_SKILLS);
check(!!skills.get(COLONIES_SKILL_ID) && skills.get('default-git-workflow')!.content === 'edited by the person', 'an existing install gets the new skill at start without touching the others');
eq(db.prepare('SELECT * FROM agent_skills').all(), keep, 'and without assigning it to anyone');
agents.setSkills(builder.id, [COLONIES_SKILL_ID, NOTEBOOK_SKILL_ID]); agents.setSkills(reader.id, [COLONIES_SKILL_ID]); colonies.setSkills(lending.id, [COLONIES_SKILL_ID]);
const ins = composeInstructions({ ...agents.get(builder.id)!, skill_ids: agents.get(builder.id)!.effective.skill_ids, skill_loads: agents.get(builder.id)!.effective.skill_loads });
check(/## Colony builder/.test(ins) && TOOLS.every((t) => ins.includes(`mcp__hive__${t}`)), 'the instructions name every colony tool for Claude');
check(composeInstructions({ ...agents.get(builder.id)!, provider: 'opencode' }).includes('tools.hive.colony_agent_create'), 'and by the name each provider uses');
check(!/## Colony builder/.test(composeInstructions(agents.get(plain.id)!)), 'an agent without the skill is not told about them');

// ---- 15: the text of the skill ----------------------------------------------------------------------------------------------------------
const txt = def!.content;
for (const h of ['Before you create anything', 'The colony prompt', 'One prompt per role', 'Skills per role', 'Names', 'Linking workers', 'Resources', 'Changing things carefully', 'Deleting (confirmation)', 'Checking the result', 'What never to do', 'Tool reference']) check(txt.includes(`## ${h}`), `the skill has the section "${h}"`);
check(TOOLS.every((t) => txt.includes(`\`${t}\``)), 'the skill names every real tool');
check(/Role - Name - ACRONYM/.test(txt) && /never talks to another worker/.test(txt) && /explicit yes/.test(txt), 'it covers names, workers that do not talk to each other and the explicit yes');
check(!/\u2014/.test(txt + def!.description) && !/\b(AI|Anthropic)\b/.test(txt), 'it has no long dash and no AI attribution');

// ---- 3: who may call ---------------------------------------------------------------------------------------------------------------------
const nobody = await api('create', { from: 'no-such-agent', name: 'Ghost' });
check(nobody.status === 400 && nobody.j.error === 'You do not have the "Colony builder" skill.', 'an unknown agent is refused with 400');
const noskill = await api('create', { from: plain.id, name: 'Ghost' });
check(noskill.status === 400 && noskill.j.error === 'You do not have the "Colony builder" skill.' && !colonies.list().some((c) => c.name === 'Ghost'), 'an agent without the skill is refused and nothing is created');
check((await api('list', { from: plain.id })).status === 400, 'even to read');
// A page of another origin cannot use them (the API answers any origin); a simple text/plain request has no preflight to stop it.
const evil = await fetch(`${API}/api/agent-colonies/resource_create`, { method: 'POST', headers: { origin: 'http://evil.example', 'content-type': 'text/plain' }, body: JSON.stringify({ from: builder.id, name: 'pwned', kind: 'server', config: { cwd: root, start: 'touch /tmp/pwned' } }) });
check(evil.status === 403 && ((await evil.json()) as any).error === 'Colonies can only be changed from the local app' && !objectsStore.byName('pwned'), 'a request from another origin gets 403 and creates nothing');
const evilRead = await fetch(`${API}/api/agent-colonies/list`, { method: 'POST', headers: { origin: 'http://evil.example', 'content-type': 'text/plain' }, body: JSON.stringify({ from: builder.id }) });
check(evilRead.status === 403, 'not even a read');

const b = withCap;
// ---- options -----------------------------------------------------------------------------------------------------------------------------
const op = await b.call('colony_options', { provider: 'claude' });
check(!op.err && /"opus"/.test(op.text) && /"high"/.test(op.text) && /bypassPermissions/.test(op.text) && /cluster/.test(op.text), 'colony_options lists models, effort levels, permissions and resource kinds');

// ---- 4: colonies -------------------------------------------------------------------------------------------------------------------------
const folio = dir('folio');
check(await emitted('agents_changed', async () => {
  const c = await b.call('colony_create', { name: 'Folio', color: '#123456', cwd: folio, permission: 'acceptEdits', system_prompt: 'Folio rules', skills: [{ name: 'Notebook', load: 'always' }, { name: 'Code review', load: 'on_demand' }], inherit: { prompt: false } });
  check(!c.err && /Created the colony "Folio"/.test(c.text), 'colony_create creates a colony that is not the caller\'s');
}), 'and the web is told (agents_changed)');
const folioC = colonies.list().find((c) => c.name === 'Folio')!;
eq([folioC.cwd, folioC.permission, folioC.system_prompt, folioC.inherit.prompt, folioC.inherit.cwd, folioC.skill_loads['default-code-review']], [folio, 'acceptEdits', 'Folio rules', false, true, 'on_demand'], 'with folder, permission, prompt, inherit and skills with their load');
check((await b.call('colony_list')).text.includes('Folio · '), 'colony_list shows it');
const g = await b.call('colony_get', { name: 'folio' });
check(!g.err && /Folio rules/.test(g.text) && /"on_demand"/.test(g.text), 'colony_get shows it in full (names are case-insensitive)');
await b.call('colony_update', { name: 'Folio', color: '#654321' });
const fu = colonies.get(folioC.id)!;
eq([fu.color, fu.system_prompt, fu.skill_ids.length], ['#654321', 'Folio rules', 2], 'colony_update changes only what is sent');
await b.call('colony_update', { name: 'Folio', new_name: 'Folio Two' });
check(colonies.get(folioC.id)!.name === 'Folio Two', 'and can rename it');

// ---- 5: agents ---------------------------------------------------------------------------------------------------------------------------
const devDir = dir('dev');
const ca = await b.call('colony_agent_create', {
  name: 'Developer - Ana - FOLIO', description: 'Implements. Does not review.', provider: 'claude', model: 'sonnet', effort: 'high', permission: 'bypassPermissions',
  cwd: devDir, system_prompt: 'You are Ana.', browser: true, colony: 'Folio Two', overrides: ['cwd'], skills: [{ name: 'Git workflow', load: 'always' }, { name: 'Running tests', load: 'on_demand' }],
});
check(!ca.err && /Created the agent "Developer - Ana - FOLIO"/.test(ca.text), 'colony_agent_create creates a worker with every field');
const ana = agents.byName('Developer - Ana - FOLIO')!;
eq([ana.provider, ana.model, ana.effort, ana.permission, ana.cwd, ana.system_prompt, ana.browser, ana.colony_id, ana.overrides, ana.skill_loads['default-running-tests'], ana.role],
  ['claude', 'sonnet', 'high', 'bypassPermissions', devDir, 'You are Ana.', true, folioC.id, ['cwd'], 'on_demand', 'worker'], 'every field is stored as given (Full access too)');
const boss = await b.call('colony_agent_create', { name: 'Orchestrator - Leo - FOLIO', role: 'orchestrator', provider: 'claude', colony: 'Folio Two', workers: ['Developer - Ana - FOLIO'] });
const leo = agents.byName('Orchestrator - Leo - FOLIO')!;
check(!boss.err && leo.worker_ids.includes(ana.id) && leo.effective.cwd === folio, 'an orchestrator is created with its workers, inheriting the colony folder');
const wk = await b.call('colony_agent_update', { name: 'Developer - Ana - FOLIO', workers: ['Builder'] });
check(wk.err && /Only an orchestrator has workers/.test(wk.text), 'a worker cannot be given workers');
const ag = await b.call('colony_agent_get', { name: 'developer - ana - folio' });
check(!ag.err && /"effective"/.test(ag.text) && /You are Ana/.test(ag.text) && /Orchestrator - Leo - FOLIO/.test(ag.text) && !/session_id|instr_hash/.test(ag.text), 'colony_agent_get shows it in full, without session ids');
check((await b.call('colony_agent_list', { colony: 'Folio Two' })).text.split('\n').filter((l) => l.includes(' · ')).length === 2, 'colony_agent_list filters by colony');
const snapAna = agents.get(ana.id)!;
await b.call('colony_agent_update', { name: 'Developer - Ana - FOLIO', description: 'Implements and tests.' });
const ana2 = agents.get(ana.id)!;
eq([ana2.description, ana2.skill_ids, ana2.skill_loads, ana2.overrides, ana2.permission, ana2.effort, ana2.system_prompt], ['Implements and tests.', snapAna.skill_ids, snapAna.skill_loads, snapAna.overrides, snapAna.permission, snapAna.effort, snapAna.system_prompt], 'changing one field leaves skills, overrides and the rest as they were');
await b.call('colony_agent_update', { name: 'Orchestrator - Leo - FOLIO', description: 'Leads Folio.' });
check(agents.get(leo.id)!.worker_ids.includes(ana.id), 'and an orchestrator keeps its workers when they are not sent');
await b.call('colony_agent_update', { name: 'Developer - Ana - FOLIO', skills: [{ name: 'Running tests', load: 'always' }] });
eq(agents.get(ana.id)!.skill_loads, { 'default-running-tests': 'always' }, 'skills replace the list and can change their load');

// ---- 7: the checks of the web app --------------------------------------------------------------------------------------------------------
const errOf = async (tool: string, args: Record<string, unknown>) => { const r = await b.call(tool, args); return r.err ? r.text : `(no error) ${r.text.slice(0, 80)}`; };
check(/A colony named "folio two" already exists/.test(await errOf('colony_create', { name: 'folio two' })), 'a colony name taken with other case is refused');
check(/An agent named "developer - ana - folio" already exists/.test(await errOf('colony_agent_create', { name: 'developer - ana - folio', provider: 'claude', cwd: devDir })), 'an agent name taken with other case is refused');
check(/Folder does not exist/.test(await errOf('colony_agent_create', { name: 'X1', provider: 'claude', cwd: '/no/such/folder' })), 'a folder that does not exist is refused');
check(/Unknown provider/.test(await errOf('colony_agent_create', { name: 'X2', provider: 'gpt', cwd: devDir })), 'an unknown provider is refused');
check(/effort must be empty or one of/.test(await errOf('colony_agent_create', { name: 'X3', provider: 'claude', cwd: devDir, effort: 'turbo' })), 'an effort the model does not take is refused');
check(/There is no colony named "Nowhere"/.test(await errOf('colony_agent_create', { name: 'X4', provider: 'claude', cwd: devDir, colony: 'Nowhere' })), 'a colony that does not exist is refused');
check(/Choose a working folder/.test(await errOf('colony_agent_create', { name: 'X5', provider: 'claude' })), 'an agent with no folder of its own and none inherited is refused');
check(!['X1', 'X2', 'X3', 'X4', 'X5'].some((n) => agents.byName(n)), 'and none of them was created');
const linked = mk('Linked', { colony_id: folioC.id });
const conn = connections.create({ kind: 'telegram', name: 'tg-linked', agent_id: linked.id, config: { token: 'never-shown' } });
let snap = snapshot();
check(/linked to an external connection/.test(await errOf('colony_agent_update', { name: 'Linked', permission: 'plan', overrides: ['permission'] })), 'Plan mode for an agent with a connection is refused');
check(/linked to an external connection/.test(await errOf('colony_update', { name: 'Folio Two', permission: 'plan' })), 'and so is a colony that would lend it Plan mode');
eq(snapshot(), snap, 'and both are rolled back whole');

// ---- 6, 8, 9: resources of another colony, without secrets -------------------------------------------------------------------------------
const SENTINEL = 'sentinel-s3cr3t-value';
const web = async (path: string, method: string, body: unknown) => { const r = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return r.json() as any; };
const pg = await web('/api/objects', 'POST', { name: 'pg-folio', kind: 'database', colony_id: folioC.id, config: { engine: 'postgresql', host: '127.0.0.1', user: 'app', password: SENTINEL, database: 'folio' } });
await web('/api/objects', 'POST', { name: 'http-folio', kind: 'http', colony_id: folioC.id, config: { folder: dir('http'), variables: { dev: { token: { value: SENTINEL, secret: true }, base: { value: 'http://x' } } } } });
const sv = await b.call('colony_resource_create', { name: 'web-folio', kind: 'server', colony: 'Folio Two', config: { cwd: devDir, start: 'sleep 300', env: { API_KEY: SENTINEL, MODE: 'dev' }, port: 4999 } });
check(!sv.err && !sv.text.includes(SENTINEL) && /"API_KEY": "\*\*\*"/.test(sv.text), 'colony_resource_create makes a server in another colony, its env values hidden in the answer');
const dk = await b.call('colony_resource_create', { name: 'box-folio', kind: 'docker', colony: 'Folio Two', config: { mode: 'container', image: 'nginx:alpine', ports: ['18080:80'], env: { DB_PASS: SENTINEL } } });
check(!dk.err && !dk.text.includes(SENTINEL), 'a Docker container too');
const dbFile = join(root, 'folio.db');
const sq = await b.call('colony_resource_create', { name: 'sqlite-folio', kind: 'database', colony: 'Folio Two', config: { engine: 'sqlite', file: dbFile } });
check(!sq.err && objectsStore.byName('sqlite-folio')?.kind === 'database', 'a SQLite database');
const ht = await b.call('colony_resource_create', { name: 'api-folio', kind: 'http', colony: 'Folio Two', config: { folder: dir('http2'), variables: { dev: { base: { value: 'http://localhost' } } } } });
check(!ht.err && objectsStore.byName('api-folio')?.kind === 'http', 'an HTTP folder');
const cl = await b.call('colony_resource_create', { name: 'stack-folio', kind: 'cluster', colony: 'Folio Two', config: { members: ['web-folio', 'box-folio'] } });
check(!cl.err && /"web-folio"/.test(cl.text) && (objectsStore.byName('stack-folio')!.config as { members: string[] }).members.length === 2, 'and a cluster of them, by name');
const rl = await b.call('colony_resource_list', { colony: 'Folio Two' });
check(['pg-folio', 'http-folio', 'web-folio', 'box-folio', 'sqlite-folio', 'api-folio', 'stack-folio'].every((n) => rl.text.includes(n)) && !rl.text.includes(SENTINEL), 'colony_resource_list shows the resources of any colony, no secret');
let leaked = false;
for (const n of ['pg-folio', 'http-folio', 'web-folio', 'box-folio']) { const r = await b.call('colony_resource_get', { name: n }); if (r.err || r.text.includes(SENTINEL)) leaked = true; }
check(!leaked, 'colony_resource_get never shows a password, a secret variable or an env value');
const pgGet = await b.call('colony_resource_get', { name: 'pg-folio' });
check(/"passwordSet": true/.test(pgGet.text) && /"password": ""/.test(pgGet.text), 'a database says only that it has a password');
for (const t of ['colony_agent_get', 'colony_agent_list']) { const r = await b.call(t, { name: 'Linked' }); if (r.text.includes('never-shown')) leaked = true; }
check(!leaked, 'and no connection token is shown');

const pw = await b.call('colony_resource_create', { name: 'pg-two', kind: 'database', colony: 'Folio Two', config: { engine: 'postgresql', host: '127.0.0.1', password: 'p' } });
check(pw.err && /Set secrets in the web app/.test(pw.text) && !objectsStore.byName('pg-two'), 'a password is refused as input and nothing is saved');
const hs = await b.call('colony_resource_create', { name: 'http-two', kind: 'http', config: { folder: root, variables: { dev: { key: { value: 'k', secret: true } } } } });
check(hs.err && /Set secrets in the web app/.test(hs.text) && !objectsStore.byName('http-two'), 'and so is a secret HTTP variable');
const pwu = await b.call('colony_resource_update', { name: 'pg-folio', config: { password: 'new' } });
check(pwu.err && /Set secrets/.test(pwu.text) && (objectsStore.byName('pg-folio')!.config as DatabaseConfig).password === SENTINEL, 'also when updating');
const pgu = await b.call('colony_resource_update', { name: 'pg-folio', config: { maxRows: 50 } });
const pgRaw = objectsStore.byName('pg-folio')!.config as DatabaseConfig;
check(!pgu.err && pgRaw.maxRows === 50 && pgRaw.password === SENTINEL && pgRaw.user === 'app', 'updating one key keeps the rest and the saved password');
const htu = await b.call('colony_resource_update', { name: 'http-folio', config: { env: 'dev' } });
check(!htu.err && (objectsStore.byName('http-folio')!.config as HttpConfig).variables!.dev.token.value === SENTINEL, 'and the saved secret variables');
await b.call('colony_resource_update', { name: 'web-folio', config: { env: { API_KEY: '***', MODE: 'prod' } } });
eq((objectsStore.byName('web-folio')!.config as ServerConfig).env, { API_KEY: SENTINEL, MODE: 'prod' }, 'an env value sent back as *** keeps the saved one');
const nk = await b.call('colony_resource_update', { name: 'web-folio', config: { env: { API_KEY: '***', MODE: 'prod', NEW: '***' } } });
check(nk.err && /env NEW is not saved/.test(nk.text), '*** for a key that is not saved is refused');
eq((objectsStore.byName('web-folio')!.config as ServerConfig).env, { API_KEY: SENTINEL, MODE: 'prod' }, 'and env stays as it was');
await b.call('colony_resource_update', { name: 'web-folio', config: { env: { API_KEY: '***' } } });
eq((objectsStore.byName('web-folio')!.config as ServerConfig).env, { API_KEY: SENTINEL }, 'env is replaced whole: a key not sent is removed');

// HTTP variables merge by environment and name; a secret saved in the web app stays and cannot be removed, emptied or made plain.
const vars = () => (objectsStore.byName('http-folio')!.config as HttpConfig).variables;
await b.call('colony_resource_update', { name: 'http-folio', config: { variables: { dev: { base: { value: 'http://y' } } } } });
eq(vars(), { dev: { token: { value: SENTINEL, secret: true }, base: { value: 'http://y' } } }, 'changing one variable keeps the secret that was not sent');
await b.call('colony_resource_update', { name: 'http-folio', config: { variables: { dev: { extra: { value: '1' } }, prod: { base: { value: 'https://p' } } } } });
eq(vars(), { dev: { token: { value: SENTINEL, secret: true }, base: { value: 'http://y' }, extra: { value: '1' } }, prod: { base: { value: 'https://p' } } }, 'a new variable and a new environment are added next to the saved ones');
await b.call('colony_resource_update', { name: 'http-folio', config: { variables: { dev: { extra: null }, prod: null } } });
eq(vars(), { dev: { token: { value: SENTINEL, secret: true }, base: { value: 'http://y' } } }, 'a plain variable or a whole environment sent as null is removed');
await b.call('colony_resource_update', { name: 'http-folio', config: { variables: { dev: { token: { value: '', secret: true } } } } });
check(vars()!.dev.token.value === SENTINEL, 'a secret sent back empty keeps its value');
const before2 = JSON.stringify(objectsStore.byName('http-folio'));
for (const [what, v] of [['emptied as plain', { dev: { token: { value: '', secret: false } } }], ['made plain with a value', { dev: { token: { value: 'x' } } }], ['removed', { dev: { token: null } }],
  ['removed with its environment', { dev: null }], ['removed with every environment', null]] as const) {
  const x = await b.call('colony_resource_update', { name: 'http-folio', config: { variables: v } });
  check(x.err && /dev\.token is a secret saved in the web app/.test(x.text), `a saved secret cannot be ${what}`);
}
eq(JSON.stringify(objectsStore.byName('http-folio')), before2, 'and the resource is exactly as it was');
// Names that reach Object.prototype are refused, sent as raw JSON (a JS literal `{ __proto__: x }` would set the prototype, not a key). The server
// runs in this process, so Object.prototype itself shows whether it was touched.
const raw = async (op: string, json: string) => { const r = await fetch(`${API}/api/agent-colonies/${op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: json }); return { status: r.status, j: await r.json() as any }; };
const upd = (config: string) => raw('resource_update', `{"from":"${builder.id}","name":"http-folio","config":${config}}`);
for (const [what, config, msg] of [
  ['an environment named __proto__', '{"variables":{"__proto__":{"polluted":{"value":"1"}}}}', /An environment cannot be named __proto__/],
  ['an environment named constructor', '{"variables":{"constructor":{"polluted":{"value":"1"}}}}', /An environment cannot be named constructor/],
  ['a variable named __proto__', '{"variables":{"dev":{"__proto__":{"polluted":{"value":"1"}}}}}', /A variable cannot be named __proto__/],
  ['a variable named prototype', '{"variables":{"dev":{"prototype":{"value":"1"}}}}', /A variable cannot be named prototype/],
] as const) {
  const r = await upd(config);
  check(r.status === 400 && msg.test(r.j.error ?? ''), `${what} is refused with a 400`);
}
check(!Object.hasOwn(Object.prototype, 'polluted') && ({} as Record<string, unknown>).polluted === undefined && ({} as Record<string, unknown>).secret === undefined, 'and Object.prototype is left clean');
eq(JSON.stringify(objectsStore.byName('http-folio')), before2, 'and the resource is exactly as it was');
const envSaved = JSON.stringify((objectsStore.byName('web-folio')!.config as ServerConfig).env);
const ctorEnv = await raw('resource_update', `{"from":"${builder.id}","name":"web-folio","config":{"env":{"constructor":"***"}}}`);
check(ctorEnv.status === 400 && /An env variable cannot be named constructor/.test(ctorEnv.j.error ?? '') && JSON.stringify((objectsStore.byName('web-folio')!.config as ServerConfig).env) === envSaved, 'an env key named constructor is refused, not kept from the prototype');
// A variable that is not { value, secret } or null is refused instead of being saved empty.
for (const v of ['"plain string"', '5', '[]', 'true']) {
  const r = await upd(`{"variables":{"dev":{"z":${v}}}}`);
  check(r.status === 400 && /variables\.dev\.z must be \{ value, secret \}/.test(r.j.error ?? ''), `a variable sent as ${v} is refused`);
}
eq(JSON.stringify(objectsStore.byName('http-folio')), before2, 'and the resource is still as it was');
await b.call('colony_resource_update', { name: 'web-folio', new_name: 'web-folio-2', config: { port: 5000 } });
check((objectsStore.byName('web-folio-2')!.config as ServerConfig).port === 5000, 'a resource can be renamed and changed');
check(/There is already a resource named/.test(await errOf('colony_resource_create', { name: 'API-FOLIO', kind: 'http', config: { folder: root } })), 'a resource name taken with other case is refused');

const mg = await b.call('colony_resource_manager', { name: 'sqlite-folio', agent: 'Plain' });
check(!mg.err && /Plain looks after "sqlite-folio"/.test(mg.text) && agents.get(plain.id)!.skill_ids.includes(DATABASES_SKILL_ID), 'colony_resource_manager chooses the agent, and it gets Database management');
await b.call('colony_resource_manager', { name: 'web-folio-2', agent: 'Plain' });
check(agents.get(plain.id)!.skill_ids.includes(OBJECTS_SKILL_ID), 'and Colony resources for a server');
await b.call('colony_resource_manager', { name: 'sqlite-folio', agent: null });
check(objectsStore.managers().get(objectsStore.byName('sqlite-folio')!.id) === undefined, 'null leaves it to the colony again');

// ---- 10, 11: what an agent cannot do to itself or to the person's channels ---------------------------------------------------------------
check(/linked to a chat connection/.test(await errOf('colony_agent_delete', { name: 'Linked', confirm: 'Linked' })) && !!agents.get(linked.id), 'an agent linked to a connection is not deleted');
check(/You cannot delete yourself/.test(await errOf('colony_agent_delete', { name: 'Builder', confirm: 'Builder' })) && !!agents.get(builder.id), 'an agent cannot delete itself');
const myBoss = mk('My Boss', { role: 'orchestrator', cwd: devDir, worker_ids: [builder.id] });
check(/is your orchestrator/.test(await errOf('colony_agent_delete', { name: 'My Boss', confirm: 'My Boss' })) && !!agents.get(myBoss.id), 'nor the orchestrator it works for');
const peer = mk('Peer', { cwd: devDir });
const task = dispatches.start(builder.id, peer.id, 'check the build');
check(/has a task open with you/.test(await errOf('colony_agent_delete', { name: 'Peer', confirm: 'Peer' })) && !!agents.get(peer.id), 'nor an agent it has a task open with');
dispatches.finish(task, 'done', 'ok');
check(/is your own colony/.test(await errOf('colony_delete', { name: 'Home', confirm: 'Home' })) && !!colonies.get(home.id), 'nor its own colony');
snap = snapshot();
check(/take away your own Colony builder access/.test(await errOf('colony_agent_update', { name: 'Builder', skills: [{ name: 'Notebook' }] })), 'removing its own skill is refused');
check(/take away your own Colony builder access/.test(await errOf('colony_agent_update', { name: 'Builder', permission: 'plan', overrides: ['permission'] })), 'and so is making itself read-only');
check(/take away your own Colony builder access/.test(await errOf('colony_update', { name: 'Home', permission: 'plan' })), 'or its colony lending it Plan mode');
const h = session(heir.id, 'colonies');
for (const args of [{ name: 'Lending', skills: [] }, { name: 'Lending', inherit: { skills: false } }, { name: 'Lending', agents: [] }]) {
  const r = await h.call('colony_update', args);
  check(r.err && /take away your own Colony builder access/.test(r.text), `an agent that inherits the skill cannot lose it through its colony (${Object.keys(args)[1]})`);
}
const ov = await h.call('colony_agent_update', { name: 'Heir', overrides: ['skills'] });
check(ov.err && /take away your own/.test(ov.text), 'nor by no longer following its skills');
const mv = await h.call('colony_agent_update', { name: 'Heir', colony: null });
check(mv.err, 'nor by leaving that colony (here it would also have no folder)');
eq(snapshot(), snap, 'every refused change left the database exactly as it was');
const self = await b.call('colony_agent_update', { name: 'Builder', description: 'Builds colonies.', system_prompt: 'Be careful.' });
check(!self.err && agents.get(builder.id)!.description === 'Builds colonies.', 'changing its own description and prompt is allowed');

// ---- 12: deleting needs the exact name ---------------------------------------------------------------------------------------------------
const tmp = await b.call('colony_create', { name: 'Scratch', cwd: dir('scratch') });
check(!tmp.err, 'a colony to delete');
await b.call('colony_agent_create', { name: 'Stranded', provider: 'claude', colony: 'Scratch' });
await b.call('colony_agent_create', { name: 'Housed', provider: 'claude', colony: 'Scratch', cwd: devDir });
const scratch = colonies.list().find((c) => c.name === 'Scratch')!;
const pv = await b.call('colony_delete', { name: 'Scratch' });
check(!pv.err && /Nothing was deleted/.test(pv.text) && /Stranded, Housed|Housed, Stranded/.test(pv.text) && /Stranded would have no working folder/.test(pv.text) && !!colonies.get(scratch.id), 'without confirm nothing is deleted and the answer says what would be');
const wr = await b.call('colony_delete', { name: 'Scratch', confirm: 'Scratch2' });
check(/Nothing was deleted/.test(wr.text) && !!colonies.get(scratch.id), 'a confirm that is not the exact name deletes nothing');
const dl = await b.call('colony_delete', { name: 'Scratch', confirm: ' scratch ' });
check(!dl.err && !colonies.get(scratch.id) && /Left without a colony: (Housed, Stranded|Stranded, Housed)/.test(dl.text) && /With no working folder now .*: Stranded/.test(dl.text), 'with the exact name it is deleted and the answer lists who was left without a folder');
check(agents.byName('Stranded')?.colony_id === null && !!agents.byName('Housed'), 'its agents stay, without a colony');
const ap = await b.call('colony_agent_delete', { name: 'Housed' });
check(/Nothing was deleted/.test(ap.text) && /conversation/.test(ap.text) && /notebook/.test(ap.text) && !!agents.byName('Housed'), 'an agent: without confirm it says what goes with it');
check(await emitted('agents_changed', async () => { await b.call('colony_agent_delete', { name: 'Housed', confirm: 'Housed' }); }) && !agents.byName('Housed'), 'with confirm it is deleted, and the web is told');
const rp = await b.call('colony_resource_delete', { name: 'web-folio-2' });
check(/Nothing was deleted/.test(rp.text) && /stopped first/.test(rp.text) && !!objectsStore.byName('web-folio-2'), 'a resource: without confirm nothing is deleted');
check(await emitted('objects_changed', async () => { await b.call('colony_resource_delete', { name: 'stack-folio', confirm: 'stack-folio' }); }) && !objectsStore.byName('stack-folio'), 'with confirm it is deleted, and the web is told (objects_changed)');
for (const n of ['web-folio-2', 'box-folio', 'sqlite-folio', 'api-folio', 'pg-folio', 'http-folio']) await b.call('colony_resource_delete', { name: n, confirm: n });
check(!['web-folio-2', 'box-folio', 'sqlite-folio', 'api-folio', 'pg-folio', 'http-folio'].some((n) => objectsStore.byName(n)), 'every kind of resource can be deleted');
check(await emitted('agents_changed', async () => { await b.call('colony_update', { name: 'Folio Two', color: '#000000' }); }), 'a colony change tells the web too');
check(await emitted('objects_changed', async () => { await b.call('colony_resource_create', { name: 'last', kind: 'server', config: { cwd: root, start: 'true' } }); }), 'and so does a new resource');

// ---- 13: a read-only agent only looks ----------------------------------------------------------------------------------------------------
const r = session(reader.id, 'colonies');
for (const [t, args] of [['colony_list', {}], ['colony_get', { name: 'Folio Two' }], ['colony_agent_list', {}], ['colony_agent_get', { name: 'Builder' }], ['colony_skill_list', {}], ['colony_resource_list', {}], ['colony_resource_get', { name: 'last' }]] as const) {
  check(!(await r.call(t, args)).err, `a read-only agent can use ${t}`);
}
snap = snapshot();
for (const [t, args] of [['colony_create', { name: 'RO' }], ['colony_update', { name: 'Folio Two', color: '#fff' }], ['colony_delete', { name: 'Folio Two', confirm: 'Folio Two' }], ['colony_agent_create', { name: 'RO', provider: 'claude', cwd: root }],
  ['colony_agent_update', { name: 'Plain', description: 'x' }], ['colony_agent_delete', { name: 'Plain', confirm: 'Plain' }], ['colony_resource_create', { name: 'RO', kind: 'server', config: { cwd: root, start: 'true' } }],
  ['colony_resource_update', { name: 'last', config: { port: 1 } }], ['colony_resource_delete', { name: 'last', confirm: 'last' }], ['colony_resource_manager', { name: 'last', agent: 'Plain' }]] as const) {
  const x = await r.call(t, args);
  check(x.err && /You are read-only/.test(x.text), `but ${t} answers "You are read-only"`);
}
eq(snapshot(), snap, 'and nothing changed');
check(!!objectsStore.byName('last'), 'not even the resource');

// ---- the rest of the delete: an agent and a colony created here -------------------------------------------------------------------------
await b.call('colony_agent_delete', { name: 'Orchestrator - Leo - FOLIO', confirm: 'Orchestrator - Leo - FOLIO' });
check(!agents.get(leo.id) && !!agents.get(ana.id), 'deleting an orchestrator leaves its workers');
connections.remove(conn.id);
await b.call('colony_resource_delete', { name: 'last', confirm: 'last' });

for (const s of [b, h, r]) s.close();
console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
