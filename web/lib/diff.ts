/** Parses `git diff` output (unified format) into rows that the explorer can draw. Pure and dependency-free. */
export interface DiffLine { kind: 'ctx' | 'add' | 'del'; oldNo?: number; newNo?: number; text: string; noEol?: boolean }
export interface Hunk { header: string; section: string; lines: DiffLine[] }
export interface ParsedDiff { meta: string[]; hunks: Hunk[]; binary: boolean }

export function parseDiff(text: string): ParsedDiff {
  const out: ParsedDiff = { meta: [], hunks: [], binary: false };
  let cur: Hunk | null = null; let o = 0, n = 0;
  for (const line of text.split('\n')) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(line);
    if (h) { o = Number(h[1]); n = Number(h[2]); cur = { header: line, section: h[3] ?? '', lines: [] }; out.hunks.push(cur); continue; }
    if (!cur) {
      if (/^Binary files .* differ$/.test(line) || line.startsWith('GIT binary patch')) out.binary = true;
      else if (/^(rename|copy) (from|to) /.test(line) || /^(new|deleted) file mode/.test(line) || /^similarity index/.test(line)) out.meta.push(line);
      continue;
    }
    const c = line[0];
    if (c === '+') cur.lines.push({ kind: 'add', newNo: n++, text: line.slice(1) });
    else if (c === '-') cur.lines.push({ kind: 'del', oldNo: o++, text: line.slice(1) });
    else if (c === ' ') cur.lines.push({ kind: 'ctx', oldNo: o++, newNo: n++, text: line.slice(1) });
    else if (c === '\\') { const last = cur.lines[cur.lines.length - 1]; if (last) last.noEol = true; }
  }
  return out;
}

/** The "@@ -20,9 +20,10 @@" part of a hunk header (git appends a context line after it). */
export const hunkRange = (header: string) => /^(@@ [^@]+@@)/.exec(header)?.[1] ?? header;

export interface SplitRow { left?: DiffLine; right?: DiffLine }

/** Side-by-side rows: each run of removals is paired with the additions that follow it. */
export function toSplit(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  for (let i = 0; i < lines.length;) {
    const l = lines[i];
    if (l.kind === 'ctx') { rows.push({ left: l, right: l }); i++; continue; }
    const dels: DiffLine[] = [], adds: DiffLine[] = [];
    while (i < lines.length && lines[i].kind === 'del') dels.push(lines[i++]);
    while (i < lines.length && lines[i].kind === 'add') adds.push(lines[i++]);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push({ left: dels[k], right: adds[k] });
  }
  return rows;
}

export type ChangeKind = 'add' | 'mod';
/** Where a file differs from the last commit, by line number of the file as it is now (1-based). */
export interface ChangeMarks {
  /** Added lines, and lines that replace removed ones ("mod"). */
  lines: Map<number, ChangeKind>;
  /** Removed lines sit between two lines: the number is the line they were removed *before* (lastLine + 1 at the end). */
  removedBefore: Set<number>;
}

export function changeMarks(parsed: ParsedDiff): ChangeMarks {
  const lines = new Map<number, ChangeKind>(); const removedBefore = new Set<number>();
  for (const h of parsed.hunks) {
    let i = 0; const L = h.lines;
    let next = 0;                                  // the file line number the next context line will have
    while (i < L.length) {
      if (L[i].kind === 'ctx') { next = (L[i].newNo ?? next) + 1; i++; continue; }
      const dels: DiffLine[] = [], adds: DiffLine[] = [];
      while (i < L.length && L[i].kind === 'del') dels.push(L[i++]);
      while (i < L.length && L[i].kind === 'add') adds.push(L[i++]);
      adds.forEach((a, k) => { if (a.newNo !== undefined) lines.set(a.newNo, k < dels.length ? 'mod' : 'add'); });
      const after = adds.length ? (adds[adds.length - 1].newNo ?? 0) + 1 : (L[i]?.newNo ?? next);
      if (dels.length > adds.length) removedBefore.add(after);   // some removed lines have no replacement
      next = after;
    }
  }
  return { lines, removedBefore };
}
