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
/** One change you can walk to: a run of changed lines (runs separated only by blank lines count as one, like VS Code). */
export interface ChangeGroup {
  /** First and last file line (1-based) it covers; removed lines count as the line they were removed before. */
  from: number; to: number;
  /** The diff lines of the change with 3 lines of context, as a block of its own, to show in the peek. */
  view: Hunk;
}
/** Where a file differs from the last commit, by line number of the file as it is now (1-based). */
export interface ChangeMarks {
  /** Added lines, and lines that replace removed ones ("mod"). */
  lines: Map<number, ChangeKind>;
  /** Removed lines sit between two lines: the number is the line they were removed *before* (lastLine + 1 at the end). */
  removedBefore: Set<number>;
  /** Index (in `groups`) of the change each marked line / removal position belongs to. */
  blockOfLine: Map<number, number>;
  blockOfRemoval: Map<number, number>;
  groups: ChangeGroup[];
}

/**
 * git joins changes that are less than 7 lines apart into one block, but editors (VS Code, JetBrains) walk the
 * individual changes. So changes are the runs of added/removed lines; only blank lines between two runs merge them.
 */
export function changeMarks(parsed: ParsedDiff): ChangeMarks {
  const lines = new Map<number, ChangeKind>(); const removedBefore = new Set<number>();
  const blockOfLine = new Map<number, number>(); const blockOfRemoval = new Map<number, number>();
  const groups: ChangeGroup[] = [];
  for (const h of parsed.hunks) {
    const L = h.lines;
    // The file line number each diff line sits at (for a removed line: the line that follows it).
    const at: number[] = []; let nxt = Number(/\+(\d+)/.exec(h.header)?.[1] ?? 1);
    for (let i = 0; i < L.length; i++) { at[i] = nxt; if (L[i].kind !== 'del') nxt = (L[i].newNo ?? nxt) + 1; }
    const runs: [number, number][] = [];
    for (let i = 0; i < L.length;) { if (L[i].kind === 'ctx') { i++; continue; } const st = i; while (i < L.length && L[i].kind !== 'ctx') i++; runs.push([st, i - 1]); }
    const merged: [number, number][] = [];
    for (const r of runs) { const last = merged[merged.length - 1]; if (last && L.slice(last[1] + 1, r[0]).every((l) => l.text.trim() === '')) last[1] = r[1]; else merged.push([r[0], r[1]]); }
    for (const [s, e] of merged) {
      const gi = groups.length; let from = Infinity, to = -Infinity;
      for (let i = s; i <= e;) {
        if (L[i].kind === 'ctx') { i++; continue; }
        const dels: DiffLine[] = [], adds: DiffLine[] = [];
        while (i <= e && L[i].kind === 'del') dels.push(L[i++]);
        while (i <= e && L[i].kind === 'add') adds.push(L[i++]);
        adds.forEach((a, k) => { const n = a.newNo!; lines.set(n, k < dels.length ? 'mod' : 'add'); blockOfLine.set(n, gi); from = Math.min(from, n); to = Math.max(to, n); });
        const after = adds.length ? adds[adds.length - 1].newNo! + 1 : (i < L.length ? at[i] : nxt);
        if (dels.length > adds.length) { removedBefore.add(after); blockOfRemoval.set(after, gi); from = Math.min(from, after); to = Math.max(to, after); }
      }
      const sl = L.slice(Math.max(0, s - 3), Math.min(L.length - 1, e + 3) + 1);
      const o = sl.filter((l) => l.oldNo !== undefined), n = sl.filter((l) => l.newNo !== undefined);
      groups.push({ from, to, view: { header: `@@ -${o[0]?.oldNo ?? 0},${o.length} +${n[0]?.newNo ?? 0},${n.length} @@`, section: '', lines: sl } });
    }
  }
  return { lines, removedBefore, blockOfLine, blockOfRemoval, groups };
}
