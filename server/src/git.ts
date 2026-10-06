import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { open, readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, normalize, resolve, sep } from 'node:path';

/**
 * Read-only git access for the explorer (writes live in gitops.ts). Everything here only *reads*: no command writes to the repository,
 * and `GIT_OPTIONAL_LOCKS=0` keeps `git status` from touching the index while an agent is working in it.
 */
const pexec = promisify(execFile);
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export const MAX_TREE_FILES = 30_000;
const MAX_CHANGES = 5_000;
const MAX_DIFF_CHARS = 600_000;
const MAX_FILE_BYTES = 1_000_000;
const MAX_IMAGE_BYTES = 8_000_000;

export type ChangeStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict' | 'typechange';

export interface GitChange {
  path: string;
  oldPath?: string;
  status: ChangeStatus;
  staged: boolean;
  unstaged: boolean;
  /** null when unknown (binary files, very large untracked files). */
  additions: number | null;
  deletions: number | null;
  binary: boolean;
}

export type GitStatus =
  | { isRepo: false; reason: 'no-git' | 'not-repo' | 'error'; message: string; cwd: string }
  | {
      isRepo: true; cwd: string; root: string;
      /** Sub-folder of the repository the agent works in ('' when it is the root). Everything is scoped to it. */
      scope: string;
      branch: string | null; detached: boolean;
      /** `when` is an ISO 8601 date (the UI formats it). */
      head: { sha: string; subject: string; when: string; author: string } | null;
      upstream: { ahead: number; behind: number } | null;
      changes: GitChange[]; truncated: boolean; generatedAt: number;
      /** A merge or rebase waiting to be finished (conflicts being resolved), and git's prepared merge message. */
      state: 'merge' | 'rebase' | null; mergeMsg: string;
    };

export interface Repo { root: string; scope: string }
type RepoResult = { ok: true; repo: Repo } | { ok: false; reason: 'no-git' | 'not-repo' | 'error'; message: string };

/** Environment every git child gets: never prompt for credentials or a terminal. */
export const gitEnv = (extra: Record<string, string> = {}) => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', LC_MESSAGES: 'C', ...extra });

/** `git diff --numstat -z` → added/removed counts per path (null for binary files). Handles renames ("<a>\t<d>\t\0old\0new\0"). */
export function parseNumstat(out: string): Map<string, { a: number | null; d: number | null }> {
  const counts = new Map<string, { a: number | null; d: number | null }>();
  const tok = out.split('\0');
  for (let i = 0; i < tok.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/.exec(tok[i]); if (!m) continue;
    const c = { a: m[1] === '-' ? null : Number(m[1]), d: m[2] === '-' ? null : Number(m[2]) };
    if (m[3] === '') { counts.set(tok[i + 2], c); i += 2; } else counts.set(m[3], c);
  }
  return counts;
}

/** Whether a merge or a rebase is waiting to be finished, and where git keeps its state. */
export async function repoState(root: string): Promise<{ state: 'merge' | 'rebase' | null; gitDir: string }> {
  const gitDir = (await git(root, ['rev-parse', '--absolute-git-dir']).catch(() => ({ stdout: '' }))).stdout.trim();
  const has = (f: string) => (gitDir ? stat(`${gitDir}/${f}`).then(() => true, () => false) : Promise.resolve(false));
  const [merging, rebaseMerge, rebaseApply] = await Promise.all([has('MERGE_HEAD'), has('rebase-merge'), has('rebase-apply')]);
  return { state: rebaseMerge || rebaseApply ? 'rebase' : merging ? 'merge' : null, gitDir };
}

async function git(cwd: string, args: string[], opts: { okCodes?: number[]; maxBuffer?: number; timeout?: number } = {}) {
  try {
    const { stdout } = await pexec('git', ['-c', 'core.quotepath=off', '-c', 'color.ui=never', ...args], {
      cwd, encoding: 'utf8', maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024, timeout: opts.timeout ?? 20_000,
      env: gitEnv({ GIT_OPTIONAL_LOCKS: '0' }),
    });
    return { stdout, code: 0 };
  } catch (e: any) {
    if (typeof e.code === 'number' && (opts.okCodes ?? []).includes(e.code)) return { stdout: String(e.stdout ?? ''), code: e.code as number };
    throw e;
  }
}

export async function findRepo(cwd: string): Promise<RepoResult> {
  try {
    const { stdout } = await git(cwd, ['rev-parse', '--show-toplevel', '--show-prefix']);
    const [root, prefix = ''] = stdout.split('\n');
    return { ok: true, repo: { root: root.trim(), scope: prefix.trim().replace(/\/$/, '') } };
  } catch (e: any) {
    if (e.code === 'ENOENT') return { ok: false, reason: 'no-git', message: 'git is not installed or not in PATH' };
    const err = String(e.stderr ?? e.message ?? '').trim();
    if (/not a git repository/i.test(err)) return { ok: false, reason: 'not-repo', message: err };
    return { ok: false, reason: 'error', message: err.split('\n').slice(-2).join(' ').slice(0, 300) };
  }
}

const pathspec = (scope: string) => (scope ? [scope] : ['.']);

export async function hasHead(root: string) {
  try { await git(root, ['rev-parse', '--verify', '-q', 'HEAD']); return true; } catch { return false; }
}

function mapStatus(x: string, y: string): ChangeStatus {
  if (x === '?' && y === '?') return 'untracked';
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'conflict';
  if (x === 'A') return 'added';
  if (x === 'R') return 'renamed';
  if (x === 'C') return 'added';
  if (x === 'D' || y === 'D') return 'deleted';
  if (x === 'T' || y === 'T') return 'typechange';
  return 'modified';
}

/** Counts "+N" for an untracked text file so it shows a size in the explorer like any other change. */
async function countLines(abs: string): Promise<{ lines: number | null; binary: boolean }> {
  try {
    const st = await stat(abs);
    if (!st.isFile() || st.size > 256 * 1024) return { lines: null, binary: false };
    const fh = await open(abs, 'r');
    try {
      const buf = Buffer.alloc(st.size);
      await fh.read(buf, 0, st.size, 0);
      if (buf.subarray(0, 8000).includes(0)) return { lines: null, binary: true };
      let n = 0; for (const b of buf) if (b === 10) n++;
      if (buf.length && buf[buf.length - 1] !== 10) n++;
      return { lines: n, binary: false };
    } finally { await fh.close(); }
  } catch { return { lines: null, binary: false }; }
}

export async function gitStatus(cwd: string): Promise<GitStatus> {
  const found = await findRepo(cwd);
  if (!found.ok) return { isRepo: false, reason: found.reason, message: found.message, cwd };
  const { root, scope } = found.repo;
  const base = (await hasHead(root)) ? 'HEAD' : EMPTY_TREE;

  const [st, num, br, headInfo, up] = await Promise.all([
    git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...pathspec(scope)]),
    git(root, ['diff', base, '--numstat', '-z', '-M', '--', ...pathspec(scope)]).catch(() => ({ stdout: '' })),
    git(root, ['symbolic-ref', '--short', '-q', 'HEAD'], { okCodes: [1] }).catch(() => ({ stdout: '' })),
    git(root, ['log', '-1', '--format=%h%x00%s%x00%cI%x00%an']).catch(() => ({ stdout: '' })),
    git(root, ['rev-list', '--left-right', '--count', '@{u}...HEAD']).catch(() => ({ stdout: '' })),
  ]);

  const counts = parseNumstat(num.stdout);

  const changes: GitChange[] = [];
  const parts = st.stdout.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i]; if (e.length < 4) continue;
    const x = e[0], y = e[1]; const path = e.slice(3);
    let oldPath: string | undefined;
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') { oldPath = parts[++i]; }
    if (x === '!' && y === '!') continue;
    const status = mapStatus(x, y);
    const c = counts.get(path);
    changes.push({
      path, oldPath: status === 'renamed' || x === 'C' ? oldPath : undefined, status,
      staged: status !== 'untracked' && x !== ' ' && x !== '?', unstaged: y !== ' ' || status === 'untracked',
      additions: c ? c.a : null, deletions: c ? c.d : null, binary: !!c && c.a === null && c.d === null,
    });
    if (changes.length >= MAX_CHANGES) break;
  }

  // Untracked files have no numstat; count their lines (bounded) so the explorer can show "+N".
  const untracked = changes.filter((c) => c.status === 'untracked').slice(0, 200);
  await Promise.all(untracked.map(async (c) => {
    const r = await countLines(resolve(root, c.path));
    c.additions = r.lines; c.deletions = r.lines === null ? null : 0; c.binary = r.binary;
  }));
  changes.sort((a, b) => a.path.localeCompare(b.path));

  const { state, gitDir } = await repoState(root);
  const mergeMsg = state === 'merge' ? (await readFile(`${gitDir}/MERGE_MSG`, 'utf8').catch(() => '')).split('\n').filter((l) => !l.startsWith('#')).join('\n').trim() : '';

  const [sha, subject, when, author] = headInfo.stdout.trim().split('\0');
  const [behind, ahead] = up.stdout.trim().split(/\s+/).map(Number);
  const branch = br.stdout.trim() || null;
  return {
    isRepo: true, cwd, root, scope, branch, detached: !branch && !!sha,
    head: sha ? { sha, subject: subject ?? '', when: when ?? '', author: author ?? '' } : null,
    upstream: Number.isFinite(ahead) && Number.isFinite(behind) ? { ahead, behind } : null,
    changes, truncated: changes.length >= MAX_CHANGES, generatedAt: Date.now(), state, mergeMsg,
  };
}

/** Every file the repository knows about in the agent's folder: tracked + untracked, minus what .gitignore hides. */
export async function gitTree(cwd: string): Promise<{ isRepo: false; reason: string; message: string } | { isRepo: true; root: string; scope: string; files: string[]; truncated: boolean }> {
  const found = await findRepo(cwd);
  if (!found.ok) return { isRepo: false, reason: found.reason, message: found.message };
  const { root, scope } = found.repo;
  const { stdout } = await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...pathspec(scope)]);
  const all = [...new Set(stdout.split('\0').filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return { isRepo: true, root, scope, files: all.slice(0, MAX_TREE_FILES), truncated: all.length > MAX_TREE_FILES };
}

export class PathError extends Error {}
export const isPathError = (e: unknown): e is PathError => e instanceof PathError;

/** Repo-relative path → absolute path, guaranteed to be inside the agent's own folder (symlinks resolved). */
export async function safePath(cwd: string, root: string, rel: string, mustExist: boolean): Promise<string> {
  if (!rel || rel.includes('\0') || isAbsolute(rel)) throw new PathError('Invalid path');
  const n = normalize(rel);
  if (n === '..' || n.startsWith('..' + sep) || n === '.') throw new PathError('Invalid path');
  // Repository internals (config with remote URLs/tokens, hooks, objects) are never exposed.
  if (n.split(sep).includes('.git')) throw new PathError('Invalid path');
  const abs = resolve(root, n);
  const base = await realpath(cwd).catch(() => resolve(cwd));
  const inside = (p: string) => p === base || p.startsWith(base + sep);
  if (!inside(abs) && !inside(await realpath(abs).catch(() => abs))) throw new PathError('Path is outside the agent’s folder');
  if (mustExist) {
    const real = await realpath(abs);
    if (!inside(real)) throw new PathError('Path is outside the agent’s folder');
  }
  return abs;
}

export interface GitDiff { path: string; diff: string; truncated: boolean; binary: boolean }

export async function gitDiff(cwd: string, rel: string, oldRel?: string): Promise<GitDiff> {
  const found = await findRepo(cwd);
  if (!found.ok) throw new PathError(found.message);
  const { root } = found.repo;
  const abs = await safePath(cwd, root, rel, false);
  if (oldRel) await safePath(cwd, root, oldRel, false);

  let tracked = true;
  try { await git(root, ['ls-files', '--error-unmatch', '--', rel]); } catch { tracked = false; }

  let out: string;
  if (!tracked) {
    // Untracked: show the whole file as an addition. `--no-index` exits with 1 when the files differ.
    const r = await git(root, ['diff', '--no-index', '--no-color', '--no-ext-diff', '-U3', '--', '/dev/null', abs], { okCodes: [1], maxBuffer: 16 * 1024 * 1024 });
    // The headers carry the absolute path; show the repo-relative one instead.
    out = r.stdout.split(`a/${abs.slice(1)}`).join(`a/${rel}`).split(`b/${abs.slice(1)}`).join(`b/${rel}`);
  } else {
    const base = (await hasHead(root)) ? 'HEAD' : EMPTY_TREE;
    const r = await git(root, ['diff', base, '--no-color', '--no-ext-diff', '-M', '-U3', '--', ...(oldRel ? [oldRel, rel] : [rel])], { maxBuffer: 16 * 1024 * 1024 });
    out = r.stdout;
  }
  const truncated = out.length > MAX_DIFF_CHARS;
  return { path: rel, diff: truncated ? out.slice(0, MAX_DIFF_CHARS) : out, truncated, binary: /^Binary files .* differ$/m.test(out) || /^GIT binary patch/m.test(out) };
}

export interface GitFileContent { path: string; size: number; binary: boolean; truncated: boolean; content: string; source: 'worktree' | 'head' }

export async function gitFile(cwd: string, rel: string): Promise<GitFileContent> {
  const found = await findRepo(cwd);
  if (!found.ok) throw new PathError(found.message);
  const { root } = found.repo;
  const abs = await safePath(cwd, root, rel, false);

  let size = 0; let exists = true;
  try { const st = await stat(abs); if (!st.isFile()) throw new PathError('Not a file'); size = st.size; }
  catch (e) { if (e instanceof PathError) throw e; exists = false; }

  if (exists) {
    await safePath(cwd, root, rel, true);
    const fh = await open(abs, 'r');
    try {
      const len = Math.min(size, MAX_FILE_BYTES);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, 0);
      if (buf.subarray(0, 8000).includes(0)) return { path: rel, size, binary: true, truncated: false, content: '', source: 'worktree' };
      return { path: rel, size, binary: false, truncated: size > MAX_FILE_BYTES, content: buf.toString('utf8'), source: 'worktree' };
    } finally { await fh.close(); }
  }
  // Deleted from the working tree: show what the last commit had.
  try {
    const { stdout } = await git(root, ['show', `HEAD:${rel}`], { maxBuffer: 16 * 1024 * 1024 });
    const bin = stdout.slice(0, 8000).includes('\0');
    return { path: rel, size: Buffer.byteLength(stdout), binary: bin, truncated: stdout.length > MAX_FILE_BYTES, content: bin ? '' : stdout.slice(0, MAX_FILE_BYTES), source: 'head' };
  } catch { throw new PathError('File not found'); }
}

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.bmp': 'image/bmp', '.avif': 'image/avif' };
export const imageType = (rel: string) => IMAGE_TYPES[extname(rel).toLowerCase()];

/** Absolute path of an image inside the agent's folder, or throws. Used to stream a preview. */
export async function gitImagePath(cwd: string, rel: string): Promise<{ abs: string; type: string; size: number }> {
  const type = imageType(rel); if (!type) throw new PathError('Not an image');
  const found = await findRepo(cwd);
  if (!found.ok) throw new PathError(found.message);
  const abs = await safePath(cwd, found.repo.root, rel, true);
  const st = await stat(abs);
  if (!st.isFile() || st.size > MAX_IMAGE_BYTES) throw new PathError('Image is too large to preview');
  return { abs, type, size: st.size };
}
