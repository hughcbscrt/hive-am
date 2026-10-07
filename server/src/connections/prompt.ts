import type { ChannelKind, Inbound } from './types.js';

const PLATFORM: Record<ChannelKind, string> = { telegram: 'Telegram', slack: 'Slack', fake: 'Test' };
export const platformName = (k: ChannelKind) => PLATFORM[k];

/**
 * What the agent receives for a channel message. The header has a fixed shape so the chat can recognise it and draw
 * a channel bubble; the agent reads it to know where the message came from.
 */
export function channelPrompt(kind: ChannelKind, m: Inbound): string {
  const from = `${m.userName}${m.userId ? ` (${m.userId})` : ''}`;
  return `[hive:channel] ${PLATFORM[kind]} · Place: ${m.place} · Thread: ${m.externalKey} · From: ${from}\nMessage:\n${m.text}`;
}

const HEADER = /^\[hive:channel\] (.+?) · Place: (.+?) · Thread: (.+?) · From: (.+)\nMessage:\n([\s\S]*)$/;
export function parseChannelPrompt(text: string) {
  const m = HEADER.exec(text);
  return m ? { platform: m[1], place: m[2], thread: m[3], from: m[4], body: m[5] } : null;
}
