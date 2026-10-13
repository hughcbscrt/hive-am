import { execFile } from 'node:child_process';
import { filesFromDiffTree, repoOf, resolveRef, run, type GitCommitFile } from './ops.js';
import { gitEnv, imageType, PathError, safePath } from './repo.js';

/**
 * Reading the repository without touching the working folder: every branch and tag (for the pickers), what changed between two
 * points, text search in the files, and a picture as it was at some version. Same rules as ops.ts: `execFile`, no shell, user
 * input only as an argument value or after `--`, and every reference resolved to a commit first.
 */

export interface RefInfo { name: string; sha: string; date: string; subject: string }
export interface GitRefs { current: string | null; branches: RefInfo[]; remotes: RefInfo[]; tags: RefInfo[] }
const MAX_REFS = 1000;

export async function gitRefs(cwd: string): Promise<GitRefs> {
  const { root } = await repoOf(cwd);
  const [heads, tags] = await Promise.all([
    run(root, ['for-each-ref', '--sort=-committerdate', `--count=${MAX_REFS}`, '--format=%(refname)%1f%(refname:short)%1f%(objectname)%1f%(committerdate:iso-strict)%1f%(contents:subject)%1f%(HEAD)', 'refs/heads', 'refs/remotes']),
    // For an annotated tag %(*objectname) is its commit; for a lightweight one %(objectname) already is.
    run(root, ['for-each-ref', '--sort=-creatordate', `--count=${MAX_REFS}`, '--format=%(refname:strip=2)%1f%(*objectname)%1f%(objectname)%1f%(creatordate:iso-strict)%1f%(contents:subject)', 'refs/tags']),
  ]);
  const res: GitRefs = { current: null, branches: [], remotes: [], tags: [] };
  for (const line of heads.out.split('\n').filter(Boolean)) {
    const [ref, name, sha, date, subject, head] = line.split('\x1f');
    if (ref.startsWith('refs/heads/')) { res.branches.push({ name, sha, date, subject }); if (head === '*') res.current = name; }
    else if (!ref.endsWith('/HEAD')) res.remotes.push({ name, sha, date, subject });
  }
  for (const line of tags.out.split('\n').filter(Boolean)) {
    const [name, peeled, direct, date, subject] = line.split('\x1f');
    res.tags.push({ name, sha: peeled || direct, date, subject });
  }
  return res;
}

/* ------------------------------------------------------------------ compare */

export interface GitCompare {
  base: { ref: string; sha: string }; head: { ref: string; sha: string };
  /** Commits only `head` has, and commits only `base` has. */
  ahead: number; behind: number;
  commits: { sha: string; short: string; author: string; date: string; subject: string }[]; commitsTruncated: boolean;
  files: GitCommitFile[]; truncated: boolean;
}
const MAX_COMPARE_FILES = 500, MAX_COMPARE_COMMITS = 100;

/** What changed going from `base` to `head`: the files, and the commits in between. */
export async function gitCompare(cwd: string, base: string, head: string): Promise<GitCompare> {
  const { root } = await repoOf(cwd);
  const [b, h] = [await resolveRef(root, base), await resolveRef(root, head)];
  const [names, nums, ahead, behind, log] = await Promise.all([
    run(root, ['diff-tree', '-r', '-M', '--name-status', '-z', '--no-commit-id', b, h], { raw: true }),
    run(root, ['diff-tree', '-r', '-M', '--histogram', '--numstat', '-z', '--no-commit-id', b, h], { raw: true }),
    run(root, ['rev-list', '--count', `${b}..${h}`]),
    run(root, ['rev-list', '--count', `${h}..${b}`]),
    run(root, ['log', `--max-count=${MAX_COMPARE_COMMITS + 1}`, '--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e', `${b}..${h}`]),
  ]);
  const files = filesFromDiffTree(names.out, nums.out);
  const commits = log.out.split('\x1e').map((r) => r.trim()).filter(Boolean).map((r) => { const [sha, short, author, date, subject] = r.split('\x1f'); return { sha, short, author, date, subject }; });
  return {
    base: { ref: base, sha: b }, head: { ref: head, sha: h }, ahead: Number(ahead.out) || 0, behind: Number(behind.out) || 0,
    commits: commits.slice(0, MAX_COMPARE_COMMITS), commitsTruncated: commits.length > MAX_COMPARE_COMMITS,
    files: files.slice(0, MAX_COMPARE_FILES), truncated: files.length > MAX_COMPARE_FILES,
  };
}

export async function gitCompareDiff(cwd: string, base: string, head: string, rel: string, oldRel?: string): Promise<{ path: string; diff: string; truncated: boolean; binary: boolean }> {
  const { root } = await repoOf(cwd);
  const [b, h] = [await resolveRef(root, base), await resolveRef(root, head)];
  await safePath(cwd, root, rel, false); if (oldRel) await safePath(cwd, root, oldRel, false);
  const { out } = await run(root, ['diff', '--histogram', '--no-color', '--no-ext-diff', '-M', '-U3', b, h, '--', ...(oldRel ? [oldRel, rel] : [rel])]);
  const MAX = 600_000;
  return { path: rel, diff: out.length > MAX ? out.slice(0, MAX) : out, truncated: out.length > MAX, binary: /^Binary files .* differ$/m.test(out) || /^GIT binary patch/m.test(out) };
}

/* ------------------------------------------------------------------ search in the files */

export interface GrepHit { path: string; line: number; text: string }
const MAX_HITS = 300;

/** Lines of the working files (tracked and new, never ignored ones) that contain `q`. */
export async function gitGrep(cwd: string, q: string, caseSensitive = false): Promise<{ hits: GrepHit[]; truncated: boolean }> {
  const { root, scope } = await repoOf(cwd);
  const text = q.trim().slice(0, 200);
  if (text.length < 2) return { hits: [], truncated: false };
  const { out } = await run(root, ['grep', '-n', '-I', '--null', '--fixed-strings', '--no-color', '--untracked', '--exclude-standard', ...(caseSensitive ? [] : ['-i']), '-e', text, '--', scope || '.'], { okCodes: [1], raw: true });
  const hits: GrepHit[] = [];
  let truncated = false;
  for (const l of out.split('\n')) {
    if (!l) continue;
    if (hits.length >= MAX_HITS) { truncated = true; break; }
    // With --null both the file name and the line number are followed by a NUL: `path NUL line NUL text`.
    const [path, line, ...text] = l.split('\0');
    if (!path || text.length === 0) continue;
    hits.push({ path, line: Number(line) || 0, text: text.join('\0').slice(0, 300) });
  }
  return { hits, truncated };
}

/* ------------------------------------------------------------------ pictures at a version */

const MAX_IMAGE = 20 * 1024 * 1024;

/** The bytes of a picture as it was at a commit, served only as an inert image (see the route). */
export async function gitImageAt(cwd: string, ref: string, rel: string): Promise<{ bytes: Buffer; type: string }> {
  const { root } = await repoOf(cwd);
  const type = imageType(rel); if (!type) throw new PathError('Not an image');
  const sha = await resolveRef(root, ref);
  if (!rel || rel.includes('\0') || rel.startsWith('/') || rel.split('/').includes('..')) throw new PathError('Invalid path');
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    execFile('git', ['cat-file', 'blob', `${sha}:${rel}`], { cwd: root, encoding: 'buffer', maxBuffer: MAX_IMAGE, env: gitEnv(), timeout: 30_000 }, (err, stdout) => (err ? reject(new PathError('Picture not found at that version')) : resolve(stdout as Buffer)));
  });
  return { bytes, type };
}
