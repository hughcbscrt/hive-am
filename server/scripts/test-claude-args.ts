// The arguments and the stdin Claude Code really gets (no model): the base flags and what each permission adds, resume, model and effort,
// the instructions only as the system prompt in a new session and as an update inside the message of a resumed one, the browser,
// the hive MCP config and the inbox folder. A stub `claude` on PATH records each call.
//   HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-claude-args.ts
import './_guard.js';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DATA_DIR } from '../src/db.js';
import { CLAUDE_EDIT_DENY, runClaude } from '../src/providers/claude.js';
import { inboxDir } from '../src/connections/files.js';

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };

// The stub writes its arguments one per line and its stdin to files, then answers like `claude -p` does.
const dir = mkdtempSync(join(tmpdir(), 'cargs-'));
const argsFile = join(dir, 'args'), stdinFile = join(dir, 'stdin');
const f = join(dir, 'claude');
writeFileSync(f, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\ncat > "${stdinFile}"\necho '{"session_id":"s","type":"result","result":"ok"}'\n`);
chmodSync(f, 0o755);
process.env.PATH = `${dir}:${process.env.PATH}`;

const base: any = { id: 'claude-args', name: 'c', cwd: dir, model: '', permission: 'acceptEdits', session_id: null, browser: false };
const run = async (a: Record<string, unknown> = {}, o: Record<string, unknown> = {}) => {
  for await (const _ of runClaude({ agent: { ...base, ...a }, prompt: 'hello there', signal: new AbortController().signal, instructions: '', mcpCaps: [], refreshInstructions: false, ...o } as any)) void _;
  return { args: readFileSync(argsFile, 'utf8').split('\n').slice(0, -1), stdin: readFileSync(stdinFile, 'utf8') };
};
const after = (args: string[], flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);

// ---- 1. the base flags of a new session ----
let { args } = await run();
check(args.join(' ') === ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', 'acceptEdits', '--disallowedTools', ...CLAUDE_EDIT_DENY].join(' '),
  'a new acceptEdits session runs with the base flags and the protected files denied, nothing else');
check(['--resume', '--model', '--effort', '--chrome', '--mcp-config', '--append-system-prompt', '--allowedTools', '--add-dir'].every((x) => !args.includes(x)), 'and with no resume, model, effort, browser, MCP, instructions or extra folder');

// ---- 2. the other permissions ----
for (const permission of ['plan', 'bypassPermissions']) {
  ({ args } = await run({ permission }));
  check(after(args, '--permission-mode') === permission && !args.includes('--disallowedTools'), `${permission}: --permission-mode ${permission} and no --disallowedTools`);
}

// ---- 3. resume, model, effort ----
({ args } = await run({ session_id: 's1', model: 'sonnet' }, { effort: 'high' }));
check(after(args, '--resume') === 's1' && after(args, '--model') === 'sonnet' && after(args, '--effort') === 'high', 'a session adds --resume, a model --model and an effort --effort');

// ---- 4. the instructions as the system prompt ----
({ args } = await run({}, { instructions: 'RULES' }));
check(after(args, '--append-system-prompt') === 'RULES', 'a new session gets the instructions with --append-system-prompt');
({ args } = await run({ session_id: 's1' }, { instructions: 'RULES' }));
check(after(args, '--append-system-prompt') === 'RULES', 'so does a resumed one (the CLI ignores it there)');
({ args } = await run({}, { instructions: '' }));
check(!args.includes('--append-system-prompt'), 'no flag when there are no instructions');

// ---- 5. stdin of a new session: the message alone ----
let { stdin } = await run({}, { instructions: 'RULES' });
check(stdin === 'hello there' && !stdin.includes('<instructions'), 'a new session gets the message as it is, without the instructions a second time');

// ---- 6. stdin of a resumed session ----
({ stdin } = await run({ session_id: 's1' }, { instructions: 'RULES', refreshInstructions: false }));
check(stdin === 'hello there', 'a resumed session whose instructions did not change gets the message alone');
({ stdin } = await run({ session_id: 's1' }, { instructions: 'RULES', refreshInstructions: true }));
check(stdin.startsWith('<instructions update="true">') && stdin.split('RULES').length === 2 && stdin.endsWith('hello there'), 'one whose instructions changed gets them once, as an update before the message');

// ---- 7. the browser ----
({ args } = await run({ browser: true }));
check(args.includes('--chrome') && after(args, '--allowedTools') === 'mcp__claude-in-chrome', 'the Browser switch adds --chrome and allows mcp__claude-in-chrome');
({ args } = await run({ browser: true, permission: 'plan' }));
check(!args.includes('--chrome') && !args.includes('mcp__claude-in-chrome'), 'but not in read-only mode');

// ---- 8. the hive MCP tools ----
({ args } = await run({}, { mcpCaps: ['dispatch'] }));
const file = after(args, '--mcp-config');
const cfg = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
check(file === join(DATA_DIR, 'mcp', `${base.id}.json`) && cfg?.mcpServers?.hive?.env?.HIVE_CAPS === 'dispatch', '--mcp-config points at the agent\'s file, whose hive server gets the caps');
check(after(args, '--allowedTools') === 'mcp__hive', 'and mcp__hive is allowed');
({ args } = await run({ browser: true }, { mcpCaps: ['dispatch', 'channel'] }));
check(args.filter((x) => x === '--allowedTools').length === 1 && args.slice(args.indexOf('--allowedTools') + 1).join(' ') === 'mcp__claude-in-chrome mcp__hive', 'with the browser too, both follow one --allowedTools, the last option group');

// ---- 9. the inbox folder ----
mkdirSync(inboxDir('claude-inbox'), { recursive: true });
({ args } = await run({ id: 'claude-inbox' }));
check(after(args, '--add-dir') === inboxDir('claude-inbox'), 'an existing inbox folder is added with --add-dir');

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
