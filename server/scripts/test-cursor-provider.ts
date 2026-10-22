// The Cursor adapter without a model: recorded `cursor-agent` output (stream-json with partial text) goes through a stub CLI, and what comes out is checked:
// the session, thinking, text once (not again when Cursor repeats it whole), tools and their results (a refused one is an error), usage and the end of the turn.
// Also the permission rules each level writes, the shared `.cursor/mcp.json`, the model list and the effort Cursor does not take.
//   HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-cursor-provider.ts
import './_guard.js';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cursor-'));
const bin = join(dir, 'bin'); mkdirSync(bin);
const out = join(dir, 'out.jsonl');
// The stub prints the file OUT and exits with CODE after writing ERR to stderr; it also records its environment.
writeFileSync(join(bin, 'cursor-agent'), `#!/bin/sh\nenv > "${dir}/env.txt"\ncat "${out}"\n[ -n "$ERR" ] && printf '%s' "$ERR" >&2\nexit \${CODE:-0}\n`);
chmodSync(join(bin, 'cursor-agent'), 0o755);
process.env.PATH = `${bin}:${process.env.PATH}`;
process.env.CURSOR_CONFIG_DIR = join(dir, 'user-config');                 // the person's own Cursor config, copied into each agent's
mkdirSync(process.env.CURSOR_CONFIG_DIR); writeFileSync(join(process.env.CURSOR_CONFIG_DIR, 'cli-config.json'), JSON.stringify({ version: 1, editor: { vimMode: true }, permissions: { allow: ['Shell(ls)'], deny: [] } }));

const { runCursor, cursorPermissions, writeCursorMcp } = await import('../src/providers/cursor.js');
const { parseCursorModels } = await import('../src/models.js');
const { checkEffort, effortOptions, resolveEffort } = await import('../src/efforts.js');
const { DATA_DIR } = await import('../src/db.js');

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const eq = (what: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); check(ok, ok ? what : `${what}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

const S = '2761a3b2-31c2-40fe-9480-636157e4f3c4';
const call = (n: number) => `call-6485136f-${n}\nfc_d559ccd7_${n}`;
const ts = (o: object) => ({ ...o, session_id: S, timestamp_ms: 1792704112128 });
const text = (t: string, stamped = true) => (stamped ? ts : (o: object) => ({ ...o, session_id: S }))({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: t }] } });
const shellArgs = { command: 'echo s > shell.txt', workingDirectory: '', timeout: 30000, toolCallId: call(2), simpleCommands: ['echo'], parsingResult: { parsingFailed: false } };
const mcpArgs = { name: 'hive-list_agents', args: {}, toolCallId: call(1), providerIdentifier: 'hive', toolName: 'list_agents', serverIdentifier: 'hive' };
// Recorded from cursor-agent 2026.10.22 (`-p --output-format stream-json --stream-partial-output --force --mode plan`), long fields shortened.
const recorded = [
  { type: 'system', subtype: 'init', apiKeySource: 'login', cwd: dir, session_id: S, model: 'Auto', permissionMode: 'default' },
  { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Call list_agents' }] }, session_id: S },
  ts({ type: 'thinking', subtype: 'delta', text: 'Calling the hive' }),
  ts({ type: 'thinking', subtype: 'delta', text: ' tool.' }),
  ts({ type: 'thinking', subtype: 'completed' }),
  text("I'll"), text(' call it.'),
  { ...text("I'll call it."), model_call_id: '4ed5861b-0-enx5' },
  ts({ type: 'tool_call', subtype: 'started', call_id: call(1), tool_call: { mcpToolCall: { args: mcpArgs }, toolCallId: call(1) } }),
  ts({ type: 'tool_call', subtype: 'started', call_id: call(2), tool_call: { shellToolCall: { args: shellArgs }, toolCallId: call(2) } }),
  ts({ type: 'tool_call', subtype: 'completed', call_id: call(1), tool_call: { mcpToolCall: { args: mcpArgs, result: { success: { content: [{ text: { text: '- Dev (worker)' } }], isError: false } } } } }),
  ts({ type: 'tool_call', subtype: 'completed', call_id: call(2), tool_call: { shellToolCall: { args: shellArgs, result: { permissionDenied: { command: 'echo s > shell.txt', error: 'Command blocked by permissions configuration' } } } } }),
  text('Done:'), text(' one agent.'),
  text('Done: one agent.', false),
  { type: 'result', subtype: 'success', duration_ms: 8735, is_error: false, result: "I'll call it.Done: one agent.", session_id: S, usage: { inputTokens: 9287, outputTokens: 896, cacheReadTokens: 4480, cacheWriteTokens: 12 } },
];
const play = (lines: object[]) => writeFileSync(out, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
const agent = (o: Record<string, unknown> = {}): any => ({ id: 'cur1', name: 'c', provider: 'cursor', cwd: dir, model: '', permission: 'bypassPermissions', session_id: null, ...o });
const turn = (a: any, caps: string[] = []) => ({ agent: a, prompt: 'hi', instructions: '', mcpCaps: caps, signal: new AbortController().signal }) as any;
const collect = async (a: any, caps: string[] = []) => { const evs: any[] = []; let err = ''; try { for await (const e of runCursor(turn(a, caps))) evs.push(e); } catch (e) { err = (e as Error).message; } return { evs, err }; };

// ---- the stream ----
play(recorded);
let { evs, err } = await collect(agent());
check(err === '', 'a recorded turn runs');
eq('the session comes from system/init', evs.filter((e) => e.t === 'session'), [{ t: 'session', sessionId: S }]);
eq('thinking streams', evs.filter((e) => e.t === 'thinking').map((e) => e.delta).join(''), 'Calling the hive tool.');
eq('text streams once, without the whole copies Cursor repeats before a tool and at the end', evs.filter((e) => e.t === 'text').map((e) => e.delta).join(''), "I'll call it.Done: one agent.");
const tools = evs.filter((e) => e.t === 'tool');
eq('an MCP call is named like the others (mcp__hive__list_agents) with its arguments', tools[0] && { id: tools[0].id, name: tools[0].name, input: tools[0].input }, { id: call(1), name: 'mcp__hive__list_agents', input: {} });
eq('a shell call is Shell with its command', tools[1] && { name: tools[1].name, input: tools[1].input }, { name: 'Shell', input: { command: 'echo s > shell.txt', timeout: 30000 } });
const results = evs.filter((e) => e.t === 'tool_result');
eq('a successful result carries its text', results[0], { t: 'tool_result', id: call(1), output: '- Dev (worker)', error: false });
eq('a refused call is an error with Cursor\'s reason', results[1], { t: 'tool_result', id: call(2), output: 'Command blocked by permissions configuration', error: true });
eq('usage comes from the result', evs.find((e) => e.t === 'usage'), { t: 'usage', durationMs: 8735, model: 'Auto', usage: { input: 9287, output: 896, cacheRead: 4480, cacheWrite: 12 } });
eq('the turn ends done', evs.at(-1), { t: 'done', ok: true, summary: "I'll call it.Done: one agent." });

// without partial output every message comes whole and is the text
play([recorded[0], text('Hello', false), text(' again', false), { type: 'result', subtype: 'success', is_error: false, result: 'Hello again', session_id: S }]);
({ evs } = await collect(agent()));
eq('whole messages (no pieces before them) are the text', evs.filter((e) => e.t === 'text').map((e) => e.delta), ['Hello', ' again']);

// a write and a rejected one, as the edit tool reports them
const editArgs = { path: join(dir, '.git/x'), streamContent: 'x\n' };
play([recorded[0],
  ts({ type: 'tool_call', subtype: 'started', call_id: 'e1', tool_call: { editToolCall: { args: editArgs } } }),
  ts({ type: 'tool_call', subtype: 'completed', call_id: 'e1', tool_call: { editToolCall: { args: editArgs, result: { writePermissionDenied: { path: editArgs.path, error: 'Write permission denied: .git/x: Blocked by permissions configuration' } } } } }),
  ts({ type: 'tool_call', subtype: 'started', call_id: 'e2', tool_call: { editToolCall: { args: { path: 'a' } } } }),
  ts({ type: 'tool_call', subtype: 'completed', call_id: 'e2', tool_call: { editToolCall: { args: { path: 'a' }, result: { rejected: { reason: 'rejected' } } } } }),
  ts({ type: 'tool_call', subtype: 'started', call_id: 's1', tool_call: { shellToolCall: { args: { command: 'false' } } } }),
  ts({ type: 'tool_call', subtype: 'completed', call_id: 's1', tool_call: { shellToolCall: { args: { command: 'false' }, result: { success: { exitCode: 1, stdout: '', stderr: 'nope' } } } } }),
  { type: 'result', subtype: 'success', is_error: false, result: '', session_id: S }]);
({ evs } = await collect(agent()));
eq('a new file is shown as Write with its contents', evs.find((e) => e.t === 'tool'), { t: 'tool', id: 'e1', name: 'Write', input: { path: editArgs.path, contents: 'x\n' } });
const rs = evs.filter((e) => e.t === 'tool_result');
check(rs[0]?.error === true && /Blocked by permissions/.test(rs[0].output), 'a write the rules refuse is an error');
check(rs[1]?.error === true && rs[1].output === 'rejected', 'so is a rejected one');
eq('a command that fails says its exit code', rs[2], { t: 'tool_result', id: 's1', output: 'nope\nExit code: 1', error: false });

// errors
play([recorded[0], { type: 'result', subtype: 'error', is_error: true, result: 'Usage limit reached', session_id: S }]);
({ evs } = await collect(agent()));
eq('a result with is_error is the turn\'s error', evs.at(-1), { t: 'error', message: 'Usage limit reached' });
play([recorded[0], recorded[1]]);
const list = 'Cannot use this model: nope. Available models: auto, ' + Array.from({ length: 400 }, (_, i) => `model-${i}`).join(', ');
process.env.ERR = list; process.env.CODE = '1';
({ err } = await collect(agent({ model: 'nope' })));
check(/^cursor-agent exited with code 1: Cannot use this model: nope\./.test(err), 'an unknown model fails the turn with Cursor\'s reason, not the end of its model list');
process.env.ERR = 'ActionRequiredError: Named models unavailable Free plans can only use Auto.';
({ err } = await collect(agent({ model: 'composer-2.5' })));
check(/Named models unavailable/.test(err), 'so does a model the plan does not allow');
delete process.env.ERR; delete process.env.CODE;
writeFileSync(out, 'Usage: agent [options]\n');
({ err } = await collect(agent()));
check(/produced no events/.test(err), 'a CLI that prints no events is an error');

// ---- permissions ----
eq('full access has no rules (the person\'s own config)', cursorPermissions('bypassPermissions'), null);
eq('read-only writes nothing and runs no shell', cursorPermissions('plan'), { allow: [], deny: ['Write(**)', 'Shell(*)'] });
eq('editing runs no shell and never writes .git or keys', cursorPermissions('acceptEdits'), { allow: [], deny: ['Shell(*)', 'Write(**/.git/**)', 'Write(**/*.pem)', 'Write(**/*.key)'] });
play([recorded[0], recorded.at(-1)!]);
const envOf = () => Object.fromEntries(readFileSync(join(dir, 'env.txt'), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
await collect(agent({ permission: 'acceptEdits' }));
const cfgDir = join(DATA_DIR, 'cursor', 'cur1');
check(envOf().CURSOR_CONFIG_DIR === cfgDir, 'a limited agent runs with its own config folder');
const cfg = JSON.parse(readFileSync(join(cfgDir, 'cli-config.json'), 'utf8'));
check(cfg.editor?.vimMode === true && JSON.stringify(cfg.permissions) === JSON.stringify(cursorPermissions('acceptEdits')), 'which keeps the person\'s settings and replaces the rules');
await collect(agent({ permission: 'plan' }));
check(JSON.parse(readFileSync(join(cfgDir, 'cli-config.json'), 'utf8')).permissions.deny.includes('Write(**)'), 'a changed permission rewrites the rules for the next turn');
await collect(agent({ permission: 'bypassPermissions' }));
check(envOf().CURSOR_CONFIG_DIR === process.env.CURSOR_CONFIG_DIR, 'full access keeps the person\'s config');

// ---- MCP ----
const proj = join(dir, 'proj'); mkdirSync(join(proj, 'sub', '.cursor'), { recursive: true });
execFileSync('git', ['init', '-q'], { cwd: proj });
const sub = join(proj, 'sub');
writeFileSync(join(sub, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { mine: { command: 'x' } }, other: true }));
await collect(agent({ cwd: sub }), ['dispatch']);
const mcp = JSON.parse(readFileSync(join(sub, '.cursor', 'mcp.json'), 'utf8'));
check(mcp.mcpServers.mine?.command === 'x' && mcp.other === true, 'the person\'s own servers stay');
check(mcp.mcpServers.hive?.env?.HIVE_AGENT_ID === '${env:HIVE_AGENT_ID}' && mcp.mcpServers.hive.env.HIVE_CAPS === '${env:HIVE_CAPS}' && mcp.mcpServers.hive.env.HIVE_AM_API === '${env:HIVE_AM_API}', 'the hive entry reads the agent from the env, so one file serves every agent');
const e1 = envOf();
check(e1.HIVE_AGENT_ID === 'cur1' && e1.HIVE_CAPS === 'dispatch' && /^http:\/\/127\.0\.0\.1:\d+$/.test(e1.HIVE_AM_API), 'and the turn sets that env');
check(readFileSync(join(proj, '.git', 'info', 'exclude'), 'utf8').split('\n').includes('/sub/.cursor/mcp.json'), 'the file is kept out of git status');
check(execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: proj, encoding: 'utf8' }).trim() === '', 'git status is clean');
const before = readFileSync(join(sub, '.cursor', 'mcp.json'), 'utf8');
writeCursorMcp(sub);
check(readFileSync(join(sub, '.cursor', 'mcp.json'), 'utf8') === before && readFileSync(join(proj, '.git', 'info', 'exclude'), 'utf8').split('/sub/.cursor/mcp.json').length === 2, 'a second turn changes nothing and adds no second line');
writeFileSync(join(sub, '.cursor', 'mcp.json'), '{ "mcpServers": { "mine": ');
writeCursorMcp(sub);
check(readFileSync(join(sub, '.cursor', 'mcp.json'), 'utf8') === '{ "mcpServers": { "mine": ', 'a file that is not valid JSON is left alone');
const plain = join(dir, 'plain'); mkdirSync(plain);
await collect(agent({ cwd: plain }));
check(!existsSync(join(plain, '.cursor')) && envOf().HIVE_CAPS === '', 'an agent without hive tools writes no file and gets no tools from a shared one');

// ---- models and effort ----
eq('models come from --list-models', parseCursorModels('Available models\n\nauto - Auto (current, default)\ngpt-5.3-codex-high - Codex 5.3 High\ngrok-4.7-low-fast - Grok 4.7  Low Fast​​\n\nTip: use --model'), [
  { id: 'auto', label: 'Auto' }, { id: 'gpt-5.3-codex-high', label: 'Codex 5.3 High' }, { id: 'grok-4.7-low-fast', label: 'Grok 4.7  Low Fast' }]);
eq('models parse through ANSI colors', parseCursorModels('\x1b[2mAvailable models\x1b[22m\n\n\x1b[32mauto\x1b[39m \x1b[2m- Auto\x1b[22m\x1b[2m (current, default)\x1b[22m\n\x1b[36mgpt-5.3-codex\x1b[39m \x1b[2m- Codex 5.3\x1b[22m\n'), [
  { id: 'auto', label: 'Auto' }, { id: 'gpt-5.3-codex', label: 'Codex 5.3' }]);
check(['low', 'high', 'max', 'xhigh'].every((e) => checkEffort('cursor', 'gpt-5.3-codex', e) !== null) && checkEffort('cursor', 'auto', '') === null, 'Cursor refuses any effort, and the default is fine');
eq('and offers none', effortOptions('cursor', 'auto'), { options: [], known: true });
check(resolveEffort('cursor', 'auto', 'max') === '', 'a connection\'s effort runs Cursor at its default');

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
