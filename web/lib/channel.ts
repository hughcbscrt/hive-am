/** The header hive-am puts in front of a message that arrived from Telegram/Slack (see server/src/connections/prompt.ts). */
const HEADER = /^\[hive:channel\] (.+?) · Place: (.+?) · Thread: (.+?) · From: (.+)\nMessage:\n([\s\S]*)$/;

export interface ChannelMessage { platform: string; place: string; thread: string; from: string; body: string }

export function parseChannelPrompt(text: string): ChannelMessage | null {
  const m = HEADER.exec(text);
  return m ? { platform: m[1], place: m[2], thread: m[3], from: m[4], body: m[5] } : null;
}
