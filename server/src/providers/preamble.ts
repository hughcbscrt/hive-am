/**
 * CLIs without a system-prompt flag (OpenCode, Kiro) only see our instructions inside a message.
 * First message of a session: send them. Later, if they changed (new team, new skills…): send them again as an update.
 */
export function withInstructions(prompt: string, instructions: string, resumed: boolean, refresh?: boolean): string {
  if (!instructions) return prompt;
  if (!resumed) return `<instructions>\n${instructions}\n</instructions>\n\n${prompt}`;
  if (refresh) return `<instructions update="true">\nYour configuration changed since the last message. These instructions replace any earlier ones; use them from now on.\n\n${instructions}\n</instructions>\n\n${prompt}`;
  return prompt;
}

/** Takes the instructions block off the front of a user message read back from a CLI's own history: it is ours, not what the person wrote. */
export const stripInstructions = (text: string): string => text.replace(/^<instructions[^>]*>[\s\S]*?<\/instructions>\s*/, '');
