import type { Permission, StreamEvent, TurnOptions } from '../types.js';
import { DATA_DIR } from '../db.js';
import { join } from 'node:path';

const INBOX_ROOT = join(DATA_DIR, 'inbox');
import { spawnLines, safeJson } from './spawn.js';
import { dispatchMcpConfigOpencode } from '../mcp-config.js';
import { opencodeSessionDir } from '../history/opencode.js';
import { withInstructions } from './preamble.js';
import { opencodeServer, stopOpencodeServer, type ServerAccess } from './opencode-server.js';

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

/** OpenCode: `opencode run --format json`; parts arrive whole, so deltas are derived from per-part length. */
export async function* runOpencode(o: TurnOptions): AsyncGenerator<StreamEvent> {
  const { agent } = o;
  const args = ['run', '--format', 'json', '--thinking', '--auto'];
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
  if (o.mcpCaps.includes('channel') && !process.env.HIVE_AM_OPENCODE_STANDALONE) {
    try { access = await opencodeServer(agent.id, agent.cwd, config, o.signal); }
    catch (e) { console.warn(`[opencode] no persistent server for ${agent.name}, using a private one: ${e instanceof Error ? e.message : e}`); }
  }
  if (access) { args.splice(1, 0, '--server', access.url); env.OPENCODE_SERVER_PASSWORD = access.password; }
  else args.splice(1, 0, '--standalone');
  args.push(prompt);
  // Stopping a turn must really stop the model: a client that is killed would leave the server working on, so the server goes down with it.
  if (access) o.signal.addEventListener('abort', () => stopOpencodeServer(agent.id), { once: true });

  const seen = new Map<string, number>();
  const toolStarted = new Set<string>();
  let sawSession = false;

  try {
    for await (const line of spawnLines({ cmd: 'opencode', args, cwd: agent.cwd, env, signal: o.signal })) {
      const ev = safeJson(line);
      if (!ev) continue;
      if (ev.sessionID && !sawSession) { sawSession = true; yield { t: 'session', sessionId: ev.sessionID }; }
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
  } finally { access?.release(); }
  yield { t: 'done', ok: true };
}
