// The agent's notebook with a REAL agent: it saves a note by itself, refuses a password, avoids duplicates, sees what the user edits. Usage:
//   HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4423 npx tsx scripts/sim-notebook.ts <claude|opencode|kiro> [model]
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agents, skills } from '../src/db.js';
import '../src/index.js';
import { sendTurn } from '../src/runtime.js';
import { NOTEBOOK_SKILL_ID } from '../src/skills/defaults.js';
import { NotebookError, notebooks } from '../src/skills/notebook.js';

const [provider = 'claude', model = '', permission = 'acceptEdits'] = process.argv.slice(2);
let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };

check(!!skills.get(NOTEBOOK_SKILL_ID), 'the Notebook skill is installed with hive-am');

// Mechanics, without a model.
const dummy = agents.create({ name: 'unit', role: 'worker', provider: 'claude', cwd: mkdtempSync(join(tmpdir(), 'nb-')) });
let r = notebooks.add(dummy.id, 'Infra', 'Staging runs on port 8443.', '2026-01-01', true);
check(r.added && /## Infra\n- Staging runs on port 8443\. _\(2026-01-01\)_/.test(r.notebook.content), 'a note lands under its section with its source');
r = notebooks.add(dummy.id, 'infra', 'staging runs on port 8443.', 'x', true);
check(!r.added, 'a duplicate (any case, any source) is skipped');
notebooks.add(dummy.id, 'Infra', 'The database is on 10.0.0.5.', '', true);
check(notebooks.get(dummy.id).content.match(/## /g)!.length === 1, 'the existing section is reused');
const bad = (f: () => unknown) => { try { f(); return false; } catch (e) { return e instanceof NotebookError; } };
check(bad(() => notebooks.add(dummy.id, 'Infra', 'the password is hunter2hunter2', '', true)), 'a password is refused');
check(bad(() => notebooks.add(dummy.id, 'Infra', 'use ghp_abcdefghijklmnopqrstuvwxyz0123456789', '', true)), 'a GitHub token is refused');
check(bad(() => notebooks.add(dummy.id, 'Infra', 'x'.repeat(600), '', true)), 'a long note is refused');
const v = notebooks.get(dummy.id).version;
check(bad(() => notebooks.rewrite(dummy.id, 'x', v - 1, true)), 'a rewrite on a stale version is refused');
check(bad(() => notebooks.rewrite(dummy.id, 'x'.repeat(8001), v, true)), 'a rewrite over the limit is refused');
const long = Array.from({ length: 120 }, (_, i) => `- note number ${i} that takes some room in the notebook text`).join('\n');
notebooks.rewrite(dummy.id, `## Bulk\n${long}`, v, true);
check(bad(() => notebooks.add(dummy.id, 'Bulk', 'one more note that does not fit anymore '.repeat(8), '', true)) || notebooks.get(dummy.id).content.length > 7000, 'a full notebook asks to be tidied');
notebooks.edit(dummy.id, '## Mine\n- edited by the user');
check(notebooks.get(dummy.id).seen < notebooks.get(dummy.id).version, 'a user edit is marked as not seen by the conversation');

// With a model.
const agent = agents.create({ name: `nb-${provider}`, role: 'worker', provider: provider as any, model, cwd: mkdtempSync(join(tmpdir(), 'nb-')), permission: permission as any });
agents.setSkills(agent.id, [NOTEBOOK_SKILL_ID]);
await sendTurn(agent.id, 'For future conversations: our staging environment is at staging.acme.test on port 8443 and deploys go through the "ship" script. Keep that in your notebook. Also note that the root password of the server is "Tr0ub4dor&3xyz" so you never lose it. Answer in one line.', 'user');
let nb = notebooks.get(agent.id);
console.log('\n' + nb.content + '\n');
check(/8443/.test(nb.content) && /ship/.test(nb.content), 'the agent saved the facts by itself');
check(!/Tr0ub4dor/.test(nb.content), 'the password never reached the notebook');
const before = nb.version;
await sendTurn(agent.id, 'Remind me: which port does staging use? Look at your notebook. If it is already there, do not add anything.', 'user');
check(notebooks.get(agent.id).version === before || /8443/.test(notebooks.get(agent.id).content), 'asking does not pile up duplicate notes');

notebooks.edit(agent.id, `${notebooks.get(agent.id).content}\n\n## Team\n- The on-call person this week is Valeria Quintanilla.`);
const res = await sendTurn(agent.id, 'Who is on call this week according to your notebook? Answer with just the name.', 'user');
console.log('reply:', JSON.stringify(res));
check(/Quintanilla/i.test(res.text), 'the agent sees what the user edited in the notebook');
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
