import type { Permission, StreamEvent, TurnOptions } from '../types.js';
import { DATA_DIR } from '../db.js';
import { join } from 'node:path';
import { execFile } from 'node:child_process';

const INBOX_ROOT = join(DATA_DIR, 'inbox');
import { spawnJson, StalledError } from './spawn.js';
import { dispatchMcpConfigOpencode } from '../mcp-config.js';
import { opencodeSessionDir } from '../history/opencode.js';
import { asPositional, withInstructions } from './preamble.js';
import { contextWindow } from '../context.js';
import { learnOpencodeWindows, opencodeServer, stopOpencodeServer, type ServerAccess } from './opencode-server.js';

/**
 * What OpenCode may do for each permission level. It has no such modes, so they are written as its own rules (a `deny` holds even with `--auto`):
 * read-only changes nothing; editing changes files of the project (including .env, never .git or keys), runs no commands and stays in the agent's folder
 * (OpenCode's "external directory" is whatever lies outside the folder the process starts in, which is the agent's effective folder) plus the
 * folder where received files are saved; full access leaves everything open.
 */
export function opencodePermissions(level: Permission): Record<string, unknown> {
  if (level === 'bypassPermissions') return {};
  const protectedFiles = { '.git/**': 'deny', '*.pem': 'deny', '*.key': 'deny' };   // .env stays editable: configuring a project needs it
  if (level === 'plan') return { edit: 'deny', bash: 'deny', task: 'deny' };
  return {
    read: { '*': 'allow' },   // OpenCode denies reading .env files unless told otherwise
    edit: { '*': 'allow', ...protectedFiles },
    bash: 'deny',
    task: 'deny',
    external_directory: { '*': 'deny', [`${INBOX_ROOT}/**`]: 'allow' },
  };
}

/**
 * OpenCode 1.x and 2.x take different flags (1.x has no `--standalone`, `--server` or maybe `--auto`; an unknown flag makes it print its help and exit 1).
 * The flags `opencode run` knows are read once from its help, and only those are passed.
 */
let runFlags: Promise<Set<string> | null> | null = null;
export function opencodeRunFlags(): Promise<Set<string> | null> {
  runFlags ??= new Promise<Set<string> | null>((resolve) => {
    execFile('opencode', ['run', '--help'], { timeout: 15_000, maxBuffer: 1 << 20 }, (_err, out, errOut) => {
      const found = new Set(`${out}\n${errOut}`.match(/--[a-z][a-z-]*/g) ?? []);
      if (!found.has('--format')) runFlags = null;      // no readable help: try again next turn, and pass the current flags meanwhile
      resolve(found.has('--format') ? found : null);
    });
  });
  return runFlags;
}

/** The text of an `error` event: OpenCode's message, with the provider's own when it only wraps one. */
function opencodeErrorText(err: any): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  const msg = String(err.message ?? err.data?.message ?? err.name ?? '').trim();
  return msg || (typeof err.type === 'string' ? err.type : '');
}

/** OpenCode: `opencode run --format json`; parts arrive whole, so deltas are derived from per-part length. */
export async function* runOpencode(o: TurnOptions): AsyncGenerator<StreamEvent> {
  const { agent } = o;
  const flags = await opencodeRunFlags();
  const has = (f: string) => !flags || flags.has(f);
  const args = ['run', '--format', 'json', ...['--thinking', '--auto'].filter(has)];
  // Sessions created while the folder was wrong (older hive-am builds) would keep running there; start fresh instead.
  const recorded = agent.session_id ? opencodeSessionDir(agent.session_id) : null;
  const resume = agent.session_id && (!recorded || recorded === agent.cwd) ? agent.session_id : null;
  if (resume) args.push('-s', resume);
  // The reasoning level goes as the model's `#variant` (low / medium / high).
  if (agent.model) args.push('-m', o.effort && !agent.model.includes('#') ? `${agent.model}#${o.effort}` : agent.model);
  const prompt = withInstructions(o.prompt, o.instructions, !!resume, o.refreshInstructions);

  // Turns are non-interactive: OpenCode's `question` tool would be dismissed and end the turn with exit code 1, so
  // deny it and the agent asks in plain text instead.
  const config = { permission: { question: 'deny', ...opencodePermissions(agent.permission) }, ...(o.mcpCaps.length ? dispatchMcpConfigOpencode(agent.id, o.mcpCaps) : {}) };
  const env: Record<string, string> = { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) };

  // `opencode run` normally talks to OpenCode's shared background service, which ignores the config we pass through the environment.
  // We need that config (the `hive` MCP, `question` denied, the permission rules), so the turn goes to a server of this agent that
  // started with it and keeps hive connected between turns. If that server cannot start, a private one-off server is used instead.
  let access: ServerAccess | null = null;
  // Only agents answering an external chat gain enough from it (somebody is waiting for a reply and the first `channel_reply` would fail); every other agent keeps the one-off server and costs nothing between turns.
  if (o.mcpCaps.includes('channel') && !process.env.HIVE_AM_OPENCODE_STANDALONE && has('--server')) {
    try { access = await opencodeServer(agent.id, agent.cwd, config, o.signal); }
    catch (e) { console.warn(`[opencode] no persistent server for ${agent.name}, using a private one: ${e instanceof Error ? e.message : e}`); }
  }
  if (!contextWindow('opencode', agent.model)) void learnOpencodeWindows(agent.cwd, access);
  if (access) { args.splice(1, 0, '--server', access.url); env.OPENCODE_SERVER_PASSWORD = access.password; }
  else if (has('--standalone')) args.splice(1, 0, '--standalone');      // 1.x always runs its own server
  // The prompt goes last; asPositional keeps a leading dash from being read as an option (see preamble.ts).
  args.push(asPositional(prompt));
  // Stopping a turn must really stop the model: a client that is killed would leave the server working on, so the server goes down with it.
  if (access) o.signal.addEventListener('abort', () => stopOpencodeServer(agent.id), { once: true });

  const seen = new Map<string, number>();
  const toolStarted = new Set<string>();
  let sawSession = false;
  // With `--format json` a failure (quota, usage limit, blocked response) is an `error` event on stdout and the exit code is just 1, so the reason is kept here.
  let failure = '';

  try {
    for await (const ev of spawnJson({ cmd: 'opencode', args, cwd: agent.cwd, env, signal: o.signal })) {
      if (ev.sessionID && !sawSession) { sawSession = true; yield { t: 'session', sessionId: ev.sessionID }; }
      if (ev.type === 'error') { failure = opencodeErrorText(ev.error) || failure; continue; }
      const p = ev.part;
      if (!p) continue;

      if (p.type === 'text' || p.type === 'reasoning') {
        const text: string = p.text ?? '';
        const prev = seen.get(p.id) ?? 0;
        if (text.length > prev) {
          seen.set(p.id, text.length);
          yield { t: p.type === 'text' ? 'text' : 'thinking', delta: text.slice(prev) };
        }
      } else if (p.type === 'step-finish') {
        const tk = p.tokens;
        if (tk) yield { t: 'usage', cost: p.cost || undefined, usage: { input: tk.input, output: tk.output, reasoning: tk.reasoning, cacheRead: tk.cache?.read, cacheWrite: tk.cache?.write } };
      } else if (p.type === 'tool') {
        const st = p.state ?? {};
        if (!toolStarted.has(p.callID ?? p.id)) {
          toolStarted.add(p.callID ?? p.id);
          yield { t: 'tool', id: p.callID ?? p.id, name: p.tool ?? p.name ?? 'tool', input: st.input };
        }
        if (st.status === 'completed' || st.status === 'error') {
          const out = typeof st.output === 'string' ? st.output : Array.isArray(st.content) ? st.content.map((c: any) => c.text ?? '').join('\n') : '';
          yield { t: 'tool_result', id: p.callID ?? p.id, output: out, error: st.status === 'error' };
        }
      }
    }
    if (failure) throw new Error(failure);
  } catch (e) {
    if (failure && !o.signal.aborted && !(e instanceof StalledError)) throw new Error(failure);      // OpenCode's own reason says more than "exited with code 1"
    throw e;
  } finally { access?.release(); }
  yield { t: 'done', ok: true };
}

/** Compacting a conversation needs OpenCode 2.x (the version that has `--standalone`). */
export async function opencodeCanCompact(): Promise<boolean> {
  const flags = await opencodeRunFlags();
  return !flags || flags.has('--standalone');
}
