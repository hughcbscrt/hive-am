import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { Permission, StreamEvent, TurnOptions } from '../types.js';
import { DATA_DIR } from '../db.js';
import { spawnJson } from './spawn.js';
import { asPositional, withInstructions } from './preamble.js';
import { cursorMcpEnv, cursorMcpServer } from '../mcp-config.js';
import { cursorTool } from '../history/cursor.js';

/**
 * What Cursor may do for each permission level, as the `permissions` of its config. A turn under `-p` cannot ask, and without `--force` every MCP call is
 * refused, so every turn runs with `--force` and these rules (which `--force` does not override) set the limits: read-only writes nothing and runs no
 * shell, even if the model switches out of plan mode; editing writes project files (including .env, never .git or keys) and runs no shell, because
 * Cursor's sandbox lets a command write anywhere. Its file tool can still write outside the agent's folder: Cursor has no rule for that.
 */
export function cursorPermissions(level: Permission): { allow: string[]; deny: string[] } | null {
  if (level === 'bypassPermissions') return null;
  if (level === 'plan') return { allow: [], deny: ['Write(**)', 'Shell(*)'] };
  return { allow: [], deny: ['Shell(*)', 'Write(**/.git/**)', 'Write(**/*.pem)', 'Write(**/*.key)'] };
}

/** Where Cursor keeps its own config (`cli-config.json`): the person's settings are copied from there. */
const userConfigDir = () => process.env.CURSOR_CONFIG_DIR?.trim() || (process.env.XDG_CONFIG_HOME?.trim() ? join(process.env.XDG_CONFIG_HOME, 'cursor') : join(homedir(), '.cursor'));

/**
 * A config folder for this agent (`CURSOR_CONFIG_DIR`): the person's own `cli-config.json` with the permission rules of the level. Rewritten every turn,
 * so a changed permission applies to the next message. Sign-in and conversations live elsewhere and are not affected.
 */
function cursorConfigDir(agentId: string, rules: { allow: string[]; deny: string[] }): string {
  let cfg: Record<string, unknown> = { version: 1 };
  try { cfg = JSON.parse(readFileSync(join(userConfigDir(), 'cli-config.json'), 'utf8')); } catch { /* no config yet: Cursor fills in the rest */ }
  const dir = join(DATA_DIR, 'cursor', agentId); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'cli-config.json'), JSON.stringify({ ...cfg, permissions: rules }, null, 2));
  return dir;
}

const excluded = new Set<string>();
/** Keeps the generated `.cursor/mcp.json` out of `git status`: added once to the repository's `.git/info/exclude` (local, never committed). */
function excludeFromGit(cwd: string): void {
  if (excluded.has(cwd)) return;
  excluded.add(cwd);
  try {
    const git = (...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
    const pathOut = git('rev-parse', '--git-path', 'info/exclude');
    const file = isAbsolute(pathOut) ? pathOut : join(cwd, pathOut);
    const line = `/${git('rev-parse', '--show-prefix')}.cursor/mcp.json`;
    const now = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (now.split('\n').includes(line)) return;
    mkdirSync(join(file, '..'), { recursive: true });
    appendFileSync(file, `${now && !now.endsWith('\n') ? '\n' : ''}${line}\n`);
  } catch { /* not a repository */ }
}

/**
 * Cursor reads MCP servers only from `<folder>/.cursor/mcp.json` (or the person's global one). The `hive` entry is merged into whatever servers the
 * person has there, and the file is written only when it changes.
 */
export function writeCursorMcp(cwd: string): void {
  const dir = join(cwd, '.cursor'); const file = join(dir, 'mcp.json');
  let cfg: { mcpServers?: Record<string, unknown> } = {};
  const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (before) { try { cfg = JSON.parse(before); } catch { return; } }   // a file the person is editing is not overwritten
  const next = JSON.stringify({ ...cfg, mcpServers: { ...(cfg.mcpServers ?? {}), hive: cursorMcpServer() } }, null, 2);
  if (next !== before) { mkdirSync(dir, { recursive: true }); writeFileSync(file, next); }
  excludeFromGit(cwd);
}

/** A tool as hive-am shows it: the key of a `tool_call` (`shellToolCall`) is the tool, named as Cursor's transcript names it (`Shell`). */
export function cursorStreamTool(call: Record<string, any>): { name: string; input: unknown } | null {
  const key = Object.keys(call ?? {}).find((k) => k.endsWith('ToolCall'));
  if (!key) return null;
  const a = call[key]?.args ?? {};
  const base = key.slice(0, -'ToolCall'.length);
  if (base === 'mcp') return cursorTool('CallDynamicTool', { namespace: a.providerIdentifier ?? a.serverIdentifier, toolName: a.toolName, arguments: a.args });
  if (base === 'shell') return { name: 'Shell', input: { command: a.command, ...(a.workingDirectory ? { cwd: a.workingDirectory } : {}), ...(a.timeout ? { timeout: a.timeout } : {}) } };
  if (base === 'edit' && typeof a.streamContent === 'string') return { name: 'Write', input: { path: a.path, contents: a.streamContent } };
  const { toolCallId: _id, ...input } = a;
  return { name: base.charAt(0).toUpperCase() + base.slice(1), input };
}

/** What a finished tool returned, and whether it failed: anything but `success` (`rejected`, `permissionDenied`, `error`…) is a failure. */
export function cursorToolResult(call: Record<string, any>): { output: string; error: boolean } {
  const key = Object.keys(call ?? {}).find((k) => k.endsWith('ToolCall'));
  const r = (key && call[key]?.result) ?? {};
  const kind = Object.keys(r)[0] ?? '';
  const v = r[kind] ?? {};
  if (kind !== 'success') return { output: String(v.error ?? v.reason ?? v.message ?? (kind || 'no result')), error: true };
  if (key === 'mcpToolCall') {
    const text = (Array.isArray(v.content) ? v.content : []).map((c: any) => c?.text?.text ?? c?.text ?? '').filter((t: unknown) => typeof t === 'string' && t).join('\n');
    return { output: text, error: !!v.isError };
  }
  if (key === 'shellToolCall') {
    const out = v.interleavedOutput || [v.stdout, v.stderr].filter(Boolean).join('\n');
    return { output: `${out}${v.exitCode ? `${out ? '\n' : ''}Exit code: ${v.exitCode}` : ''}`, error: false };
  }
  if (typeof v.message === 'string') return { output: v.message, error: false };
  if (typeof v.content === 'string') return { output: v.content, error: false };
  return { output: JSON.stringify(v), error: false };
}

/** Cursor CLI: `cursor-agent -p --output-format stream-json --stream-partial-output`; the session comes in `system/init` and is resumed by id. */
export async function* runCursor(o: TurnOptions): AsyncGenerator<StreamEvent> {
  const { agent } = o;
  const args = ['-p', '--output-format', 'stream-json', '--stream-partial-output', '--trust', '--workspace', agent.cwd, '--force'];
  if (agent.permission === 'plan') args.push('--mode', 'plan');
  const env: Record<string, string> = { ...cursorMcpEnv(agent.id, o.mcpCaps) };
  const rules = cursorPermissions(agent.permission);
  if (rules) env.CURSOR_CONFIG_DIR = cursorConfigDir(agent.id, rules);
  if (o.mcpCaps.length) { writeCursorMcp(agent.cwd); args.push('--approve-mcps'); }
  if (agent.session_id) args.push('--resume', agent.session_id);
  if (agent.model) args.push('--model', agent.model);
  // No effort: the reasoning level is part of Cursor's model id (`gpt-5.3-codex-high`).
  const prompt = withInstructions(o.prompt, o.instructions, !!agent.session_id, o.refreshInstructions);
  // The prompt goes last; asPositional keeps a leading dash from being read as an option (see preamble.ts).
  args.push(asPositional(prompt));

  let sawSession = false;
  let model: string | undefined;
  // With --stream-partial-output the text comes in pieces (`timestamp_ms`, no `model_call_id`) and each stretch then once more whole: before a tool call
  // with a `model_call_id`, at the end without `timestamp_ms`. A whole copy after pieces is skipped; without pieces before it (no partial output) it is the text.
  let streamed = false;

  // An unknown model is reported first and followed by the whole list of models: the start of stderr is what matters.
  for await (const ev of spawnJson({ cmd: 'cursor-agent', args, cwd: agent.cwd, env, signal: o.signal, stderrHead: true })) {
    if (ev.session_id && !sawSession) { sawSession = true; yield { t: 'session', sessionId: ev.session_id }; }
    if (ev.type === 'system' && ev.subtype === 'init') model = ev.model;
    else if (ev.type === 'thinking') { if (ev.subtype === 'delta' && ev.text) yield { t: 'thinking', delta: ev.text }; }
    else if (ev.type === 'assistant') {
      const text = (ev.message?.content ?? []).filter((b: any) => b?.type === 'text').map((b: any) => b.text ?? '').join('');
      const whole = ev.timestamp_ms === undefined || ev.model_call_id !== undefined;
      if (whole && streamed) streamed = false;
      else if (text) { streamed = !whole; yield { t: 'text', delta: text }; }
    } else if (ev.type === 'tool_call') {
      const id = String(ev.call_id ?? ev.tool_call?.toolCallId ?? '');
      if (ev.subtype === 'started') { const tool = cursorStreamTool(ev.tool_call); if (tool) yield { t: 'tool', id, ...tool }; }
      else if (ev.subtype === 'completed') yield { t: 'tool_result', id, ...cursorToolResult(ev.tool_call) };
    } else if (ev.type === 'result') {
      const u = ev.usage;
      if (u) yield {
        t: 'usage', durationMs: ev.duration_ms, model: agent.model || model,
        usage: { input: u.inputTokens ?? 0, output: u.outputTokens ?? 0, cacheRead: u.cacheReadTokens ?? 0, cacheWrite: u.cacheWriteTokens ?? 0 },
      };
      yield ev.is_error
        ? { t: 'error', message: String(ev.result || 'Cursor returned an error') }
        : { t: 'done', ok: true, summary: typeof ev.result === 'string' ? ev.result : undefined };
      return;
    }
  }
  yield { t: 'done', ok: true };
}
