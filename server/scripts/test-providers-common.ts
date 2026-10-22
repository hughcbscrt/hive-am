// The shared pieces of the provider adapters and history readers: JSON lines, process cleanup, text helpers.
//   HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-providers-common.ts
import './_guard.js';
process.env.HIVE_AM_KILL_GRACE_MS = '200';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { spawnJson, spawnLines, flattenText } = await import('../src/providers/spawn.js');
const { stripInstructions, withInstructions } = await import('../src/providers/preamble.js');
const { jsonLines } = await import('../src/history/lines.js');
const { historyReaders, readHistory } = await import('../src/history/index.js');

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const dir = mkdtempSync(join(tmpdir(), 'prov-'));
const script = (name: string, body: string) => { const f = join(dir, name); writeFileSync(f, `#!/bin/sh\n${body}\n`); chmodSync(f, 0o755); return f; };
const collect = async <T,>(it: AsyncGenerator<T>) => { const out: T[] = []; for await (const x of it) out.push(x); return out; };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ac = () => new AbortController();

// JSON lines: banners and blank lines are skipped, objects come out parsed
const noisy = script('noisy.sh', `echo 'warning: something'; echo '{"a":1}'; echo; echo '{"b":2}'`);
check(JSON.stringify(await collect(spawnJson({ cmd: noisy, args: [], cwd: dir, signal: ac().signal }))) === '[{"a":1},{"b":2}]', 'spawnJson skips lines that are not JSON');

// the prompt goes through stdin
const cat = script('cat.sh', 'cat');
check((await collect(spawnLines({ cmd: cat, args: [], cwd: dir, stdin: 'hello\nworld\n', signal: ac().signal }))).join('|') === 'hello|world', 'stdin reaches the CLI');

// a CLI that quits without reading its prompt does not crash the server (EPIPE on stdin)
const quit = script('quit.sh', 'exit 3');
let msg = '';
try { await collect(spawnLines({ cmd: quit, args: [], cwd: dir, stdin: 'x'.repeat(5_000_000), signal: ac().signal })); } catch (e) { msg = (e as Error).message; }
check(/exited with code 3/.test(msg), 'a CLI that exits early is reported by its exit code, not by a stdin error');

// stderr tail in the error, and a missing CLI
const err = script('err.sh', 'echo boom >&2; exit 1');
msg = ''; try { await collect(spawnLines({ cmd: err, args: [], cwd: dir, signal: ac().signal })); } catch (e) { msg = (e as Error).message; }
check(/code 1: boom/.test(msg), 'the end of stderr is part of the error');
msg = ''; try { await collect(spawnLines({ cmd: join(dir, 'nope'), args: [], cwd: dir, signal: ac().signal })); } catch (e) { msg = (e as Error).message; }
check(/ENOENT/.test(msg), 'a CLI that is not installed says so');

// a stopped turn leaves no process behind, even if the CLI ignores SIGTERM
const stubborn = script('stubborn.sh', `trap '' TERM\necho $$\nwhile true; do sleep 0.1; done`);
const c = ac();
let pid = 0;
const it = spawnLines({ cmd: stubborn, args: [], cwd: dir, signal: c.signal });
const first = await it.next(); pid = Number(first.value);
check(pid > 0 && alive(pid), 'the CLI is running');
c.abort();
await it.return(undefined);
await sleep(700);
check(!alive(pid), 'a CLI that ignores SIGTERM is cut off after the grace period');

// text helpers
check(flattenText('a') === 'a' && flattenText([{ text: 'x' }, 'y']) === 'x\ny' && flattenText(null) === '' && flattenText({ k: 1 }) === '{"k":1}', 'flattenText handles strings, block lists, null and objects');
const wrapped = withInstructions('question', 'be nice', false);
check(stripInstructions(wrapped) === 'question' && stripInstructions(withInstructions('q', 'x', true, true)) === 'q', 'the instructions block is taken off a stored message');
check(stripInstructions('plain') === 'plain', 'a message without the block is unchanged');

// history
const f = join(dir, 't.jsonl');
writeFileSync(f, '{"a":1}\n\n{"b":\n{"c":3}\n{"d"');
check(JSON.stringify([...jsonLines(f)]) === '[{"a":1},{"c":3}]', 'jsonLines skips damaged and partial lines');
check(Object.keys(historyReaders).sort().join() === 'claude,cursor,kiro,opencode', 'there is a reader for every provider');
for (const provider of ['kiro', 'cursor'] as const) {
  check(readHistory({ provider, cwd: dir, session_id: null }).length === 0 && readHistory({ provider, cwd: dir, session_id: 'not-a-uuid' }).length === 0 && readHistory({ provider, cwd: dir, session_id: '00000000-0000-0000-0000-000000000000' }).length === 0, `${provider}: an unknown or malformed session reads as empty`);
}

// OpenCode: its failure comes as an `error` event with exit code 1, and the reason (not "exited with code 1") is what the turn reports; flags the CLI lacks are not passed
const fakeBin = join(dir, 'bin'); mkdirSync(fakeBin);
const fake = (body: string) => { const f = join(fakeBin, 'opencode'); writeFileSync(f, `#!/bin/sh\n${body}\n`); chmodSync(f, 0o755); };
fake(`if [ "$2" = "--help" ]; then echo '  --format choice'; echo '  --thinking'; exit 0; fi
echo "$@" > "${dir}/args.txt"
echo '{"type":"error","sessionID":"ses_x","error":{"type":"provider.quota","message":"Go usage limit exceeded"}}'; exit 1`);
process.env.PATH = `${fakeBin}:${process.env.PATH}`;
const { runOpencode } = await import('../src/providers/opencode.js');
const agent = { id: 'a', name: 'a', provider: 'opencode', model: '', permission: 'bypassPermissions', cwd: dir, session_id: null } as any;
let reason = '';
try { await collect(runOpencode({ agent, prompt: 'hi', instructions: '', mcpCaps: [], signal: ac().signal })); } catch (e) { reason = e instanceof Error ? e.message : String(e); }
check(reason === 'Go usage limit exceeded', 'an OpenCode error event is the reason of the failed turn');
const passed = readFileSync(join(dir, 'args.txt'), 'utf8');
check(passed.includes('--thinking') && !passed.includes('--standalone') && !passed.includes('--auto'), 'flags the installed OpenCode lacks are not passed');

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
