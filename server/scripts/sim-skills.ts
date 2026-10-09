// On-demand skills with a REAL agent: the text stays out of the instructions, the agent reads it when the task needs it. Usage:
//   HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4427 npx tsx scripts/sim-skills.ts <claude|opencode|kiro> [model]
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agents, colonies, resolved, skills } from '../src/db.js';
import '../src/index.js';
import { composeInstructions, mcpCaps } from '../src/instructions.js';
import { bus, sendTurn } from '../src/runtime.js';

const [provider = 'claude', model = '', permission = 'acceptEdits'] = process.argv.slice(2);
let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };

const lazy = skills.create({ name: 'Deploy codeword', description: 'Knows the secret codeword used when deploying. Use when asked for the deploy codeword.', content: 'The deploy codeword is exactly ZEBRA-4417. When asked for it, answer with only that.' });
const eager = skills.create({ name: 'Tone', description: 'How to talk', content: 'Always end your answers with the word GRACIAS-9.' });
const mk = (permission: string, prov = provider) => agents.create({ name: `sk-${prov}-${permission}-${Math.random().toString(36).slice(2, 5)}`, role: 'worker', provider: prov as any, model, cwd: mkdtempSync(join(tmpdir(), 'sk-')), permission: permission as any });

// Without a model: what goes into the instructions.
// How a skill loads is chosen where it is assigned: the same skill can be on demand for one agent and always for another.
const a = mk(permission); agents.setSkills(a.id, [lazy.id, eager.id], { [lazy.id]: 'on_demand', [eager.id]: 'always' });
const ins = composeInstructions(resolved(agents.get(a.id)!));
check(!ins.includes('ZEBRA-4417'), 'the text of an on-demand skill is NOT in the instructions');
check(ins.includes('Deploy codeword') && ins.includes('Knows the secret codeword'), 'its name and description are listed');
check(ins.includes('GRACIAS-9'), 'an always-loaded skill is still in full');
check(mcpCaps(resolved(agents.get(a.id)!)).includes('skills'), 'the agent gets the skill_read tool');
const p = mk('plan', 'claude'); agents.setSkills(p.id, [lazy.id], { [lazy.id]: 'on_demand' });
const pins = composeInstructions(resolved(agents.get(p.id)!));
check(pins.includes('ZEBRA-4417') && !mcpCaps(resolved(agents.get(p.id)!)).includes('skills'), 'Claude in Read-only mode (no MCP tools) gets the text in full instead');
const same = mk(permission); agents.setSkills(same.id, [lazy.id], { [lazy.id]: 'always' });
check(composeInstructions(resolved(agents.get(same.id)!)).includes('ZEBRA-4417'), 'the same skill assigned as always IS in full for another agent');
agents.setSkills(same.id, [lazy.id, eager.id]);
check(agents.get(same.id)!.skill_loads[lazy.id] === 'always', 'changing the list keeps how each skill was loaded');
check(agents.get(same.id)!.skill_loads[eager.id] === 'always', 'a skill added without saying takes its suggestion');
const none = mk(permission); agents.setSkills(none.id, [eager.id]);
check(!mcpCaps(resolved(agents.get(none.id)!)).includes('skills'), 'no tool when every skill is always-loaded');
const col = colonies.create({ name: `c-${Math.random().toString(36).slice(2, 5)}`, skill_ids: [lazy.id], skill_loads: { [lazy.id]: 'on_demand' } } as any);
const member = mk(permission); agents.update(member.id, { colony_id: col.id } as any);
check(resolved(agents.get(member.id)!).skill_loads[lazy.id] === 'on_demand' && !composeInstructions(resolved(agents.get(member.id)!)).includes('ZEBRA-4417'), "a colony's skill keeps the colony's choice for its members");
agents.setSkills(member.id, [lazy.id], { [lazy.id]: 'always' });
check(composeInstructions(resolved(agents.get(member.id)!)).includes('ZEBRA-4417'), "the agent's own choice wins over its colony's");

// With a model.
const tools: string[] = [];
bus.on('msg', (m: any) => { if (m.kind === 'event' && m.agentId === a.id && m.event.t === 'tool') tools.push(`${m.event.name} ${JSON.stringify(m.event.input ?? {})}`); });
const res = await sendTurn(a.id, 'What is the deploy codeword? Answer with just the codeword.', 'user');
console.log('reply:', JSON.stringify(res.text.slice(0, 200)), '\ntools:', tools);
check(tools.some((t) => /skill_read/.test(t) && /Deploy codeword/i.test(t)), 'the agent loaded the skill by itself');
check(/ZEBRA-4417/.test(res.text), 'and answered with what the skill says');
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
