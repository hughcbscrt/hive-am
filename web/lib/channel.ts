/** The header hive-am puts in front of a message that arrived from Telegram/Slack (see server/src/connections/prompt.ts). */
const HEADER = /^\[hive:channel\] (.+?) · Place: (.+?) · Thread: (.+?) · From: (.+?)((?: · (?:Addressed|Muted): \w+)*)\nMessage:\n([\s\S]*)$/;
const CONTEXT = '\n\n[hive:context]\n';

export interface ChannelMessage {
  platform: string; place: string; thread: string; from: string; body: string;
  /** Group chatter nobody aimed at the agent. */
  overheard: boolean; muted: boolean;
  /** Earlier messages the agent was handed along with this one. */
  context: string;
}

export function parseChannelPrompt(text: string): ChannelMessage | null {
  const m = HEADER.exec(text);
  if (!m) return null;
  const [body, ...ctx] = m[6].split(CONTEXT);
  return { platform: m[1], place: m[2], thread: m[3], from: m[4], body, overheard: /Addressed: no/.test(m[5]), muted: /Muted: yes/.test(m[5]), context: ctx.join(CONTEXT) };
}
