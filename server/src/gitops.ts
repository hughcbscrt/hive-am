import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { findRepo, gitEnv, hasHead, isPathError, parseNumstat, PathError, repoState, safePath, type Repo } from './git.js';

/**
 * Git actions for the explorer: history (reads) and commit / pull / push / fetch / branches (writes).
 * Same rules as git.ts: `execFile` with no shell, user input only ever as an argument value (messages after -m,
 * paths after `--`, branch names validated), never `--force`, and no command that can prompt for credentials.
 */
export { isPathError };
export class GitOpError extends Error {}

const LOCAL_TIMEOUT = 30_000;
const NET_TIMEOUT = 120_000;
const LOG_PAGE = 30;

function run(cwd: string, args: string[], o: { network?: boolean; okCodes?: number[]; env?: Record<string, string> } = {}): Promise<{ out: string; code: number }> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.quotepath=off', '-c', 'color.ui=never', ...args], {
      cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: o.network ? NET_TIMEOUT : LOCAL_TIMEOUT,
      env: gitEnv({ GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes -o ConnectTimeout=15', ...o.env }),
    }, (err: any, stdout, stderr) => {
      const out = `${stdout ?? ''}${stderr ? (stdout ? '\n' : '') + stderr : ''}`.trim();
      if (!err) return resolve({ out, code: 0 });
      if (typeof err.code === 'number' && (o.okCodes ?? []).includes(err.code)) return resolve({ out: String(stdout ?? ''), code: err.code });
      if (err.killed) return reject(new GitOpError(`git ${args[0]} timed out`));
      if (err.code === 'ENOENT') return reject(new GitOpError('git is not installed or not in PATH'));
      reject(new GitOpError((out || err.message || 'git failed').slice(-1500)));
    });
  });
}

async function repoOf(cwd: string): Promise<Repo> {
  const f = await findRepo(cwd);
  if (!f.ok) throw new GitOpError(f.message);
  return f.repo;
}

/** One write at a time per repository (double clicks, or two tabs) so we never fight over index.lock. */
const locks = new Map<string, Promise<unknown>>();
async function exclusive<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(root) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(root, next);
  try { return await next; } finally { if (locks.get(root) === next) locks.delete(root); }
}

const SHA = /^[0-9a-f]{4,40}$/i;
async function validBranch(root: string, name: string) {
  if (!name || name.startsWith('-') || name.includes('\0')) throw new GitOpError('Invalid branch name');
  await run(root, ['check-ref-format', '--branch', name]).catch(() => { throw new GitOpError(`"${name}" is not a valid branch name`); });
}

/* ------------------------------------------------------------------ reads */

export interface GitCommit { sha: string; short: string; author: string; date: string; subject: string; refs: string[]; merge: boolean }

export async function gitLog(cwd: string, skip = 0): Promise<{ commits: GitCommit[]; hasMore: boolean }> {
  const { root, scope } = await repoOf(cwd);
  if (!(await hasHead(root))) return { commits: [], hasMore: false };
  const { out } = await run(root, ['log', `--skip=${Math.max(0, Math.floor(skip))}`, `--max-count=${LOG_PAGE + 1}`, '--decorate=short',
    '--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1f%D%x1f%P%x1e', '--', scope || '.']);
  const all = out.split('\x1e').map((r) => r.trim()).filter(Boolean).map((r) => {
    const [sha, short, author, date, subject, refs, parents] = r.split('\x1f');
    return { sha, short, author, date, subject, refs: (refs ?? '').split(', ').map((x) => x.replace(/^HEAD -> /, '').trim()).filter((x) => x && x !== 'HEAD'), merge: (parents ?? '').trim().split(' ').filter(Boolean).length > 1 };
  });
  return { commits: all.slice(0, LOG_PAGE), hasMore: all.length > LOG_PAGE };
}

const isMergeCommit = async (root: string, sha: string) => (await run(root, ['rev-list', '--parents', '-n', '1', sha])).out.trim().split(' ').length > 2;

export interface GitCommitFile { path: string; oldPath?: string; status: 'modified' | 'added' | 'deleted' | 'renamed' | 'typechange'; additions: number | null; deletions: number | null }
export interface GitCommitDetail { sha: string; author: string; email: string; date: string; message: string; files: GitCommitFile[]; truncated: boolean }
const MAX_COMMIT_FILES = 500;

export async function gitCommitDetail(cwd: string, sha: string): Promise<GitCommitDetail> {
  if (!SHA.test(sha)) throw new PathError('Invalid commit');
  const { root } = await repoOf(cwd);
  const isMerge = await isMergeCommit(root, sha);
  // A merge commit has no diff of its own; show what it brought in relative to the branch it was made on (first parent).
  const range = isMerge ? [`${sha}^1`, sha] : ['--root', sha];
  const [meta, names, nums] = await Promise.all([
    run(root, ['show', '-s', '--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%B', sha]),
    run(root, ['diff-tree', '-r', '-M', '--name-status', '-z', '--no-commit-id', ...range]),
    run(root, ['diff-tree', '-r', '-M', '--numstat', '-z', '--no-commit-id', ...range]),
  ]);
  const counts = parseNumstat(nums.out);
  const files: GitCommitFile[] = [];
  const st = names.out.split('\0');
  for (let i = 0; i < st.length; i++) {
    const code = st[i]; if (!code) continue;
    const k = code[0];
    if (k === 'R' || k === 'C') { const oldPath = st[++i], path = st[++i]; const c = counts.get(path); files.push({ path, oldPath: k === 'R' ? oldPath : undefined, status: k === 'R' ? 'renamed' : 'added', additions: c?.a ?? null, deletions: c?.d ?? null }); }
    else { const path = st[++i]; const c = counts.get(path); files.push({ path, status: k === 'A' ? 'added' : k === 'D' ? 'deleted' : k === 'T' ? 'typechange' : 'modified', additions: c?.a ?? null, deletions: c?.d ?? null }); }
  }
  const [h, author, email, date, ...msg] = meta.out.split('\x1f');
  return { sha: h, author, email, date, message: msg.join('\x1f').trim(), files: files.slice(0, MAX_COMMIT_FILES), truncated: files.length > MAX_COMMIT_FILES };
}

export async function gitCommitDiff(cwd: string, sha: string, rel: string, oldRel?: string): Promise<{ path: string; diff: string; truncated: boolean; binary: boolean }> {
  if (!SHA.test(sha)) throw new PathError('Invalid commit');
  const { root } = await repoOf(cwd);
  await safePath(cwd, root, rel, false); if (oldRel) await safePath(cwd, root, oldRel, false);
  const isMerge = await isMergeCommit(root, sha);
  const { out } = await run(root, isMerge
    ? ['diff', '--no-color', '--no-ext-diff', '-M', '-U3', `${sha}^1`, sha, '--', ...(oldRel ? [oldRel, rel] : [rel])]
    : ['show', '--no-color', '--no-ext-diff', '--format=', '-M', '-U3', sha, '--', ...(oldRel ? [oldRel, rel] : [rel])]);
  const MAX = 600_000;
  return { path: rel, diff: out.length > MAX ? out.slice(0, MAX) : out, truncated: out.length > MAX, binary: /^Binary files .* differ$/m.test(out) || /^GIT binary patch/m.test(out) };
}

export interface GitBlame { path: string; commits: Record<string, { short: string; author: string; time: number; summary: string; uncommitted: boolean }>; lines: string[]; truncated: boolean }
const MAX_BLAME_LINES = 5000;

/** Who last touched each line of a file (working-tree version; unsaved edits show as "Not committed yet"). */
export async function gitBlame(cwd: string, rel: string): Promise<GitBlame> {
  const { root } = await repoOf(cwd);
  await safePath(cwd, root, rel, true);
  if (!(await hasHead(root))) throw new GitOpError('No commits yet, so there is nothing to blame');
  const { out } = await run(root, ['blame', '--porcelain', '-w', '--', rel]);
  const commits: GitBlame['commits'] = {}; const lines: string[] = [];
  let sha = '';
  for (const l of out.split('\n')) {
    const h = /^([0-9a-f]{40}) \d+ \d+( \d+)?$/.exec(l);
    if (h) { sha = h[1]; if (!commits[sha]) commits[sha] = { short: sha.slice(0, 7), author: '', time: 0, summary: '', uncommitted: /^0+$/.test(sha) }; continue; }
    if (l.startsWith('\t')) { if (lines.length < MAX_BLAME_LINES) lines.push(sha); continue; }
    const c = commits[sha]; if (!c) continue;
    if (l.startsWith('author ')) c.author = l.slice(7);
    else if (l.startsWith('author-time ')) c.time = Number(l.slice(12)) * 1000;
    else if (l.startsWith('summary ')) c.summary = l.slice(8);
  }
  return { path: rel, commits, lines, truncated: out.split('\n').filter((l) => l.startsWith('\t')).length > MAX_BLAME_LINES };
}

/** `date` is an ISO 8601 date (the UI formats it). */
export interface GitBranches { current: string | null; local: { name: string; upstream: string | null; date: string; subject: string }[]; remote: { name: string; date: string; subject: string }[] }

export async function gitBranches(cwd: string): Promise<GitBranches> {
  const { root } = await repoOf(cwd);
  const { out } = await run(root, ['for-each-ref', '--sort=-committerdate', '--format=%(refname)%1f%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(committerdate:iso-strict)%1f%(subject)', 'refs/heads', 'refs/remotes']);
  const res: GitBranches = { current: null, local: [], remote: [] };
  for (const line of out.split('\n').filter(Boolean)) {
    const [ref, name, head, upstream, date, subject] = line.split('\x1f');
    if (ref.startsWith('refs/heads/')) { res.local.push({ name, upstream: upstream || null, date, subject }); if (head === '*') res.current = name; }
    else if (!ref.endsWith('/HEAD')) res.remote.push({ name, date, subject });
  }
  return res;
}

/* ------------------------------------------------------------------ writes */

export interface GitResult { ok: true; output: string }
const done = (output: string): GitResult => ({ ok: true, output });

export async function gitCommitChanges(cwd: string, message: string, paths: string[]): Promise<GitResult> {
  const msg = message.trim();
  if (!msg) throw new GitOpError('Write a commit message');
  if (msg.length > 20_000) throw new GitOpError('Commit message is too long');
  if (!paths.length) throw new GitOpError('Select at least one file to commit');
  if (paths.length > 5000) throw new GitOpError('Too many files selected');
  const { root } = await repoOf(cwd);
  for (const p of paths) await safePath(cwd, root, p, false);
  return exclusive(root, async () => {
    await run(root, ['add', '-A', '--', ...paths]);
    // `-- paths` commits only the selected files, whatever else happens to be staged. A first commit has nothing to be
    // "partial" against, so there it commits what was just staged.
    // Git refuses a partial commit while a merge is in progress (it must conclude the merge with everything staged),
    // so in that case, and on a first commit, it commits the index as it now stands.
    const merging = (await repoState(root)).state === 'merge';
    const args = (await hasHead(root)) && !merging ? ['commit', '-m', msg, '--', ...paths] : ['commit', '-m', msg];
    return done((await run(root, args)).out);
  });
}

export async function gitFetch(cwd: string): Promise<GitResult> {
  const { root } = await repoOf(cwd);
  return exclusive(root, async () => done((await run(root, ['fetch', '--all', '--prune'], { network: true })).out || 'Fetched'));
}

export type PullMode = 'ff-only' | 'merge' | 'rebase';
export async function gitPull(cwd: string, mode: PullMode = 'ff-only'): Promise<GitResult> {
  const { root } = await repoOf(cwd);
  const flag = { 'ff-only': '--ff-only', merge: '--no-rebase', rebase: '--rebase' }[mode];
  if (!flag) throw new GitOpError('Unknown pull mode');
  return exclusive(root, async () => done((await run(root, ['pull', flag, '--no-edit'], { network: true })).out));
}

export async function gitPush(cwd: string): Promise<GitResult> {
  const { root } = await repoOf(cwd);
  return exclusive(root, async () => {
    const branch = (await run(root, ['symbolic-ref', '--short', '-q', 'HEAD'], { okCodes: [1] })).out.trim();
    if (!branch) throw new GitOpError('Not on a branch (detached HEAD): switch to a branch before pushing');
    const hasUp = (await run(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { okCodes: [128] }).catch(() => ({ code: 1 }))).code === 0;
    if (hasUp) return done((await run(root, ['push'], { network: true })).out || 'Pushed');
    const remotes = (await run(root, ['remote'])).out.split('\n').map((x) => x.trim()).filter(Boolean);
    if (!remotes.length) throw new GitOpError('This repository has no remote to push to');
    return done((await run(root, ['push', '-u', remotes.includes('origin') ? 'origin' : remotes[0], branch], { network: true })).out || 'Pushed');
  });
}

export async function gitSwitch(cwd: string, branch: string, create = false): Promise<GitResult> {
  const { root } = await repoOf(cwd);
  await validBranch(root, branch);
  return exclusive(root, async () => done((await run(root, create ? ['switch', '-c', branch] : ['switch', branch])).out || `On ${branch}`));
}

export async function gitMerge(cwd: string, branch: string): Promise<GitResult> {
  const { root } = await repoOf(cwd);
  if (!branch || branch.startsWith('-') || branch.includes('\0')) throw new GitOpError('Invalid branch name');
  await run(root, ['rev-parse', '--verify', '--quiet', `${branch}^{commit}`]).catch(() => { throw new GitOpError(`Branch "${branch}" was not found`); });
  return exclusive(root, async () => done((await run(root, ['merge', '--no-edit', branch])).out));
}

/** Cancel whatever is half-done: a merge, or a rebase started by "pull with rebase". */
export async function gitMergeAbort(cwd: string): Promise<GitResult> {
  const { root } = await repoOf(cwd);
  return exclusive(root, async () => done((await run(root, (await repoState(root)).state === 'rebase' ? ['rebase', '--abort'] : ['merge', '--abort'])).out || 'Aborted'));
}

/** Finish a rebase once every conflict is resolved (a merge is finished with a normal commit). */
export async function gitRebaseContinue(cwd: string): Promise<GitResult> {
  const { root } = await repoOf(cwd);
  return exclusive(root, async () => done((await run(root, ['rebase', '--continue'], { env: { GIT_EDITOR: 'true' } })).out || 'Continued'));
}

/* ------------------------------------------------------------------ conflict resolution */

const MAX_RESOLVED_BYTES = 5_000_000;
async function assertConflicted(root: string, rel: string) {
  if (!(await run(root, ['ls-files', '-u', '--', rel])).out.trim()) throw new GitOpError('That file has no conflict to resolve');
}

/** Take one whole side of a conflicted file ("mine" = ours in a merge) and mark it resolved. */
export async function gitResolveSide(cwd: string, rel: string, side: 'ours' | 'theirs'): Promise<GitResult> {
  if (side !== 'ours' && side !== 'theirs') throw new GitOpError('Unknown side');
  const { root } = await repoOf(cwd);
  await safePath(cwd, root, rel, false);
  await assertConflicted(root, rel);
  return exclusive(root, async () => {
    try { await run(root, ['checkout', `--${side}`, '--', rel]); }
    catch (e) {
      // That side deleted the file: taking it means deleting it.
      if (e instanceof GitOpError && /does not have (our|their) version/i.test(e.message)) { await run(root, ['rm', '-q', '--', rel]); return done('Resolved'); }
      throw e;
    }
    await run(root, ['add', '--', rel]);
    return done('Resolved');
  });
}

/** Save the hand-built result of a conflicted file and mark it resolved. Refuses leftover conflict markers. */
export async function gitResolveContent(cwd: string, rel: string, content: string, keepMarkers = false): Promise<GitResult> {
  if (typeof content !== 'string' || content.includes('\0')) throw new GitOpError('Invalid file content');
  if (Buffer.byteLength(content) > MAX_RESOLVED_BYTES) throw new GitOpError('The file is too large to save from here');
  if (!keepMarkers && /^(<{7}|>{7})( |$)/m.test(content)) throw new GitOpError('The result still has conflict markers (<<<<<<< / >>>>>>>). Resolve every conflict first.');
  const { root } = await repoOf(cwd);
  const abs = await safePath(cwd, root, rel, true);
  await assertConflicted(root, rel);
  return exclusive(root, async () => {
    await writeFile(abs, content);   // keeps the file's mode and ownership
    await run(root, ['add', '--', rel]);
    return done('Resolved');
  });
}

/** Undo "resolved": bring the conflict markers back so it can be resolved again. */
export async function gitUnresolve(cwd: string, rel: string): Promise<GitResult> {
  const { root } = await repoOf(cwd);
  await safePath(cwd, root, rel, false);
  return exclusive(root, async () => done((await run(root, ['checkout', '-m', '--', rel])).out || 'Conflict restored'));
}
