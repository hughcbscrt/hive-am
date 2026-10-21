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

/**
 * Takes the instructions block off the front of a user message read back from a CLI's own history: it is ours, not what the person wrote.
 * Turns sent while `--` duplicated the prompt (see asPositional) are stored as `x" "x`, each copy with its own block: one copy is kept.
 */
export function stripInstructions(text: string): string {
  const t = text.replace(/(^|" ")<instructions[^>]*>[\s\S]*?<\/instructions>\s*/g, '$1');
  for (let i = t.indexOf('" "'); i > 0; i = t.indexOf('" "', i + 1)) {
    const a = t.slice(0, i), b = t.slice(i + 3);
    if (a.trim() && a.trim() === b.trim()) return a;
  }
  return t;
}

/**
 * The prompt as the last argument of a CLI. A leading dash would be read as an option, and `--` is no fix: OpenCode 2.x hands
 * what follows `--` over twice (as positional and as rest), so the model got every message twice. A space in front is enough.
 */
export const asPositional = (prompt: string): string => (prompt.startsWith('-') ? ` ${prompt}` : prompt);
