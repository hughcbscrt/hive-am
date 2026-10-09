import type { StreamEvent, TurnOptions } from '../types.js';
import { spawnLines, safeJson } from './spawn.js';
import { withInstructions } from './preamble.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { kiroProfile, type KiroAccess } from '../mcp-config.js';

/** Tools trusted when editing a project: files and the web, never the shell. */
export const KIRO_EDIT_TOOLS = ['fs_read', 'grep', 'glob', 'web_fetch', 'web_search'];

/**
 * Editing writes only inside the agent's folder (dotfiles such as .env included) and never to the repository's data or private keys:
 * the same limits as in the other providers. `fs_write` is not trusted as a whole, so a path outside `allowedPaths` cannot be approved.
 */
export const kiroEditAccess = (cwd: string): KiroAccess => ({
  trusted: KIRO_EDIT_TOOLS,
  toolsSettings: { fs_write: { allowedPaths: [`${cwd}/**`, `${cwd}/.*`], deniedPaths: ['**/.git/**', '**/*.pem', '**/*.key'] } },
});

/** Kiro CLI: `kiro-cli chat --no-interactive --output-format stream-json`, which streams ACP session updates as JSON lines. */
export async function* runKiro(o: TurnOptions): AsyncGenerator<StreamEvent> {
  const { agent } = o;
  const args = ['chat', '--no-interactive', '--output-format', 'stream-json'];
  const access = agent.permission === 'acceptEdits' ? kiroEditAccess(agent.cwd) : undefined;
  if (o.mcpCaps.length || access) {   // tools and path limits both come from a generated agent profile
    const name = `hive-${agent.id}`;
    const dir = join(homedir(), '.kiro', 'agents'); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(kiroProfile(agent.id, name, o.mcpCaps, access), null, 2));
    args.push('--agent', name);
  }
  // A tool that is not trusted cannot ask (the turn is not interactive), so it fails: read-only trusts nothing (but the hive tools of its profile), editing trusts what the
  // profile lists (above), full access trusts everything.
  if (agent.permission === 'bypassPermissions') args.push('--trust-all-tools');
  if (agent.session_id) args.push('--resume-id', agent.session_id);
  if (agent.model) args.push('--model', agent.model);
  const prompt = withInstructions(o.prompt, o.instructions, !!agent.session_id, o.refreshInstructions);
  args.push(prompt);

  let sawSession = false;
  const open = new Set<string>();

  for await (const line of spawnLines({ cmd: 'kiro-cli', args, cwd: agent.cwd, signal: o.signal })) {
    const ev = safeJson(line);
    if (!ev) continue;
    const d = ev.data ?? {};
    if (d.sessionId && !sawSession) { sawSession = true; yield { t: 'session', sessionId: d.sessionId }; }

    if (ev.type === 'metadata' && (d.meteringUsage || d.contextUsagePercentage !== undefined)) {
      const credits = (d.meteringUsage ?? []).reduce((n: number, m: any) => n + (m.value ?? 0), 0);
      yield { t: 'usage', durationMs: d.turnDurationMs, usage: { credits: credits || undefined, contextPct: d.contextUsagePercentage } };
    }
    if (ev.type === 'sessionUpdate') {
      const u = d.update ?? {};
      switch (u.sessionUpdate) {
        case 'agent_message_chunk': if (u.content?.text) yield { t: 'text', delta: u.content.text }; break;
        case 'agent_thought_chunk': if (u.content?.text) yield { t: 'thinking', delta: u.content.text }; break;
        case 'tool_call':
          open.add(u.toolCallId);
          yield { t: 'tool', id: u.toolCallId, name: u.title ?? u.kind ?? 'tool', input: u.rawInput };
          break;
        case 'tool_call_update':
          if (u.status === 'completed' || u.status === 'failed') {
            const out = (u.content ?? []).map((c: any) => c?.content?.text ?? '').filter(Boolean).join('\n')
              || (u.rawOutput ? JSON.stringify(u.rawOutput) : '');
            yield { t: 'tool_result', id: u.toolCallId, output: out, error: u.status === 'failed' };
          }
          break;
      }
    } else if (ev.type === 'runFinished') {
      yield d.status === 'success'
        ? { t: 'done', ok: true, summary: d.finalText }
        : { t: 'error', message: `Kiro finished with status "${d.status}"${d.stopReason ? ` (${d.stopReason})` : ''}` };
      return;
    }
  }
  yield { t: 'done', ok: true };
}
