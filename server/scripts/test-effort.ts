// Reasoning effort as a property of the agent (no model): the levels each provider takes, what is refused, a turn started with no origin using the
// agent's level while a connection's own overrides it, the arguments each CLI really gets, and the routes the form uses. Usage:
//   HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4489 npx tsx scripts/test-effort.ts
import './_guard.js';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agents, colonies, db, types } from '../src/db.js';
import '../src/index.js';
import { EFFORTS, checkEffort, effortOptions, learnEfforts, resolveEffort, validEffort } from '../src/efforts.js';
import { cloneAgent, createAgent, spawnFromType, updateAgent } from '../src/services/agents.js';
import { validateConnection } from '../src/http/validate.js';
import { sendTurn } from '../src/runtime.js';
import { runners } from '../src/providers/index.js';
import { runClaude } from '../src/providers/claude.js';
import { runOpencode } from '../src/providers/opencode.js';
import { runKiro } from '../src/providers/kiro.js';
import { migrate, MIGRATIONS } from '../src/db/migrations.js';

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const throws = (f: () => unknown, re?: RegExp) => { try { f(); return false; } catch (e) { return !re || re.test(e instanceof Error ? e.message : String(e)); } };
const API = `http://127.0.0.1:${process.env.HIVE_AM_PORT}`;
const get = async (path: string) => { const r = await fetch(`${API}${path}`); return { status: r.status, json: await r.json().catch(() => null) as any }; };
const send = async (method: string, path: string, body: unknown) => { const r = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null) as any }; };
const dir = mkdtempSync(join(tmpdir(), 'effort-'));
const mk = (name: string, o: Record<string, unknown> = {}) => createAgent({ name, role: 'worker', provider: 'claude', model: '', cwd: dir, ...o } as any);

// ---- the shared levels ----
check(EFFORTS.join() === 'low,medium,high,xhigh,max' && ['low', 'medium', 'high', 'xhigh', 'max'].every(validEffort), 'the shared levels are the five the CLIs document');
check(!validEffort('') && !validEffort('ultra') && !validEffort(3), 'nothing else is a level');

// ---- what each provider accepts ----
check(checkEffort('claude', 'sonnet', '') === null && checkEffort('claude', '', 'xhigh') === null && checkEffort('claude', '', 'max') === null, 'Claude takes empty, xhigh and max');
check(/effort must be/.test(checkEffort('claude', '', 'ultra') ?? '') && /effort must be/.test(checkEffort('kiro', '', 'extreme') ?? ''), 'and not a level that does not exist');
learnEfforts('kiro', { 'kiro-model-a': [{ id: 'low' }, { id: 'high' }] });
check(checkEffort('kiro', 'kiro-model-a', 'high') === null && /takes low, high/.test(checkEffort('kiro', 'kiro-model-a', 'max') ?? ''), 'Kiro narrows to what a model reports once it is known');
check(checkEffort('kiro', 'never-seen', 'max') === null, 'and offers the documented levels until it is');
learnEfforts('opencode', { 'p/with': [{ id: 'low', level: 'low' }, { id: 'high', level: 'high' }, { id: 'max', level: 'max' }], 'p/numbered': [{ id: '0', level: 'low' }, { id: '3', level: 'high' }], 'p/none': [] });
check(checkEffort('opencode', 'p/with', 'high') === null && /has no "xhigh" variant/.test(checkEffort('opencode', 'p/with', 'xhigh') ?? ''), 'OpenCode takes the variants of the model it has');
check(/takes no effort variant/.test(checkEffort('opencode', 'p/none', 'high') ?? '') && checkEffort('opencode', 'p/none', '') === null, 'a model with no variants takes none, and the default is always fine');
check(checkEffort('opencode', 'p/numbered', '3') === null && checkEffort('opencode', 'p/numbered', 'high') !== null, 'the variant is its id, not the level it stands for');
check(checkEffort('opencode', 'q/unseen', 'high') === null && checkEffort('opencode', 'q/unseen', 'two words') !== null, 'for a model whose catalog was not read, a variant-shaped name passes and nothing else');
check(checkEffort('opencode', 'p/with#low', 'high') !== null && checkEffort('opencode', 'p/with#low', '') === null, 'a model id that names its variant takes no effort of its own');

// ---- the options the form offers ----
check(effortOptions('claude', '').known && effortOptions('claude', '').options.length === 5, 'Claude offers the five levels');
check(effortOptions('kiro', 'kiro-model-a').options.map((o) => o.id).join() === 'low,high' && effortOptions('kiro', 'never-seen').options.length === 5, 'Kiro offers what its model reports, else the five');
check(effortOptions('opencode', 'p/with').options.map((o) => o.id).join() === 'low,high,max' && effortOptions('opencode', 'p/none').options.length === 0 && effortOptions('opencode', 'p/none').known, 'OpenCode offers the variants of the model, or says it has none');
check(!effortOptions('opencode', 'q/unseen').known && !effortOptions('opencode', '').known, 'and says it does not know when the catalog has not been read');

// ---- what is passed to the CLI ----
check(resolveEffort('claude', 'x', 'max') === 'max' && resolveEffort('claude', 'x', 'bogus') === '' && resolveEffort('claude', 'x', undefined) === '', 'Claude gets a level or nothing');
check(resolveEffort('opencode', 'p/numbered', 'high') === '3' && resolveEffort('opencode', 'p/numbered', '0') === '0' && resolveEffort('opencode', 'p/numbered', 'max') === '', 'a level name becomes the variant the model has for it, and one it lacks becomes nothing');
check(resolveEffort('opencode', 'q/unseen', 'high') === 'high' && resolveEffort('opencode', 'p/with#low', 'high') === '', 'for an unread model the value goes as it is (as before)');

// ---- the agent stores it, and what it refuses ----
check(mk('plain').effort === '', 'an agent starts with the CLI\'s default');
const a = mk('thinker', { effort: 'xhigh' });
check(a.effort === 'xhigh' && agents.get(a.id)!.effort === 'xhigh', 'an effort is stored');
check(throws(() => mk('bad-claude', { effort: 'ultra' }), /effort must be/) && !agents.byName('bad-claude'), 'a level the provider does not take is refused, and nothing is created');
check(throws(() => mk('bad-oc', { provider: 'opencode', model: 'p/with', effort: 'xhigh' }), /no "xhigh" variant/), 'so is a variant the OpenCode model does not have');
const oc = mk('oc-agent', { provider: 'opencode', model: 'p/with', effort: 'high' });
check(oc.effort === 'high', 'and a variant it has is accepted');
check(throws(() => updateAgent(oc.id, { effort: 'max2' } as any), /has no "max2"/) && agents.get(oc.id)!.effort === 'high', 'an update with a variant it does not have is refused and keeps the saved one');
check(updateAgent(oc.id, { model: 'p/numbered' } as any)!.effort === '', 'changing the model to one without that variant falls back to the default');
check(updateAgent(a.id, { provider: 'opencode', model: 'p/with' } as any)!.effort === '', 'changing the provider does too');
check(updateAgent(a.id, { effort: '' } as any)!.effort === '' && agents.get(oc.id)!.effort === '', 'and an empty effort is always accepted');
const keep = mk('keeps', { effort: 'high' });
check(updateAgent(keep.id, { description: 'new' } as any)!.effort === 'high', 'an update that touches neither provider nor model leaves it');

// ---- types and clones ----
const t = types.create({ name: 'Thinker type', role: 'worker', provider: 'claude', model: '', effort: 'xhigh' } as any);
check(t.effort === 'xhigh' && types.get(t.id)!.effort === 'xhigh', 'a type carries an effort');
check(spawnFromType(t, { name: 'from-type', cwd: dir } as any).effort === 'xhigh', 'and an agent made from it starts with it');
check(cloneAgent(keep.id, { name: 'keeps 2' }).effort === 'high', 'a clone copies the effort');
const bt = await send('POST', '/api/types', { name: 'bad type', role: 'worker', provider: 'claude', effort: 'ultra' });
check(bt.status === 400 && /effort must be/.test(bt.json?.error ?? ''), 'the types API refuses a level the provider does not take');
const pt = await send('PATCH', `/api/types/${t.id}`, { provider: 'opencode', model: 'p/with' });
check(pt.status === 200 && pt.json.effort === '', 'and clears the effort of a type whose provider changed');

// ---- the connection's effort ----
check(!throws(() => validateConnection('telegram', { token: 'x', effort: 'xhigh' }, null, false)) && !throws(() => validateConnection('telegram', { token: 'x', effort: 'max' }, null, false)) && !throws(() => validateConnection('telegram', { token: 'x', effort: '' }, null, false)), 'a connection takes the five levels, or the agent\'s');
check(throws(() => validateConnection('telegram', { token: 'x', effort: 'ultra' }, null, false), /effort must be/), 'and not others');

// ---- a turn uses the agent's effort, whatever started it ----
const seen: (string | undefined)[] = [];
runners.claude = async function* (o: any) { seen.push(o.effort); yield { t: 'text', delta: 'ok' }; yield { t: 'done', ok: true }; };
runners.opencode = runners.claude;
const web = mk('web-chat', { effort: 'high' });
await sendTurn(web.id, 'from the web chat');
check(seen.at(-1) === 'high', 'a message from the web chat (no origin) runs at the agent\'s effort');
await sendTurn(web.id, 'a wake-up', 'user', undefined, undefined, { effort: undefined } as any);
check(seen.at(-1) === 'high', 'so does one whose connection is on "Agent default"');
await sendTurn(web.id, 'from a connection', 'user', undefined, undefined, { effort: 'max' } as any);
check(seen.at(-1) === 'max', 'a connection that sets an effort overrides it for its own turns');
await sendTurn(web.id, 'again', 'user');
check(seen.at(-1) === 'high', 'and only for them');
await sendTurn(mk('no-effort').id, 'nothing set');
check(seen.at(-1) === undefined, 'an agent with none passes none');
const ocNum = mk('oc-numbered', { provider: 'opencode', model: 'p/numbered', effort: '3' });
await sendTurn(ocNum.id, 'variant');
check(seen.at(-1) === '3', 'an OpenCode agent passes its variant');
await sendTurn(ocNum.id, 'by level', 'user', undefined, undefined, { effort: 'high' } as any);
check(seen.at(-1) === '3', 'and a connection that asks for a level gets the variant the model has for it');
db.prepare("UPDATE agents SET effort='5' WHERE id=?").run(ocNum.id);            // a saved variant the model does not have (it changed under the agent)
await sendTurn(ocNum.id, 'stale');
check(seen.at(-1) === undefined, 'a saved effort that no longer applies runs at the CLI\'s default instead of failing the turn');

// ---- the arguments the CLIs really get (stub programs on PATH that record them) ----
const bin = join(dir, 'bin'); mkdirSync(bin);
const log = join(dir, 'args.log');
const stub = (name: string, extra = '') => { const f = join(bin, name); writeFileSync(f, `#!/bin/sh\n${extra}{ echo "<<<"; for a in "$@"; do printf '%s\\n' "$a"; done; echo ">>>"; } >> "${log}"\ncat > /dev/null 2>&1 || true\necho '{"session_id":"s","type":"result","result":"ok"}'\n`); chmodSync(f, 0o755); };
stub('claude'); stub('kiro-cli'); stub('opencode', `if [ "$2" = "--help" ]; then echo '--format --thinking --auto'; exit 0; fi\n`);
process.env.PATH = `${bin}:${process.env.PATH}`;
const last = () => { const t = readFileSync(log, 'utf8'); return t.slice(t.lastIndexOf('<<<\n') + 4, t.lastIndexOf('>>>')).trim().split('\n'); };
const run = async (fn: any, agent: any, effort: string | undefined) => { try { for await (const _ of fn({ agent, prompt: 'hi', signal: new AbortController().signal, instructions: '', mcpCaps: [], refreshInstructions: false, effort })) void _; } catch { /* the stub is not a real CLI: only its arguments matter */ } return last(); };
const base: any = { id: 'arg-agent', name: 'arg', cwd: dir, model: '', permission: 'acceptEdits', session_id: null, effective: { permission: 'acceptEdits', cwd: dir } };
let args = await run(runClaude, { ...base, provider: 'claude' }, 'xhigh');
check(args.join(' ').includes('--effort xhigh'), 'Claude is run with --effort xhigh');
args = await run(runClaude, { ...base, provider: 'claude' }, undefined);
check(!args.includes('--effort'), 'and with no flag when there is none');
args = await run(runKiro, { ...base, provider: 'kiro' }, 'max');
check(args.join(' ').includes('--effort max'), 'Kiro is run with --effort max');
args = await run(runOpencode, { ...base, provider: 'opencode', model: 'p/numbered' }, '3');
check(args.includes('-m') && args[args.indexOf('-m') + 1] === 'p/numbered#3', 'OpenCode is run with the variant after the model');
args = await run(runOpencode, { ...base, provider: 'opencode', model: 'p/numbered' }, undefined);
check(args[args.indexOf('-m') + 1] === 'p/numbered', 'and with the model alone when there is none');

// ---- the routes the form uses ----
const rc = await get('/api/providers/claude/efforts');
check(rc.status === 200 && rc.json.known && rc.json.options.length === 5, 'GET /api/providers/claude/efforts offers the five levels');
const ro = await get('/api/providers/opencode/efforts?model=p%2Fwith');
check(ro.status === 200 && ro.json.known && ro.json.options.map((o: any) => o.id).join() === 'low,high,max', 'OpenCode\'s depend on the model');
const rn = await get('/api/providers/opencode/efforts?model=p%2Fnone');
check(rn.json.known && rn.json.options.length === 0, 'a model with no variants says so');
check((await get('/api/providers/nope/efforts')).status === 404, 'an unknown provider is a 404');
const cr = await send('POST', '/api/agents', { name: 'http-agent', role: 'worker', provider: 'claude', model: '', cwd: dir, effort: 'max' });
check(cr.status === 200 && cr.json.effort === 'max', 'the agent API stores it');
check((await send('POST', '/api/agents', { name: 'http-bad', role: 'worker', provider: 'claude', model: '', cwd: dir, effort: 'ultra' })).status === 400, 'and refuses one that does not apply');
check((await get('/api/agents')).json.find((x: any) => x.name === 'http-agent')?.effort === 'max', 'the list returns it');

// ---- the migration ----
const old = new (await import('better-sqlite3')).default(':memory:');
migrate(old, MIGRATIONS.filter((m) => m.version <= 7));
old.prepare("INSERT INTO agents (id,name,role,provider,cwd,created_at,updated_at,status) VALUES ('old1','old','worker','claude','/tmp',1,1,'idle')").run();
old.prepare("INSERT INTO agent_types (id,name,role,provider,created_at) VALUES ('ot','old type','worker','claude',1)").run();
check(migrate(old).join() === '8', 'a database at version 7 migrates to 8');
check((old.prepare("SELECT effort FROM agents WHERE id='old1'").get() as any).effort === '' && (old.prepare("SELECT effort FROM agent_types WHERE id='ot'").get() as any).effort === '', 'and its agents and types read as the CLI\'s default');
void colonies;

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
