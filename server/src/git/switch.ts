import { rm } from 'node:fs/promises';
import { GitOpError, done, exclusive, repoOf, run, validBranch, type GitResult } from './ops.js';
import { SMART_PREFIX, hasHead, repoState, safePath, smartStash } from './repo.js';

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

export interface SmartResult extends GitResult {
  pending: 'conflicts' | null;
  /** New files of yours that already existed on the other branch: your version was kept (as a change to that file). */
  kept: string[];
}

/**
 * Switch branches carrying every local change: save them in a stash (new files included), switch, and reapply.
 * Real conflicts are not an error: they are left for the conflict resolver and the stash is kept until they are
 * resolved. A new file of yours that already exists on the other branch stays as yours — it shows up as a change to
 * that file, so the other version is one "discard" away.
 */
export async function smartSwitch(cwd: string, branch: string): Promise<SmartResult> {
  const { root } = await repoOf(cwd);
  const plan = await planSwitch(cwd, branch);
  return exclusive(root, async () => {
    if ((await smartStash(root)) || (await repoState(root)).state) throw new GitOpError('Finish or cancel the switch in progress first');
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
      // The other branch's copy of a file you also created must be out of the way, or git refuses to restore yours.
      for (const p of plan.collisions) await rm(await safePath(cwd, root, p, false), { force: true });
      try { out = (await run(root, ['stash', 'pop'])).out || out; }
      catch (e) {
        const msg = e instanceof GitOpError ? e.message : String(e);
        if (!/conflict/i.test(msg)) throw new GitOpError(`Your changes are saved in a stash (“${SMART_PREFIX}${plan.from} -> ${branch}”) but could not be reapplied:\n${msg}`);
        pending = 'conflicts'; out = msg;
      }
    }
    return { ...done(out), pending, kept: plan.collisions };
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
    try { return { ...done((await run(root, ['stash', pop ? 'pop' : 'apply', ref])).out), pending: null, kept: [] }; }
    catch (e) {
      const msg = e instanceof GitOpError ? e.message : String(e);
      if (/conflict/i.test(msg)) return { ...done(msg), pending: 'conflicts', kept: [] };   // left for the resolver; the stash stays
      throw e;
    }
  });
}

export async function stashDrop(cwd: string, sha: string): Promise<GitResult> {
  const { root } = await repoOf(cwd);
  return exclusive(root, async () => done((await run(root, ['stash', 'drop', await refOf(root, sha)])).out));
}
