// Reading a Cursor conversation back from its transcript (`~/.cursor/projects/<folder>/agent-transcripts/<id>/<id>.jsonl`), without a model:
// the person's text without our instructions or Cursor's wrappers, the replies of a turn as one message, and the tool calls named as hive-am shows them.
//   HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-cursor-history.ts
import './_guard.js';
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const data = mkdtempSync(join(tmpdir(), 'cursor-data-'));
process.env.CURSOR_DATA_DIR = data;
const { cursorSlug, cursorUserText, readCursor, cursorSig } = await import('../src/history/cursor.js');
const { readHistory, historySig } = await import('../src/history/index.js');
const { withInstructions } = await import('../src/providers/preamble.js');

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const eq = (what: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); check(ok, ok ? what : `${what}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

eq('the folder name is Cursor\'s', cursorSlug('/home/hugh/Documentos/projects/my_app.v2'), 'home-hugh-Documentos-projects-my-app-v2');
const cwd = '/tmp/some folder/proj';
const S = '72f3bd62-e98f-42be-b8bb-3bce6449bb3e';
const file = join(data, 'projects', cursorSlug(cwd), 'agent-transcripts', S, `${S}.jsonl`);
mkdirSync(join(file, '..'), { recursive: true });
const user = (text: string) => ({ role: 'user', message: { content: [{ type: 'text', text: `<timestamp>Thursday, Oct 22, 2026, 3:17 PM (UTC-6)</timestamp>\n<user_query>\n${text}\n</user_query>` }] } });
const said = (...content: object[]) => ({ role: 'assistant', message: { content } });
// Shaped as cursor-agent 2026.10.22 writes it (paths shortened).
const lines = [
  user(withInstructions('- create normal.txt', 'You are Dev.\n## Skills\n...', false)),
  said({ type: 'text', text: "I'll write it." }, { type: 'tool_use', name: 'Write', input: { path: '/tmp/p/normal.txt', contents: 'ok\n' } }),
  said({ type: 'tool_use', name: 'Shell', input: { command: 'ls', description: 'List files' } }),
  said({ type: 'tool_use', name: 'GetDynamicTools', input: { namespace: 'hive', toolName: 'list_agents' } }),
  said({ type: 'tool_use', name: 'CallDynamicTool', input: { namespace: 'hive', toolName: 'dispatch', mcpDetails: { description: 'x' }, arguments: { agent: 'Dev', task: 'fix it' } } }),
  said({ type: 'text', text: 'Done.' }),
  { type: 'turn_ended', status: 'success' },
  user(withInstructions('second', 'new rules', true, true)),
  said({ type: 'tool_use', name: 'SendToCall', input: { message: 'Hi there' } }),
  said({ type: 'text', text: 'Hi there' }),
  { type: 'turn_ended', status: 'success' },
];
writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n{"role":"assist');

const msgs = readCursor(cwd, S);
eq('user, reply, user, reply', msgs.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
eq('the person\'s text has no instructions block and no Cursor wrappers', msgs[0].blocks, [{ type: 'text', text: '- create normal.txt' }]);
eq('nor does a later one with an instructions update', msgs[2].blocks, [{ type: 'text', text: 'second' }]);
const reply = msgs[1].blocks;
eq('the steps of a reply are one message, in order', reply.map((b) => b.type === 'tool' ? b.name : b.type), ['text', 'Write', 'Shell', 'GetDynamicTools', 'mcp__hive__dispatch', 'text']);
const tool = (name: string) => reply.find((b) => b.type === 'tool' && b.name === name) as any;
eq('a write keeps its path and contents', tool('Write').input, { path: '/tmp/p/normal.txt', contents: 'ok\n' });
eq('a shell call keeps its command', tool('Shell').input, { command: 'ls', description: 'List files' });
eq('an MCP call is named like the others, with its arguments', tool('mcp__hive__dispatch').input, { agent: 'Dev', task: 'fix it' });
check(reply.every((b) => b.type !== 'tool' || (b.output === undefined && typeof b.id === 'string' && b.id)), 'tools have an id and no output (the transcript keeps none)');
check(new Set(reply.filter((b) => b.type === 'tool').map((b: any) => b.id)).size === 4, 'and their ids are distinct');
eq('SendToCall, which repeats the reply, is left out', msgs[3].blocks, [{ type: 'text', text: 'Hi there' }]);
check(msgs.every((m) => m.ts === null && !m.meta), 'no times or usage are made up');

eq('a bare query (no instructions) is read as typed', cursorUserText('<timestamp>x</timestamp>\n<user_query>\nhola\n</user_query>'), 'hola');
eq('text without wrappers stays', cursorUserText('plain'), 'plain');

// through the registry, and when the folder moved
check(readHistory({ provider: 'cursor', cwd, session_id: S }).length === 4, 'the registry reads it');
check(readCursor('/somewhere/else', S).length === 4, 'a conversation is found even if its folder was renamed');
const sig = cursorSig(cwd, S);
check(!!sig && historySig({ provider: 'cursor', cwd }, S) === sig, 'it has a signature');
appendFileSync(file, '\n' + JSON.stringify(said({ type: 'text', text: 'more' })) + '\n');
check(cursorSig(cwd, S) !== sig, 'which changes when the conversation grows');
check(readCursor(cwd, '00000000-0000-0000-0000-000000000000').length === 0 && cursorSig(cwd, '00000000-0000-0000-0000-000000000000') === null, 'an unknown conversation reads as empty');
check(readCursor(cwd, '../../etc/passwd').length === 0 && cursorSig(cwd, 'x') === null, 'and so does a malformed id');

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
