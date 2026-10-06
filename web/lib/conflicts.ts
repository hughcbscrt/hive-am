/** Conflict blocks (<<<<<<< / ======= / >>>>>>>) inside a file's text, and applying a choice to one of them. */
export interface ConflictBlock {
  /** First and last line of the block, markers included (0-based, inclusive). */
  start: number; end: number;
  ours: string[]; theirs: string[]; base?: string[];
  oursLabel: string; theirsLabel: string;
}
export type Choice = 'ours' | 'theirs' | 'ours-theirs' | 'theirs-ours';

export function parseConflicts(text: string): ConflictBlock[] {
  const lines = text.split('\n');
  const blocks: ConflictBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^<{7}( |$)/.test(lines[i])) continue;
    let mid = -1, baseAt = -1, end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^<{7}( |$)/.test(lines[j])) break;                                   // a new block starts: this one is broken
      if (/^\|{7}( |$)/.test(lines[j]) && mid < 0) baseAt = j;
      else if (lines[j] === '=======' && mid < 0) mid = j;
      else if (/^>{7}( |$)/.test(lines[j]) && mid >= 0) { end = j; break; }
    }
    if (mid < 0 || end < 0) continue;
    blocks.push({
      start: i, end,
      ours: lines.slice(i + 1, baseAt >= 0 ? baseAt : mid), base: baseAt >= 0 ? lines.slice(baseAt + 1, mid) : undefined,
      theirs: lines.slice(mid + 1, end),
      oursLabel: lines[i].slice(8).trim(), theirsLabel: lines[end].slice(8).trim(),
    });
    i = end;
  }
  return blocks;
}

/** Replace block `index` by the chosen side(s). Everything else in the text is left exactly as it is. */
export function applyChoice(text: string, index: number, choice: Choice): string {
  const b = parseConflicts(text)[index]; if (!b) return text;
  const pick = { ours: b.ours, theirs: b.theirs, 'ours-theirs': [...b.ours, ...b.theirs], 'theirs-ours': [...b.theirs, ...b.ours] }[choice];
  const lines = text.split('\n');
  lines.splice(b.start, b.end - b.start + 1, ...pick);
  return lines.join('\n');
}
