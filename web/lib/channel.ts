/** The header hive-am puts in front of a message that arrived from Telegram/Slack (see server/src/connections/prompt.ts). */
const HEADER = /^\[hive:channel\] (.+?) · Place: (.+?) · Thread: (.+?) · From: (.+?)((?: · (?:Addressed|Muted): \w+| · To: [^·\n]+)*)(?: · Now: [^\n]*)?\nMessage:\n([\s\S]*)$/;
const CONTEXT = '\n\n[hive:context]\n';
const FILES = '\n\n[hive:files]\n';

export interface ChannelMessage {
  platform: string; place: string; thread: string; from: string; body: string;
  /** Group chatter nobody aimed at the agent. */
  overheard: boolean; muted: boolean;
  /** Earlier messages the agent was handed along with this one. */
  context: string;
  /** Files that came with the message (saved on the machine running hive-am). */
  files: { path: string; name: string; detail: string }[];
}

export function parseChannelPrompt(text: string): ChannelMessage | null {
  const m = HEADER.exec(text);
  if (!m) return null;
  const [main, ...ctx] = m[6].split(CONTEXT);
  const [body, ...fileBlock] = main.split(FILES);
  const files = fileBlock.join(FILES).split('\n').flatMap((l) => {
    const f = /^- (.+) \(([^()]*)\)$/.exec(l);
    return f ? [{ path: f[1], name: f[1].replace(/^.*[\\/]/, '').replace(/^\d+-\d+-/, ''), detail: f[2] }] : [];
  });
  return { platform: m[1], place: m[2], thread: m[3], from: m[4], body, files, overheard: /Addressed: no/.test(m[5]), muted: /Muted: yes/.test(m[5]), context: ctx.join(CONTEXT) };
}
