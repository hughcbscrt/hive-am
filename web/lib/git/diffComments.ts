import type { MessageKey } from '../i18n/en';
import type { DiffLine, ParsedDiff } from './diff';

/*
 * Comments on lines of the current diff, sent to the agent in one chat message. Pure (no React, DOM or `@/`),
 * so `server/scripts/test-web-diffcomments.ts` checks the exact message, the limits and how a comment follows its lines.
 * Storage and state: lib/git/useDiffComments.ts. Screens: components/git/DiffView.tsx and DiffComments.tsx.
 */

export const MAX_COMMENTS = 25;
export const MAX_CHARS = 1000;
export const MAX_AGE_DAYS = 30;
export const QUOTE_LINES = 3;
export const QUOTE_COLS = 120;
export const STORE_PREFIX = 'hive-am.diffc.';
export const storeKey = (agentId: string) => `${STORE_PREFIX}${agentId}`;

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;
export interface QuoteLine { kind: DiffLine['kind']; text: string }
export interface DiffComment {
  id: string;
  /** Path in the repository, as the explorer shows it. */
  path: string;
  text: string;
  at: number;
  /** Line numbers of the selection: the new ones when it has an added or unchanged line, else (only removed lines) the old ones. */
  oldFrom?: number; oldTo?: number; newFrom?: number; newTo?: number;
  /** Only removed lines: cited by their old numbers, marked "removed". */
  removed: boolean;
  /** Up to 3 of the selected lines, trimmed at the end and cut to 120 columns: what the message quotes. */
  quote: QuoteLine[];
  /** How many lines were selected. */
  count: number;
  /** Hash of the first line and of every line (kind and text), to find the same lines again after the diff changes. */
  first: string; sig: string;
  /** The lines are no longer in the diff (or the file left the changes, `gone`): sent anyway, with the code that was seen. */
  outdated: boolean; gone: boolean;
}

/** 32-bit FNV-1a, as 8 hex digits. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
export const hashLine = (l: Pick<DiffLine, 'kind' | 'text'>): string => fnv(`${l.kind}\u0000${l.text}`);
const sigOf = (lines: Pick<DiffLine, 'kind' | 'text'>[]): string => fnv(lines.map((l) => `${l.kind}\u0000${l.text}`).join('\n'));

/** Cut to `max` code points, the last one an ellipsis. */
const clip = (s: string, max: number) => { const c = Array.from(s); return c.length > max ? c.slice(0, max - 1).join('') + '…' : s; };

/** What a selection cites: new numbers min to max when it has an added or unchanged line (even with removed ones inside), else old numbers, "removed". */
export function cite(lines: DiffLine[]): Pick<DiffComment, 'oldFrom' | 'oldTo' | 'newFrom' | 'newTo' | 'removed'> {
  const nums = (pick: (l: DiffLine) => number | undefined) => lines.map(pick).filter((n): n is number => n !== undefined);
  const nw = nums((l) => l.newNo), old = nums((l) => l.oldNo);
  const range = (ns: number[]) => (ns.length ? { from: Math.min(...ns), to: Math.max(...ns) } : null);
  const n = range(nw), o = range(old);
  return { newFrom: n?.from, newTo: n?.to, oldFrom: o?.from, oldTo: o?.to, removed: !n };
}

/** `62` or `88-91`: the cited range. */
export function rangeText(c: Pick<DiffComment, 'oldFrom' | 'oldTo' | 'newFrom' | 'newTo' | 'removed'>): string {
  const from = c.removed ? c.oldFrom : c.newFrom, to = c.removed ? c.oldTo : c.newTo;
  return from === to ? `${from}` : `${from}-${to}`;
}
/** "line 62", "lines 88 to 91", "removed line 30"... for the screens. */
export function rangeLabel(c: Pick<DiffComment, 'oldFrom' | 'oldTo' | 'newFrom' | 'newTo' | 'removed'>, t: Translate): string {
  const from = (c.removed ? c.oldFrom : c.newFrom) ?? 0, to = (c.removed ? c.oldTo : c.newTo) ?? from;
  if (c.removed) return from === to ? t('diffc.range.removedOne', { n: from }) : t('diffc.range.removedMany', { from, to });
  return from === to ? t('diffc.range.one', { n: from }) : t('diffc.range.many', { from, to });
}
/** The line a comment sorts and is placed by. */
export const anchorLine = (c: Pick<DiffComment, 'newFrom' | 'oldFrom'>): number => c.newFrom ?? c.oldFrom ?? 0;

/** Up to 1000 characters (UTF-16 units, as the textarea counts them), never half of a surrogate pair. */
export function clampText(s: string): string {
  if (s.length <= MAX_CHARS) return s;
  const cut = s.slice(0, MAX_CHARS), last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
export const canAdd = (list: DiffComment[]): boolean => list.length < MAX_COMMENTS;
/** Some line takes a comment: a cut-off diff takes none in its last hunk, which may be incomplete. */
export const hasCommentable = (parsed: Pick<ParsedDiff, 'hunks'>, cutOff: boolean): boolean => parsed.hunks.length > (cutOff ? 1 : 0);

export function makeComment(path: string, lines: DiffLine[], text: string, now: number, id: string): DiffComment {
  return {
    id, path, text: clampText(text), at: now, ...cite(lines),
    quote: lines.slice(0, QUOTE_LINES).map((l) => ({ kind: l.kind, text: clip(l.text.trimEnd(), QUOTE_COLS) })),
    count: lines.length, first: hashLine(lines[0]), sig: sigOf(lines), outdated: false, gone: false,
  };
}

/** Where a comment's lines are in a diff: the same run of lines (kind and text) inside one hunk, the closest to where it was. */
export function locate(parsed: ParsedDiff, c: Pick<DiffComment, 'count' | 'first' | 'sig' | 'newFrom' | 'oldFrom'>): { hunk: number; start: number } | null {
  const was = anchorLine(c);
  let best: { hunk: number; start: number } | null = null, bestDist = Infinity;
  for (let hi = 0; hi < parsed.hunks.length; hi++) {
    const lines = parsed.hunks[hi].lines;
    for (let s = 0; s + c.count <= lines.length; s++) {
      if (hashLine(lines[s]) !== c.first) continue;
      const win = lines.slice(s, s + c.count);
      if (sigOf(win) !== c.sig) continue;
      const dist = Math.abs(anchorLine(cite(win)) - was);
      if (dist < bestDist) { best = { hunk: hi, start: s }; bestDist = dist; }
    }
  }
  return best;
}

/** After the diff of `path` loaded or changed: comments whose lines are still there take their new numbers, the rest are outdated. Same array when nothing changes. */
export function reanchor(parsed: ParsedDiff, path: string, comments: DiffComment[]): DiffComment[] {
  let changed = false;
  const out = comments.map((c) => {
    if (c.path !== path) return c;
    const at = locate(parsed, c);
    const next: DiffComment = at ? { ...c, ...cite(parsed.hunks[at.hunk].lines.slice(at.start, at.start + c.count)), outdated: false, gone: false } : { ...c, outdated: true };
    const same = next.outdated === c.outdated && next.gone === c.gone && next.newFrom === c.newFrom && next.newTo === c.newTo && next.oldFrom === c.oldFrom && next.oldTo === c.oldTo && next.removed === c.removed;
    if (same) return c;
    changed = true; return next;
  });
  return changed ? out : comments;
}

/** A file that left the changes makes its comments outdated (`gone`); one that is back loses `gone` but stays outdated until opened. Nothing when the list is truncated. */
export function markGone(comments: DiffComment[], paths: ReadonlySet<string>, truncated: boolean): DiffComment[] {
  if (truncated) return comments;
  let changed = false;
  const out = comments.map((c) => {
    const there = paths.has(c.path);
    if (!there && !c.gone) { changed = true; return { ...c, outdated: true, gone: true }; }
    if (there && c.gone) { changed = true; return { ...c, gone: false }; }
    return c;
  });
  return changed ? out : comments;
}

export const pruneComments = (list: DiffComment[], now: number): DiffComment[] => {
  const kept = list.filter((c) => now - c.at <= MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  return kept.length === list.length ? list : kept;
};

/** By path (plain string comparison), then by line. */
export const sortForMessage = (list: DiffComment[]): DiffComment[] => [...list].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : anchorLine(a) - anchorLine(b)));

const SIGN = { add: '+', del: '-', ctx: ' ' } as const;
const INDENT = '   ';

/** The one message the agent gets, in the interface's language. Its exact shape is in docs/reference (Changes explorer). */
export function buildMessage(comments: DiffComment[], t: Translate): string {
  const list = sortForMessage(comments);
  const out = [t('diffc.msg.head', { count: list.length })];
  if (list.some((c) => c.removed)) out.push(t('diffc.msg.legendLines'));
  if (list.some((c) => c.outdated)) out.push(t('diffc.msg.legendOutdated'));
  out.push('');
  list.forEach((c, i) => {
    const marks = [c.removed && t('diffc.msg.removed'), c.outdated && t('diffc.msg.outdated')].filter(Boolean).join(', ');
    const [head, ...rest] = c.text.replace(/\r\n?/g, '\n').trim().split('\n');
    out.push(`${i + 1}. ${c.path}:${rangeText(c)}${marks ? ` (${marks})` : ''}: ${head}`);
    for (const l of rest) out.push(l.trim() ? INDENT + l : '');
    out.push(INDENT + t('diffc.msg.code'));
    for (const q of c.quote) out.push(`${INDENT}> ${SIGN[q.kind]} ${q.text}`.trimEnd());
    if (c.count > QUOTE_LINES) out.push(`${INDENT}> ${t('diffc.msg.more', { count: c.count - QUOTE_LINES })}`);
  });
  return out.join('\n');
}

export interface ParsedComment { path: string; range: string; marks: string; text: string; quote: string[]; more: string }
export interface ParsedMessage { head: string; comments: ParsedComment[] }

const HEAD = /^\d+ (?:comments?|comentarios?) (?:on your changes|sobre tus cambios):$/;
const ITEM = /^(\d+)\. (.+?):(\d+(?:-\d+)?)(?: \(([^)]*)\))?: (.*)$/;

/**
 * The inverse of buildMessage, for drawing it in the chat as a card. Null when the text is not that message, so anything
 * else (or a message that was edited by hand) is shown as the plain text it is. Understands both interface languages.
 */
export function parseMessage(text: string): ParsedMessage | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (!HEAD.test(lines[0] ?? '')) return null;
  const comments: ParsedComment[] = [];
  let cur: ParsedComment | null = null;
  let inCode = false;
  for (const l of lines.slice(1)) {
    const m = ITEM.exec(l);
    if (m && Number(m[1]) === comments.length + 1) {
      cur = { path: m[2], range: m[3], marks: m[4] ?? '', text: m[5], quote: [], more: '' };
      inCode = false;
      comments.push(cur);
      continue;
    }
    if (!cur) continue;                       // the legend lines between the head and the first comment
    if (l.startsWith(INDENT + '> ')) {
      const q = l.slice(INDENT.length + 2);
      if (q.startsWith('…')) cur.more = q; else cur.quote.push(q);
    } else if (l === `${INDENT}Code:` || l === `${INDENT}Código:`) inCode = true;
    else if (!inCode) cur.text += '\n' + (l.startsWith(INDENT) ? l.slice(INDENT.length) : l);
  }
  if (!comments.length || comments.some((c) => !c.quote.length)) return null;
  return { head: lines[0].slice(0, -1), comments: comments.map((c) => ({ ...c, text: c.text.trim() })) };
}
