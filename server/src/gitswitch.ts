import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitOpError, done, exclusive, repoOf, run, validBranch, type GitResult } from './gitops.js';
import { PathError, SMART_PREFIX, hasHead, repoState, safePath, smartStash } from './git.js';

/**
 * Smart branch switch (like JetBrains): carry local changes to another branch, and when that is not possible,
 * save them in a stash, switch, and bring them back, leaving real conflicts to the conflict resolver.
 * Also a small stash manager. Everything runs with no shell, one write at a time per repository.
 */

export interface SwitchPlan {
  from: string; to: string;
  /** Local changes (tracked and untracked) that would travel to the other branch. */
  carried: number;
  /** Files you changed that are also different on the other branch: git refuses to switch with them. */
  overlap: string[];
  /** New (untracked) files of yours that already exist on the other branch. */
  collisions: string[];
}

const split0 = (s: string) => s.split('\0').filter(Boolean);

async function currentLabel(root: string): Promise<string> {
  const b = (await run(root, ['symbolic-ref', '--short', '-q', 'HEAD'], { okCodes: [1] })).out.trim();
  return b || (await run(root, ['rev-parse', '--short', 'HEAD'])).out.trim();
}

/** What a local change set looks like: tracked paths (including renamed-from paths) and untracked paths. */
async function localChanges(root: string): Promise<{ tracked: Set<string>; untracked: Set<string> }> {
  const { out } = await run(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { raw: true });
  const parts = out.split('\0'); const tracked = new Set<string>(); const untracked = new Set<string>();
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i]; if (e.length < 4) continue;
    const x = e[0], y = e[1], path = e.slice(3);
    if (x === '?' && y === '?') { untracked.add(path); continue; }
    if (x === '!' ) continue;
    tracked.add(path);
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') tracked.add(parts[++i]);
  }
  return { tracked, untracked };
}

async function resolveTarget(root: string, branch: string): Promise<string> {
  await validBranch(root, branch);
  const local = await run(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`], { okCodes: [1] });
  if (local.code === 0) return local.out.trim();
  const remotes = (await run(root, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes'])).out.split('\n').filter((r) => r && !r.endsWith('/HEAD'));
  const hit = remotes.find((r) => r.split('/').slice(1).join('/') === branch);
  if (hit) return (await run(root, ['rev-parse', '--verify', `${hit}^{commit}`])).out.trim();
  throw new GitOpError(`Branch "${branch}" was not found`);
}

export async function planSwitch(cwd: string, branch: string): Promise<SwitchPlan> {
  const { root } = await repoOf(cwd);
  const target = await resolveTarget(root, branch);
  const [from, ch] = [await currentLabel(root), await localChanges(root)];
  const differs = (await hasHead(root)) ? new Set(split0((await run(root, ['diff', '--name-only', '-z', 'HEAD', target], { raw: true })).out)) : new Set<string>();
  const overlap = [...ch.tracked].filter((p) => differs.has(p)).sort();
  let collisions: string[] = [];
  if (ch.untracked.size) {
    const inTarget = new Set(split0((await run(root, ['ls-tree', '-r', '--name-only', '-z', target], { raw: true })).out));
    collisions = [...ch.untracked].filter((p) => inTarget.has(p)).sort();
  }
  return { from, to: branch, carried: ch.tracked.size + ch.untracked.size, overlap, collisions };
}

/** The two versions of a file that exists on both sides, as a diff: "−" is the other branch's, "+" is yours. */
export async function collisionDiff(cwd: string, rel: string, branch: string): Promise<{ path: string; diff: string; binary: boolean }> {
  const { root } = await repoOf(cwd);
  const abs = await safePath(cwd, root, rel, true);
  const target = await resolveTarget(root, branch);
  const theirs = (await run(root, ['show', `${target}:${rel}`], { raw: true }).catch(() => ({ out: null as string | null }))).out;
  if (theirs === null) throw new PathError('That file does not exist on the other branch');
  const mine = await readFile(abs);
  if (mine.subarray(0, 8000).includes(0) || theirs.includes('\0')) return { path: rel, diff: '', binary: true };
  const dir = await mkdtemp(join(tmpdir(), 'hive-am-cmp-'));
  try {
    const t = join(dir, 'theirs'); await writeFile(t, theirs);
    const { out } = await run(root, ['diff', '--no-index', '--no-color', '--no-ext-diff', '-U3', '--', t, abs], { okCodes: [1], raw: true });
    const text = out.split(t.slice(1)).join(rel).split(abs.slice(1)).join(rel);
    return { path: rel, diff: text.length > 600_000 ? text.slice(0, 600_000) : text, binary: false };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export type SwitchMode = 'smart' | 'force';
export interface SmartResult extends GitResult { pending: 'conflicts' | null }

/**
 * mode "force": switch and throw away whatever stands in the way.
 * mode "smart": save every local change in a stash, switch, and reapply it. `keep` decides, for each new file of
 * yours that already exists on the other branch, which version stays ("mine" overwrites it as a change, "theirs"
 * drops yours). Conflicts while reapplying are not an error: they are left for the resolver and the stash is kept.
 */
export async function smartSwitch(cwd: string, branch: string, mode: SwitchMode, keep: Record<string, 'mine' | 'theirs'> = {}): Promise<SmartResult> {
  const { root } = await repoOf(cwd);
  const plan = await planSwitch(cwd, branch);
  return exclusive(root, async () => {
    if (mode === 'force') { await run(root, ['switch', '-f', branch]); return { ...done(`Switched to ${branch}`), pending: null }; }
    if (mode !== 'smart') throw new GitOpError('Unknown switch mode');
    if ((await smartStash(root)) || (await repoState(root)).state) throw new GitOpError('Finish or cancel the switch in progress first');
    for (const p of plan.collisions) if (keep[p] !== 'mine' && keep[p] !== 'theirs') throw new GitOpError(`Choose which version of ${p} to keep`);

    // New files of yours that already exist on the other branch go into the stash like everything else (so cancelling
    // gets them back). The only special step is at reapply time: the other branch's copy must be out of the way
    // or git refuses to restore yours; afterwards "theirs" puts that copy back and "mine" leaves yours as a change.
    const dirty = (await run(root, ['status', '--porcelain=v1', '--untracked-files=all'], { raw: true })).out.trim().length > 0;
    let stashed = false;
    if (dirty) { await run(root, ['stash', 'push', '-u', '-m', `${SMART_PREFIX}${plan.from} -> ${branch}`]); stashed = true; }

    try { await run(root, ['switch', branch]); }
    catch (e) {                                   // could not switch: put everything back exactly as it was
      if (stashed) await run(root, ['stash', 'pop']).catch(() => undefined);
      throw e;
    }
    let pending: SmartResult['pending'] = null; let out = `Switched to ${branch}`;
    if (stashed) {
      for (const p of plan.collisions) await rm(await safePath(cwd, root, p, false), { force: true });
      try { out = (await run(root, ['stash', 'pop'])).out || out; }
      catch (e) {
        const msg = e instanceof GitOpError ? e.message : String(e);
        if (!/conflict/i.test(msg)) throw new GitOpError(`Your changes are saved in a stash (“${SMART_PREFIX}${plan.from} -> ${branch}”) but could not be reapplied:\n${msg}`);
        pending = 'conflicts'; out = msg;
      }
      for (const p of plan.collisions) if (keep[p] === 'theirs') await run(root, ['checkout', '--', p]).catch(() => undefined);
    }
    return { ...done(out), pending };
  });
}

/** Everything is resolved: unstage (a reapplied stash is not staged), and drop the saved copy. */
export async function smartFinish(cwd: string): Promise<GitResult> {
  const { root } = await repoOf(cwd);
  return exclusive(root, async () => {
    const st = await smartStash(root); if (!st) throw new GitOpError('There is no smart switch in progress');
    if ((await run(root, ['ls-files', '-u'])).out.trim()) throw new GitOpError('Resolve every conflict first');
    await run(root, ['reset', '-q']);
    await run(root, ['stash', 'drop', st.ref]);
    return done('Switch finished');
  });
}

/** Give up on the switch: back to the original branch with the changes exactly as they were. */
export async function smartCancel(cwd: string): Promise<GitResult> {
  const { root } = await repoOf(cwd);
  return exclusive(root, async () => {
    const st = await smartStash(root); if (!st) throw new GitOpError('There is no smart switch in progress');
    // New files the half-done reapply already restored would block the real one: remove exactly those.
    const untracked = split0((await run(root, ['ls-tree', '-r', '--name-only', '-z', `${st.sha}^3`], { raw: true, okCodes: [128] }).catch(() => ({ out: '' }))).out);
    for (const p of untracked) await rm(await safePath(cwd, root, p, false), { force: true });
    await run(root, ['reset', '--hard', '-q']);
    await run(root, /^[0-9a-f]{7,40}$/.test(st.from) ? ['switch', '--detach', st.from] : ['switch', st.from]);
    await run(root, ['stash', 'pop']);
    return done(`Back on ${st.from}`);
  });
}

/* ------------------------------------------------------------------ stash manager */

export interface StashItem { sha: string; message: string; branch: string; date: string; smart: boolean }

async function stashRefs(root: string): Promise<{ ref: string; item: StashItem }[]> {
  const { out } = await run(root, ['stash', 'list', '--format=%gd%x1f%H%x1f%gs%x1f%cI'], { raw: true });
  return out.split('\n').filter(Boolean).map((l) => {
    const [ref, sha, subject, date] = l.split('\x1f');
    const m = /^(?:WIP on|On) ([^:]+): (.*)$/.exec(subject);
    const message = (m ? m[2] : subject).trim();
    return { ref, item: { sha, message: message.startsWith(SMART_PREFIX) ? message.slice(SMART_PREFIX.length).replace(' -> ', ' → ') : message, branch: m ? m[1] : '', date, smart: subject.includes(SMART_PREFIX) } };
  });
}
export async function listStashes(cwd: string): Promise<StashItem[]> {
  const { root } = await repoOf(cwd);
  return (await stashRefs(root)).map((s) => s.item);
}
async function refOf(root: string, sha: string): Promise<string> {
  const hit = (await stashRefs(root)).find((s) => s.item.sha === sha);
  if (!hit) throw new GitOpError('That stash no longer exists: refresh the list');
  return hit.ref;
}

export interface StashDetail { sha: string; untrackedSha: string | null; untracked: string[] }
/** Files of a stash: the tracked ones are read like any commit (see gitCommitDetail); the new files live in its third parent. */
export async function stashDetail(cwd: string, sha: string): Promise<StashDetail> {
  const { root } = await repoOf(cwd); await refOf(root, sha);
  const u = await run(root, ['rev-parse', '--verify', '--quiet', `${sha}^3`], { okCodes: [1] });
  if (u.code !== 0) return { sha, untrackedSha: null, untracked: [] };
  const untrackedSha = u.out.trim();
  return { sha, untrackedSha, untracked: split0((await run(root, ['ls-tree', '-r', '--name-only', '-z', untrackedSha], { raw: true })).out).sort() };
}

export async function stashSave(cwd: string, message: string): Promise<GitResult> {
  const { root } = await repoOf(cwd);
  return exclusive(root, async () => {
    if (!(await run(root, ['status', '--porcelain=v1', '--untracked-files=all'], { raw: true })).out.trim()) throw new GitOpError('There are no changes to stash');
    const msg = message.trim().slice(0, 200) || `changes on ${await currentLabel(root)}`;
    return done((await run(root, ['stash', 'push', '-u', '-m', msg])).out);
  });
}

export async function stashApply(cwd: string, sha: string, pop: boolean): Promise<SmartResult> {
  const { root } = await repoOf(cwd);
  return exclusive(root, async () => {
    const ref = await refOf(root, sha);
    try { return { ...done((await run(root, ['stash', pop ? 'pop' : 'apply', ref])).out), pending: null }; }
    catch (e) {
      const msg = e instanceof GitOpError ? e.message : String(e);
      if (/conflict/i.test(msg)) return { ...done(msg), pending: 'conflicts' };   // left for the resolver; the stash stays
      throw e;
    }
  });
}

export async function stashDrop(cwd: string, sha: string): Promise<GitResult> {
  const { root } = await repoOf(cwd);
  return exclusive(root, async () => done((await run(root, ['stash', 'drop', await refOf(root, sha)])).out));
}
