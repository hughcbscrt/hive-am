// The instructions an agent is sent must not change by a single byte unless their content does: `instr_hash` is the sha1 of
// `composeInstructions`, and a different hash re-sends the instructions to every resumed conversation. Each agent below covers one
// branch of the composition (team, plan mode, OpenCode, Kiro, colony, built-in skills, channel); the expected sha1 and length were
// taken from the code as it was before it was split into parts. No model, no server. Usage:
//   HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-instructions-compose.ts
import './_guard.js';
import { createHash } from 'node:crypto';
import { agents, colonies, resolved, skills } from '../src/db.js';
import { connections } from '../src/connections/store.js';
import { composeInstructions } from '../src/instructions.js';
import { DATABASES_SKILL_ID, DEFAULT_SKILLS, NOTEBOOK_SKILL_ID, OBJECTS_SKILL_ID, WAKEUPS_SKILL_ID } from '../src/skills/defaults.js';
import type { Agent } from '../src/types.js';

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

// The built-in skills with fixed text, so that rewording one of them does not break this test.
skills.seedDefaults(DEFAULT_SKILLS.map((d) => ({ ...d, name: `Built-in ${d.slug}`, description: `About ${d.slug}`, content: `Rules for ${d.slug}.` })));
const review = skills.create({ name: 'Review flow', description: 'How to review a change', content: 'Read the diff.\nRun the tests.', load: 'always' });
const commits = skills.create({ name: 'Commits', description: '', content: 'Small commits, in English.', load: 'on_demand' });
const style = skills.create({ name: 'Code style', description: 'House style', content: 'Match the code around you.', load: 'always' });

const colony = colonies.create({ name: 'Hive', cwd: '/work/hive', system_prompt: '  Colony rule: be brief.  ', skill_ids: [style.id], inherit: { prompt: true, skills: true } } as any);
const w1 = agents.create({ name: 'Dev', description: 'Writes code', role: 'worker', provider: 'claude', cwd: '/work/dev' } as any);
const w2 = agents.create({ name: 'Rev', description: '', role: 'worker', provider: 'claude', cwd: '/work/rev' } as any);
const make = (p: Record<string, unknown>) => resolved(agents.get(agents.create(p as any).id)!);

const cases: [string, Agent][] = [
  ['minimal claude worker', make({ name: 'Min', role: 'worker', provider: 'claude', cwd: '/work/min' })],
  ['claude orchestrator with two workers', make({ name: 'Boss', description: 'Leads', role: 'orchestrator', provider: 'claude', cwd: '/work/boss', system_prompt: 'Plan first.', worker_ids: [w1.id, w2.id] })],
  ['claude plan mode with an on-demand skill', make({ name: 'Planner', role: 'worker', provider: 'claude', cwd: '/work/plan', permission: 'plan', skill_ids: [commits.id], skill_loads: { [commits.id]: 'on_demand' } })],
  ['opencode with an on-demand skill', make({ name: 'Oc', role: 'worker', provider: 'opencode', cwd: '/work/oc', skill_ids: [review.id, commits.id], skill_loads: { [commits.id]: 'on_demand' } })],
  ['kiro worker', make({ name: 'Ki', role: 'worker', provider: 'kiro', cwd: '/work/ki', system_prompt: 'Use the shell.' })],
  ['worker that inherits the colony prompt and skills', make({ name: 'Member', description: 'In the hive', role: 'worker', provider: 'claude', cwd: '/work/member', colony_id: colony.id, system_prompt: 'Own rule.', skill_ids: [review.id] })],
  ['cursor read-only with the built-in skills', make({ name: 'Tools', role: 'worker', provider: 'cursor', cwd: '/work/tools', permission: 'plan', skill_ids: [WAKEUPS_SKILL_ID, OBJECTS_SKILL_ID, DATABASES_SKILL_ID, NOTEBOOK_SKILL_ID] })],
  ['orchestrator without team, linked to a channel', make({ name: 'Bot', role: 'orchestrator', provider: 'claude', cwd: '/work/bot' })],
];
const bot = cases[cases.length - 1][1];
connections.create({ kind: 'telegram', name: 'bot', agent_id: bot.id, config: { aliases: ['botty', ' B '] }, allowed: [] });

// [sha1, length] for (agent, false) and (agent, true), in the order of `cases`.
const expected: [string, number, string, number][] = [
  ['81f522d1a9e864538dd855f87a5b640a63bc8821', 336, '282dfd882b1fdeac8ffff603011c7a82ec8985f3', 500],
  ['6d5a1a48c9db54e47bb7f61263c6542597bf4a4c', 1898, 'ee818799f25a049a2a5c71c1c7ca964c1ad48fc8', 2062],
  ['91ffcc977e84bb78859b6ce643069c4746b51765', 391, 'c59d44738ed31a3dfb43146c1432f73499987f39', 555],
  ['07c08ea819da28f74faac44f75867a74eca41915', 1570, '9f056a2a5760168732958c3d71359355d36390df', 1734],
  ['202bc85ad41271e19033f5b5a68418981669b12d', 847, 'ea902ec9f28362a453e8e39c50e1e4c00f67bed4', 1011],
  ['64d362400c5040dd9c69f0d454b7c8a46b82db9c', 665, '5be8b653aa0866e7aa680a74b62011a9060aa480', 829],
  ['2da33a831c9da8f3f1606841b741af1416585ae3', 3845, 'eb04e55c7f7c640e3ffc4da1a9fcbbd1b0545b0a', 4009],
  ['0cc6443db18117d906e4962d3f354a01f0b5f3c1', 1603, 'b26e47279db1bf3cf08c689bd5b13a87b6c97300', 1767],
];

// The roster follows the order the database returns the workers in, which depends on their random ids: this is the orchestrator with Rev listed first.
const swapped: [string, number, string, number] = ['bf8d9acf8e9a628e2009aa2b65aaa2a4df5636e8', 1898, 'f54b1a6449c5bc4b31ade19006002df601725fca', 2062];

const minimal = `## Who you are
You are **Min**, a worker agent in a hive-am colony of coding agents.
If someone asks who you are, answer as Min (worker) and describe your purpose. Do not introduce yourself as the underlying CLI or model.
Your working folder is \`/work/min\`. Everything you read, write or run happens there unless you are told otherwise.`;


check(expected.length === cases.length, `one expected value per agent (${expected.length}/${cases.length})`);
cases.forEach(([what, a], i) => {
  const [h, n, hd, nd] = (i === 1 && a.worker_ids[0] === w2.id ? swapped : expected[i]) ?? ['', 0, '', 0];
  const x = composeInstructions(a, false), y = composeInstructions(a, true);
  check(sha1(x) === h && x.length === n, `${what}: same text (${x.length} chars)`);
  check(sha1(y) === hd && y.length === nd, `${what}, delegated: same text (${y.length} chars)`);
});
check(composeInstructions(cases[0][1]) === minimal, 'minimal worker: full text matches the snapshot');

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
