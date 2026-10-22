import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Block, ChatMessage } from '../types.js';
import { stripInstructions } from '../providers/preamble.js';
import { jsonLines } from './lines.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const projectsDir = () => join(process.env.CURSOR_DATA_DIR?.trim() || join(homedir(), '.cursor'), 'projects');
/** How Cursor names a folder under `~/.cursor/projects`: every run of characters that are not letters or digits becomes one dash. */
export const cursorSlug = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');

/** The transcript of a conversation: under the folder's own project, else under any project (the folder may have been renamed). */
export function cursorFile(cwd: string, sessionId: string): string | null {
  if (!UUID.test(sessionId)) return null;
  const rel = join('agent-transcripts', sessionId, `${sessionId}.jsonl`);
  const own = join(projectsDir(), cursorSlug(cwd), rel);
  if (existsSync(own)) return own;
  try {
    for (const p of readdirSync(projectsDir())) { const f = join(projectsDir(), p, rel); if (existsSync(f)) return f; }
  } catch { /* no projects yet */ }
  return null;
}

/** Changes when the conversation changes (used to cache what is computed from it). */
export function cursorSig(cwd: string, sessionId: string): string | null {
  const f = cursorFile(cwd, sessionId);
  if (!f) return null;
  try { const st = statSync(f); return `${st.mtimeMs}:${st.size}`; } catch { return null; }
}

/** What the person wrote: Cursor wraps it as `<timestamp>…</timestamp>\n<user_query>\n…\n</user_query>`, and our instructions block comes first inside. */
export function cursorUserText(text: string): string {
  const q = /<user_query>\n?([\s\S]*?)\n?<\/user_query>/.exec(text);
  return stripInstructions((q ? q[1] : text.replace(/^<timestamp>[\s\S]*?<\/timestamp>\s*/, '')).trim()).trim();
}

/** A tool as hive-am shows it: a call to an MCP server (`CallDynamicTool`) is named like Claude's (`mcp__<server>__<tool>`). */
export function cursorTool(name: string, input: any): { name: string; input: unknown } {
  if (name === 'CallDynamicTool' && input?.namespace && input?.toolName) return { name: `mcp__${input.namespace}__${input.toolName}`, input: input.arguments ?? {} };
  return { name, input };
}

/**
 * Cursor's transcript (`~/.cursor/projects/<folder>/agent-transcripts/<id>/<id>.jsonl`): user and assistant messages with their text and tool calls.
 * It keeps no thinking, tool results, ids, usage or times: those are only seen while the turn runs. `SendToCall` repeats the reply's text, so it is left out.
 */
export function readCursor(cwd: string, sessionId: string): ChatMessage[] {
  const file = cursorFile(cwd, sessionId);
  if (!file) return [];
  const out: ChatMessage[] = [];
  let n = 0;
  for (const e of jsonLines(file)) {
    const content = e.message?.content;
    if (!Array.isArray(content)) continue;
    const id = `${sessionId}:${n++}`;
    if (e.role === 'user') {
      const text = cursorUserText(content.filter((b: any) => b?.type === 'text').map((b: any) => b.text ?? '').join(''));
      if (text) out.push({ id, role: 'user', ts: null, blocks: [{ type: 'text', text }] });
    } else if (e.role === 'assistant') {
      const blocks: Block[] = [];
      for (const b of content) {
        if (b?.type === 'text' && b.text) blocks.push({ type: 'text', text: b.text });
        else if (b?.type === 'tool_use' && b.name !== 'SendToCall') blocks.push({ type: 'tool', id: `${id}:${blocks.length}`, ...cursorTool(b.name ?? 'tool', b.input) });
      }
      if (!blocks.length) continue;
      // One reply arrives as several lines (one per step): they are one message, as in the live chat.
      const prev = out[out.length - 1];
      if (prev?.role === 'assistant') prev.blocks.push(...blocks);
      else out.push({ id, role: 'assistant', ts: null, blocks });
    }
  }
  return out;
}
