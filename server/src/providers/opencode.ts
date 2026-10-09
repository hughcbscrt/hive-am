import type { Permission, StreamEvent, TurnOptions } from '../types.js';
import { DATA_DIR } from '../db.js';
import { join } from 'node:path';

const INBOX_ROOT = join(DATA_DIR, 'inbox');
import { spawnLines, safeJson } from './spawn.js';
import { dispatchMcpConfigOpencode } from '../mcp-config.js';
import { opencodeSessionDir } from '../history/opencode.js';
import { withInstructions } from './preamble.js';

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
  // `opencode run` normally talks to OpenCode's background service, which ignores the config we pass through the
  // environment. A private (standalone) server reads it, which we need for the `dispatch` MCP and to deny `question`.
  args.splice(1, 0, '--standalone');
  // Sessions created while the folder was wrong (older hive-am builds) would keep running there; start fresh instead.
  const recorded = agent.session_id ? opencodeSessionDir(agent.session_id) : null;
  const resume = agent.session_id && (!recorded || recorded === agent.cwd) ? agent.session_id : null;
  if (resume) args.push('-s', resume);
  if (agent.model) args.push('-m', agent.model);
  const prompt = withInstructions(o.prompt, o.instructions, !!resume, o.refreshInstructions);
  args.push(prompt);

  // Turns are non-interactive: OpenCode's `question` tool would be dismissed and end the turn with exit code 1, so
  // deny it and the agent asks in plain text instead.
  const config = { permission: { question: 'deny', ...opencodePermissions(agent.permission) }, ...(o.mcpCaps.length ? dispatchMcpConfigOpencode(agent.id, o.mcpCaps) : {}) };
  const env: Record<string, string> = { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) };

  const seen = new Map<string, number>();
  const toolStarted = new Set<string>();
  let sawSession = false;

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
  yield { t: 'done', ok: true };
}
