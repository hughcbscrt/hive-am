import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { StreamEvent, TurnOptions } from '../types.js';
import { spawnLines, safeJson } from './spawn.js';
import { DATA_DIR } from '../db.js';
import { dispatchMcpConfig } from '../mcp-config.js';

/** Claude Code: `claude -p` with stream-json; the prompt goes through stdin, the session is resumed by id. */
export async function* runClaude(o: TurnOptions): AsyncGenerator<StreamEvent> {
  const { agent } = o;
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', agent.permission];
  if (agent.session_id) args.push('--resume', agent.session_id);
  if (agent.model) args.push('--model', agent.model);
  if (o.instructions) args.push('--append-system-prompt', o.instructions);
  if (o.mcpDispatch) {
    const dir = join(DATA_DIR, 'mcp'); mkdirSync(dir, { recursive: true });
    const file = join(dir, `${agent.id}.json`);
    writeFileSync(file, JSON.stringify(dispatchMcpConfig(agent.id)));
    args.push('--mcp-config', file, '--allowedTools', 'mcp__hive');
  }

  const toolNames = new Map<string, string>();
  let streamedText = false;
  let sawSession = false;

  for await (const line of spawnLines({ cmd: 'claude', args, cwd: agent.cwd, stdin: o.prompt, signal: o.signal })) {
    const ev = safeJson(line);
    if (!ev) continue;

    if (ev.session_id && !sawSession) { sawSession = true; yield { t: 'session', sessionId: ev.session_id }; }

    if (ev.type === 'stream_event') {
      const d = ev.event?.delta;
      if (ev.event?.type === 'content_block_delta' && d) {
        if (d.type === 'text_delta' && d.text) { streamedText = true; yield { t: 'text', delta: d.text }; }
        else if (d.type === 'thinking_delta' && d.thinking) yield { t: 'thinking', delta: d.thinking };
      }
    } else if (ev.type === 'assistant') {
      for (const b of ev.message?.content ?? []) {
        if (b.type === 'tool_use') { toolNames.set(b.id, b.name); yield { t: 'tool', id: b.id, name: b.name, input: b.input }; }
        else if (b.type === 'text' && !streamedText && b.text) yield { t: 'text', delta: b.text };
      }
      streamedText = false;
    } else if (ev.type === 'user') {
      const content = ev.message?.content;
      if (Array.isArray(content)) for (const b of content) {
        if (b.type === 'tool_result') yield { t: 'tool_result', id: b.tool_use_id, output: flatten(b.content), error: !!b.is_error };
      }
    } else if (ev.type === 'result') {
      const u = ev.usage;
      if (u) yield {
        t: 'usage', cost: ev.total_cost_usd, durationMs: ev.duration_ms, model: Object.keys(ev.modelUsage ?? {})[0],
        usage: { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens, reasoning: u.output_tokens_details?.thinking_tokens },
      };
      yield ev.is_error
        ? { t: 'error', message: String(ev.result ?? 'Claude returned an error') }
        : { t: 'done', ok: true, summary: typeof ev.result === 'string' ? ev.result : undefined };
      return;
    }
  }
  yield { t: 'done', ok: true };
}

function flatten(c: unknown): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x: any) => (typeof x === 'string' ? x : x?.text ?? '')).join('\n');
  return c == null ? '' : JSON.stringify(c);
}
