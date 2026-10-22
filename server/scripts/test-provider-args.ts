// How OpenCode, Kiro and Cursor receive the prompt: once, as the last argument (a leading dash gets a space so it is no option; `--` made OpenCode 2.x send it twice),
// how a history read back drops the duplicated copies, and a CLI that prints only prose is an error. For Cursor also the flags of a turn: resume, model,
// no effort, and what each permission adds.
//   HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-provider-args.ts
import './_guard.js';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pargs-'));
const log = join(dir, 'args.log');
const script = (name: string, body: string) => { const f = join(dir, name); writeFileSync(f, `#!/bin/sh\n${body}\n`); chmodSync(f, 0o755); return f; };
// Records the arguments one per line between markers; answers the flag probe (`run --help`) and then behaves as MODE says.
const record = `if [ "$2" = "--help" ]; then echo '--format --thinking --auto'; exit 0; fi
{ echo "<<<"; for a in "$@"; do printf '%s\\n' "$a"; done; echo ">>>"; } >> "${log}"`;
const stub = (mode: 'ok' | 'usage') => mode === 'ok'
  ? `${record}\necho '{"sessionID":"s1","part":{"type":"text","id":"p","text":"hi"}}'\necho '{"type":"runFinished","data":{"status":"success","finalText":"hi","sessionId":"s1"}}'\necho '{"type":"result","is_error":false,"result":"hi","session_id":"s1"}'`
  : `${record}\necho 'Usage: stub run [message..]'`;
const install = (mode: 'ok' | 'usage') => { script('opencode', stub(mode)); script('kiro-cli', stub(mode)); script('cursor-agent', stub(mode)); writeFileSync(log, ''); };
process.env.PATH = `${dir}:${process.env.PATH}`;

const { runOpencode } = await import('../src/providers/opencode.js');
const { runKiro } = await import('../src/providers/kiro.js');
const { runCursor } = await import('../src/providers/cursor.js');

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const agent: any = { id: 'a1', name: 'a', cwd: dir, model: null, permission: 'default', session_id: null };
const turn = (prompt: string, a = agent, effort?: string) => ({ agent: a, prompt, signal: new AbortController().signal, instructions: '', mcpCaps: [] as any, refreshInstructions: false, effort }) as any;
const run = async (fn: any, prompt: string, a = agent, effort?: string) => { try { for await (const _ of fn(turn(prompt, a, effort))) { /* drain */ } return ''; } catch (e) { return (e as Error).message; } };
// The last recorded call: its arguments, one per line.
const lastArgs = () => { const t = readFileSync(log, 'utf8'); const i = t.lastIndexOf('<<<\n'); return t.slice(i + 4, t.lastIndexOf('>>>')); };

for (const [name, fn] of [['opencode', runOpencode], ['kiro', runKiro], ['cursor', runCursor]] as const) {
  install('ok');
  for (const prompt of ['- haz esto', '--flag', 'dijo "hola" \'x\'\n- second line']) {
    check(await run(fn, prompt) === '', `${name}: a normal turn still works (${JSON.stringify(prompt.slice(0, 12))})`);
    const a = lastArgs();
    const sent = prompt.startsWith('-') ? ` ${prompt}` : prompt;
    check(a.endsWith(`\n${sent}\n`) && !a.includes('--\n') && a.split(prompt).length === 2, `${name}: ${JSON.stringify(prompt.slice(0, 12))} arrives once, last, without --`);
  }
  install('usage');
  const msg = await run(fn, '- hola');
  check(/produced no events/.test(msg) && /Usage: stub/.test(msg), `${name}: a CLI that prints only its usage ends the turn as an error`);
}

// Cursor: the flags of a turn
install('ok');
const flags = async (o: Record<string, unknown>, effort?: string) => { await run(runCursor, 'hola', { ...agent, ...o }, effort); return lastArgs().split('\n').slice(0, -2); };
let f = await flags({ permission: 'bypassPermissions' });
check(f.slice(0, 7).join(' ') === `-p --output-format stream-json --stream-partial-output --trust --workspace ${dir}`, 'cursor: a turn streams JSON with partial text, trusted, in the agent\'s folder');
check(!f.includes('--resume') && !f.includes('--model'), 'cursor: no --resume without a session and no --model without a model');
f = await flags({ permission: 'bypassPermissions', session_id: 'abc', model: 'gpt-5.3-codex-high' }, 'max');
check(f[f.indexOf('--resume') + 1] === 'abc' && f[f.indexOf('--model') + 1] === 'gpt-5.3-codex-high', 'cursor: --resume with the session and --model with the model');
check(!f.includes('--effort') && !f.includes('max'), 'cursor: an effort is never passed');
check(f.includes('--force') && !f.includes('--mode') && !f.includes('--sandbox'), 'cursor: full access runs with --force');
f = await flags({ permission: 'acceptEdits' });
check(f.includes('--force') && !f.includes('--mode'), 'cursor: editing runs with --force (its config denies the shell and protected files)');
f = await flags({ permission: 'plan' });
check(f.includes('--force') && f[f.indexOf('--mode') + 1] === 'plan', 'cursor: read-only runs with --mode plan (and --force, so MCP calls are not refused)');
check(!f.includes('--approve-mcps'), 'cursor: no --approve-mcps without hive tools');
await (async () => { try { for await (const _ of runCursor({ ...turn('x', { ...agent, cwd: dir, permission: 'plan' }), mcpCaps: ['dispatch'] })) { /* drain */ } } catch { /* only the arguments matter */ } })();
check(lastArgs().split('\n').includes('--approve-mcps'), 'cursor: with hive tools the servers are approved');

const { stripInstructions } = await import('../src/providers/preamble.js');
const blk = '<instructions>\nrules\n</instructions>\n\n';
const cases: [string, string, string][] = [
  ['first turn', `${blk}hola`, 'hola'],
  ['duplicated first turn', `${blk}1 comentario\n  > + x" "${blk}1 comentario\n  > + x`, '1 comentario\n  > + x'],
  ['duplicated later turn', 'hola" "hola', 'hola'],
  ['two different quoted parts stay', 'dijo "a" "b"', 'dijo "a" "b"'],
  ['plain', 'uno', 'uno'],
];
for (const [what, input, want] of cases) check(stripInstructions(input) === want, `history: ${what}`);
process.exit(fail ? 1 : 0);
