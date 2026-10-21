// How OpenCode and Kiro receive the prompt: once, as the last argument (a leading dash gets a space so it is no option; `--` made OpenCode 2.x send it twice),
// how a history read back drops the duplicated copies, and a CLI that prints only prose is an error.
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
  ? `${record}\necho '{"sessionID":"s1","part":{"type":"text","id":"p","text":"hi"}}'\necho '{"type":"runFinished","data":{"status":"success","finalText":"hi","sessionId":"s1"}}'`
  : `${record}\necho 'Usage: stub run [message..]'`;
const install = (mode: 'ok' | 'usage') => { script('opencode', stub(mode)); script('kiro-cli', stub(mode)); writeFileSync(log, ''); };
process.env.PATH = `${dir}:${process.env.PATH}`;

const { runOpencode } = await import('../src/providers/opencode.js');
const { runKiro } = await import('../src/providers/kiro.js');

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const agent: any = { id: 'a1', name: 'a', cwd: dir, model: null, permission: 'default', session_id: null };
const turn = (prompt: string) => ({ agent, prompt, signal: new AbortController().signal, instructions: '', mcpCaps: [] as any, refreshInstructions: false }) as any;
const run = async (fn: any, prompt: string) => { try { for await (const _ of fn(turn(prompt))) { /* drain */ } return ''; } catch (e) { return (e as Error).message; } };
// The last recorded call: its arguments, one per line.
const lastArgs = () => { const t = readFileSync(log, 'utf8'); const i = t.lastIndexOf('<<<\n'); return t.slice(i + 4, t.lastIndexOf('>>>')); };

for (const [name, fn] of [['opencode', runOpencode], ['kiro', runKiro]] as const) {
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
