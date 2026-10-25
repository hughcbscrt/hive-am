// The size of an agent's instructions, part by part (no model, no server): the parts join back into exactly what is sent, the colony
// prompt and the agent's own prompt are apart, an on-demand skill weighs only its line in the list (except for Claude in plan mode,
// which loads every skill in full), a skill that comes from the colony says so, and the notebook is measured but left out of the total.
// The web's "After saving" (`saveDelta` in web/lib/tokens.ts) is checked against the real change, including the list's header
// (`lazy_overhead_chars`) that the first skill on demand brings and the last one takes away.
//   HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-instructions-size.ts
import './_guard.js';
import { agents, colonies, resolved, skills } from '../src/db.js';
import { connections } from '../src/connections/store.js';
import { composeInstructions, instructionParts, notebookBlock } from '../src/instructions.js';
import { saveDelta, skillWeight } from '../../web/lib/tokens.ts';
import { instructionsSize } from '../src/services/instructions-size.js';
import { DEFAULT_SKILLS, NOTEBOOK_SKILL_ID } from '../src/skills/defaults.js';
import { notebooks } from '../src/skills/notebook.js';
import type { Agent } from '../src/types.js';

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const eq = (got: unknown, want: unknown, what: string) => check(JSON.stringify(got) === JSON.stringify(want), `${what}${JSON.stringify(got) === JSON.stringify(want) ? '' : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
const fresh = (id: string) => agents.get(id)!;
// Parts and total add up to the text that is sent: every separator between two parts is "\n\n".
const adds = (a: Agent, what: string) => {
  const r = resolved(a), size = instructionsSize(a);
  check(instructionParts(r).map((p) => p.text).join('\n\n') === composeInstructions(r), `${what}: the parts join into the instructions`);
  check(size.parts.reduce((n, p) => n + p.chars, 0) === size.total_chars, `${what}: the parts add up to the total`);
  eq(composeInstructions(r).length, size.total_chars + 2 * (size.parts.length - 1), `${what}: total plus separators is the length sent`);
  check(size.total_tokens_est === Math.ceil(size.total_chars / 4), `${what}: tokens are a quarter of the characters, rounded up`);
  return size;
};

skills.seedDefaults(DEFAULT_SKILLS);
const content = 'X'.repeat(4000);
const big = skills.create({ name: 'Big', description: 'A long one', content, load: 'always' });
const small = skills.create({ name: 'Small', description: '', content: 'Be short.', load: 'always' });
const shared = skills.create({ name: 'Shared', description: 'From the colony', content: 'Colony skill text.', load: 'always' });

// Colony prompt and own prompt.
const colony = colonies.create({ name: 'Hive', cwd: '/work/hive', system_prompt: 'Colony rule.', skill_ids: [shared.id], inherit: { prompt: true, skills: true } } as any);
const member = agents.create({ name: 'Member', role: 'worker', provider: 'claude', cwd: '/w/m', colony_id: colony.id, system_prompt: 'Own rule.', skill_ids: [small.id] } as any);
let s = adds(member, 'colony member');
const parts = instructionParts(resolved(member));
const colonyPart = parts.find((p) => p.group === 'colony'), ownPart = parts.find((p) => p.group === 'own');
check(!!colonyPart && !!ownPart && `${colonyPart.text}\n\n${ownPart.text}` === resolved(member).system_prompt, 'with the colony prompt inherited, colony + own is the prompt the agent runs with');
eq(s.parts.find((p) => p.group === 'colony')?.from_colony, 'Hive', 'the colony part names its colony');
eq([s.colony_id, s.colony_name], [colony.id, 'Hive'], 'the answer says which colony the agent follows');
const sharedPart = s.parts.find((p) => p.skill_id === shared.id), smallPart = s.parts.find((p) => p.skill_id === small.id);
eq([sharedPart?.from_colony, sharedPart?.skill_name, sharedPart?.mode], ['Hive', 'Shared', 'always'], "the colony's skill comes with its colony");
eq(smallPart?.from_colony, undefined, "the agent's own skill does not");
agents.update(member.id, { skill_ids: [small.id, shared.id] });
eq(instructionsSize(fresh(member.id)).parts.find((p) => p.skill_id === shared.id)?.from_colony, undefined, 'a colony skill the agent also picks itself is its own (and editable)');

agents.update(member.id, { overrides: ['prompt'] });
s = adds(fresh(member.id), 'member that stopped following the colony prompt');
eq(s.parts.filter((p) => p.group === 'colony' || p.group === 'own').map((p) => p.group), ['own'], 'without the colony prompt there is only the own prompt');
agents.update(member.id, { overrides: [], system_prompt: '' });
s = adds(fresh(member.id), 'member with no prompt of its own');
eq(s.parts.filter((p) => p.group === 'colony' || p.group === 'own').map((p) => p.group), ['colony'], 'with only the colony prompt there is only the colony part');
const plain = agents.create({ name: 'Plain', role: 'worker', provider: 'claude', cwd: '/w/p', system_prompt: 'Colony rule.\n\nOwn rule.' } as any);
s = adds(plain, 'agent without a colony');
eq(s.parts.filter((p) => p.group === 'colony' || p.group === 'own').map((p) => p.group), ['own'], 'without a colony the prompt is all its own, whatever it says');

// Always and on demand.
// The first on-demand skill also brings the header of the list (and, for OpenCode, the note on calling the hive tools): measured from
// an agent that already has one, switching another skill saves its text and adds only its line.
const worker = agents.create({ name: 'Heavy', role: 'worker', provider: 'claude', cwd: '/w/h', skill_ids: [big.id, small.id], skill_loads: { [big.id]: 'always', [small.id]: 'on_demand' } } as any);
const before = adds(worker, 'one skill always, one on demand');
const bigPart = before.parts.find((p) => p.skill_id === big.id)!;
check(bigPart.chars > 4000 && bigPart.mode === 'always' && bigPart.tokens_est === Math.ceil(bigPart.chars / 4), 'an always skill weighs its whole text');
eq(before.on_demand, [{ skill_id: small.id, skill_name: 'Small' }], 'the other one is on demand');
agents.update(worker.id, { skill_loads: { [big.id]: 'on_demand', [small.id]: 'on_demand' } });
const after = adds(fresh(worker.id), 'both skills on demand');
const line = `- **Big**: A long one`;
check(!after.parts.some((p) => p.skill_id === big.id), 'the on-demand skill has no part of its own');
const list = after.parts.find((p) => p.group === 'lazy_list');
check(!!list && list.count === 2 && instructionParts(resolved(fresh(worker.id))).find((p) => p.group === 'lazy_list')!.text.split('\n').includes(line), 'it is a line in the on-demand list, which counts it');
eq(after.on_demand.map((x) => x.skill_name).sort(), ['Big', 'Small'], 'and is listed as on demand, to switch it back');
eq(before.total_chars - after.total_chars, bigPart.chars - (line.length + 1), 'switching it saves its text and adds its line (and the line break before it)');
eq(after.plan_all, false, 'outside Claude plan mode, on demand applies');

const planner = agents.create({ name: 'Planner', role: 'worker', provider: 'claude', cwd: '/w/pl', permission: 'plan', skill_ids: [big.id], skill_loads: { [big.id]: 'on_demand' } } as any);
s = adds(planner, 'claude in plan mode');
check(s.plan_all && s.parts.some((p) => p.skill_id === big.id && p.mode === 'on_demand' && p.chars > 4000) && !s.parts.some((p) => p.group === 'lazy_list'), 'in Claude plan mode an on-demand skill still counts in full, and plan_all says so');

// Team, channel, delegation, notebook.
const boss = agents.create({ name: 'Boss', role: 'orchestrator', provider: 'claude', cwd: '/w/b', worker_ids: [worker.id, plain.id] } as any);
s = adds(boss, 'orchestrator with a team');
eq(s.parts.filter((p) => p.group === 'team').map((p) => p.count), [2], 'the team is one part that counts its members');
const alone = agents.create({ name: 'Alone', role: 'orchestrator', provider: 'claude', cwd: '/w/a' } as any);
s = adds(alone, 'orchestrator without a team');
eq(s.parts.filter((p) => p.group === 'team').map((p) => p.count), [0], 'without workers the team part says it has none');
check(!instructionsSize(plain).parts.some((p) => p.group === 'team'), 'a worker has no team part');
connections.create({ kind: 'telegram', name: 'bot', agent_id: alone.id, config: { aliases: ['al'] }, allowed: [] });
s = adds(fresh(alone.id), 'agent linked to a channel');
eq(s.parts.filter((p) => p.group === 'channel').map((p) => [p.key, p.channel ?? null]), [['aliases', null], ['channel', 'Telegram']], 'aliases and the channel are channel parts, the channel named by its platform');
const delegated = composeInstructions(resolved(plain), true).length - composeInstructions(resolved(plain)).length;
check(delegated > 150 && delegated < 200 && instructionsSize(plain).total_chars + 2 * (instructionsSize(plain).parts.length - 1) === composeInstructions(resolved(plain)).length, `the size is the direct conversation's: a delegated task adds ${delegated} characters to the identity`);

const writer = agents.create({ name: 'Writer', role: 'worker', provider: 'claude', cwd: '/w/n', skill_ids: [NOTEBOOK_SKILL_ID] } as any);
notebooks.save(writer.id, '## Notes\n- one fact', 'agent', true);
s = adds(fresh(writer.id), 'agent with a notebook');
eq(s.notebook_chars, notebookBlock(resolved(fresh(writer.id))).length, 'the notes are measured');
check(s.notebook_chars > 0 && s.notebook_tokens_est === Math.ceil(s.notebook_chars / 4) && s.parts.some((p) => p.key === 'notebook' && p.group === 'other'), 'the notebook instructions are a part; the notes themselves are not');
eq(instructionsSize(plain).notebook_chars, 0, 'without a notebook its size is 0');

const kinds = new Set(instructionsSize(fresh(writer.id)).parts.map((p) => p.group));
check(kinds.has('identity') && instructionsSize(plain).parts[0].key === 'identity', 'the identity always comes first');
check(['opencode', 'kiro', 'wakeups', 'resources', 'databases', 'notebook'].every((k) => instructionParts(resolved(fresh(writer.id))).every((p) => p.key !== k || p.group === 'other')), 'provider notes and built-in skill blocks are "other"');

// The list's header: what the first skill on demand brings besides its line, and the last one takes away.
// "After saving" is estimated in the browser from the skills' text; it must match the real change within 5% or 30 tokens (the
// per-skill rounding of a few short skills can add up to more than 5% of a small change).
const near = (est: number, real: number) => Math.abs(est - real) <= Math.max(30, Math.abs(real) * 0.05);
const switching = (a: Agent, loads: Agent['skill_loads'], what: string) => {
  const was = instructionsSize(fresh(a.id)), est = saveDelta(skills.list() as any, fresh(a.id), { skill_ids: fresh(a.id).skill_ids, skill_loads: loads }, was);
  agents.update(a.id, { skill_loads: loads });
  const now = adds(fresh(a.id), what), real = now.total_tokens_est - was.total_tokens_est;
  check(near(est, real), `${what}: "After saving" says ${est}, the instructions change by ${real}`);
  return [was, now] as const;
};
const header = (s: { parts: { group: string; chars: number }[] }) => s.parts.find((p) => p.group === 'lazy_list');
const review = skills.create({ name: 'Big review', description: 'How to review a change', content: 'Y'.repeat(5435), load: 'always' });
const tiny = skills.create({ name: 'Tiny', description: 'A short one', content: 'Be brief.', load: 'always' });
const claude = agents.create({ name: 'Lister', role: 'worker', provider: 'claude', cwd: '/w/l', skill_ids: [review.id, tiny.id], skill_loads: { [review.id]: 'always', [tiny.id]: 'always' } } as any);
let [was, now] = switching(claude, { [review.id]: 'on_demand', [tiny.id]: 'always' }, 'claude 0 -> 1 on demand');
const reviewChars = was.parts.find((p) => p.skill_id === review.id)!.chars, reviewLine = '- **Big review**: How to review a change';
check(was.lazy_overhead_chars > 300 && was.lazy_overhead_chars === now.lazy_overhead_chars, `claude: the header weighs ${was.lazy_overhead_chars} characters with or without skills on demand`);
eq(now.total_chars - was.total_chars, was.lazy_overhead_chars + reviewLine.length - reviewChars, 'claude 0 -> 1: the change is the header plus the line, minus the skill');
eq(header(now)!.chars, was.lazy_overhead_chars + reviewLine.length, 'claude: with one skill, the list part is the header plus that line');
[was, now] = switching(claude, { [review.id]: 'on_demand', [tiny.id]: 'on_demand' }, 'claude 1 -> 2 on demand (no header)');
eq(now.total_chars - was.total_chars, '- **Tiny**: A short one'.length + 1 - was.parts.find((p) => p.skill_id === tiny.id)!.chars, 'claude 1 -> 2: only the skill and its line change');
[was, now] = switching(claude, { [review.id]: 'always', [tiny.id]: 'on_demand' }, 'claude 2 -> 1 on demand (no header)');
[was, now] = switching(claude, { [review.id]: 'always', [tiny.id]: 'always' }, 'claude 1 -> 0 on demand');
check(!header(now) && was.on_demand.length === 1 && now.on_demand.length === 0, 'claude 1 -> 0: the list and its header are gone');

const oc = agents.create({ name: 'Coder', role: 'worker', provider: 'opencode', cwd: '/w/o', skill_ids: [review.id], skill_loads: { [review.id]: 'always' } } as any);
const ocBefore = instructionsSize(oc);
check(!ocBefore.parts.some((p) => p.key === 'opencode'), 'opencode with no hive tools: no note on calling them');
[was, now] = switching(oc, { [review.id]: 'on_demand' }, 'opencode 0 -> 1 on demand');
const note = now.parts.find((p) => p.key === 'opencode');
check(!!note && was.lazy_overhead_chars === header(now)!.chars - reviewLine.length + note.chars, 'opencode alone: the overhead also counts the note on the hive tools that the first skill on demand brings');
eq(now.total_chars - was.total_chars, was.lazy_overhead_chars + reviewLine.length - reviewChars, 'opencode 0 -> 1: header, note and line, minus the skill');
[was, now] = switching(oc, { [review.id]: 'always' }, 'opencode 1 -> 0 on demand');
check(!now.parts.some((p) => p.key === 'opencode'), 'opencode 1 -> 0: the note goes with the list');
const ocLinked = agents.create({ name: 'Linked coder', role: 'worker', provider: 'opencode', cwd: '/w/oc', skill_ids: [NOTEBOOK_SKILL_ID, review.id], skill_loads: { [review.id]: 'always' } } as any);
[was, now] = switching(ocLinked, { [review.id]: 'on_demand' }, 'opencode with a notebook 0 -> 1 on demand');
eq(was.lazy_overhead_chars, header(now)!.chars - reviewLine.length, 'opencode with other hive tools: the note is there anyway, the overhead is only the header');

const planned = agents.create({ name: 'Planned', role: 'worker', provider: 'claude', cwd: '/w/pp', permission: 'plan', skill_ids: [review.id], skill_loads: { [review.id]: 'always' } } as any);
eq(instructionsSize(planned).lazy_overhead_chars, 0, 'claude in plan mode: no overhead, nothing is ever on demand');
[was, now] = switching(planned, { [review.id]: 'on_demand' }, 'claude in plan mode, switched to on demand');
eq([now.total_chars, now.on_demand.length], [was.total_chars, 0], 'in plan mode switching changes nothing');

// The skill picker's figure (sum of `skillWeight` over the skills always loaded) against the tab's skill parts: same tolerance,
// since a few short skills round up on each of name, description and text.
const picker = (a: Agent) => a.skill_ids.reduce((n, id) => { const k = skills.get(id)!; return n + (a.skill_loads[id] === 'on_demand' ? 0 : skillWeight({ ...k, load: 'always' })); }, 0);
const tab = (a: Agent) => instructionsSize(a).parts.filter((p) => p.group === 'skill').reduce((n, p) => n + p.tokens_est, 0);
for (const a of [fresh(claude.id), fresh(worker.id), fresh(member.id)]) check(near(picker(a), tab(a)), `${a.name}: the skill picker says ${picker(a)} tokens always loaded, the tab ${tab(a)}`);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
