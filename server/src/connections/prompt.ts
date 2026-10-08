import type { ChannelKind, Inbound } from './types.js';

const PLATFORM: Record<ChannelKind, string> = { telegram: 'Telegram', slack: 'Slack', fake: 'Test' };
export const platformName = (k: ChannelKind) => PLATFORM[k];

/**
 * What the agent receives for a channel message. The header has a fixed shape so the chat can recognise it and draw
 * a channel bubble; the agent reads it to know where the message came from. The browser parses it back in
 * `web/lib/channel.ts`: change both together.
 */
export interface PromptExtra {
  /** Group messages: whether the message was aimed at the agent, and whether the agent was asked to keep quiet. */
  addressed?: boolean; muted?: boolean;
  /** Messages in this thread the agent has not seen (it was not woken for them), oldest first. */
  unseen?: { name: string; text: string }[];
}
const CONTEXT = '\n\n[hive:context]\n';
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function channelPrompt(kind: ChannelKind, m: Inbound, x: PromptExtra = {}): string {
  const from = `${m.userName}${m.userId ? ` (${m.userId})` : ''}`;
  const flags = `${m.group ? ` · Addressed: ${x.addressed === false ? 'no' : 'yes'}` : ''}${x.muted ? ' · Muted: yes' : ''}`;
  const context = x.unseen?.length ? `${CONTEXT}Earlier messages in this thread that you were not shown (oldest first):\n${x.unseen.map((u) => `- ${u.name}: ${clip(u.text.replace(/\s+/g, ' '), 500)}`).join('\n')}` : '';
  return `[hive:channel] ${PLATFORM[kind]} · Place: ${m.place} · Thread: ${m.externalKey} · From: ${from}${flags}\nMessage:\n${m.text}${context}`;
}
