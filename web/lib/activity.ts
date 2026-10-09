import type { LiveTurn } from './store';
import { translate as tr } from './i18n/core';
import { describe } from '@/components/chat/ToolCall';

/** One-line "what is it doing right now" for a running agent. */
export function activity(turn?: LiveTurn): string | null {
  if (!turn) return null;
  const last = turn.blocks[turn.blocks.length - 1];
  const who = turn.source === 'dispatch' ? tr('activity.delegated') : '';
  if (!last) return `${who}${tr('activity.starting')}`;
  if (last.type === 'tool') { const d = describe(last); const tool = `${d.label}${d.summary ? ` ${d.summary}` : ''}`; return `${who}${last.output === undefined ? tr('activity.running', { tool }) : tr('activity.ran', { tool })}`; }
  return `${who}${last.type === 'thinking' ? tr('activity.thinking') : tr('activity.writing')}`;
}
