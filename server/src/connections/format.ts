/** Splits text into pieces of at most `max` characters, preferring paragraph, then line, then word boundaries. */
export function splitMessage(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = Math.max(rest.lastIndexOf('\n\n', max), rest.lastIndexOf('\n', max), rest.lastIndexOf(' ', max));
    if (cut < max / 2) cut = max;
    // Never end on half of a surrogate pair (emoji).
    if (cut > 0 && /[\ud800-\udbff]/.test(rest[cut - 1])) cut--;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Emoji that many fonts draw as a plain glyph (or nothing) unless they carry the "emoji presentation" selector (U+FE0F): the alarm clock,
 * hourglasses, stopwatch, warning sign and a few more. The agent writes them bare, so the selector is added before the text is sent.
 */
export function emojiPresentation(text: string): string {
  return text.replace(/([\u231A\u231B\u23F0\u23F1\u23F2\u23F3\u2693\u26A0\u2705\u2714\u2716\u2728\u2B50\u2764\u260E\u2709\u270F\u2744\u2600\u2601\u26A1\u2B06\u2B07\u27A1\u2B05])(?!\uFE0F)/g, '$1\uFE0F');
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Markdown → the small HTML subset Telegram accepts. Anything unsupported is left as escaped plain text. */
export function mdToTelegramHtml(md: string): string {
  md = emojiPresentation(md);
  const stash: string[] = [];
  const keep = (html: string) => `\u0000${stash.push(html) - 1}\u0000`;
  let s = md.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_m, code) => keep(`<pre>${escapeHtml(code.replace(/\n$/, ''))}</pre>`));
  s = s.replace(/`([^`\n]+)`/g, (_m, code) => keep(`<code>${escapeHtml(code)}</code>`));
  s = escapeHtml(s);
  s = s.replace(/\[([^\]\n]+)\]\(((?:https?:\/\/|tg:\/\/user\?id=)[^\s)]+)\)/g, (_m, label, url) => `<a href="${url.replace(/"/g, '&quot;')}">${label}</a>`);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, '$1<i>$2</i>');
  s = s.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => stash[Number(i)]);
}
