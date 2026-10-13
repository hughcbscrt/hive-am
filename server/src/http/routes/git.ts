import { createReadStream } from 'node:fs';
import { agents } from '../../db.js';
import { gitDiff, gitFile, gitImagePath, gitList, gitStatus, gitTree } from '../../git/repo.js';
import { listStashes, planSwitch, smartCancel, smartFinish, smartSwitch, stashApply, stashDetail, stashDrop, stashSave } from '../../git/switch.js';
import { gitCompare, gitCompareDiff, gitGrep, gitImageAt, gitRefs } from '../../git/browse.js';
import { gitBlame, gitBranchCreate, gitBranchDelete, gitRefFile, gitBranches, gitCommitDetail, gitCommitChanges, gitCommitDiff, gitDiscardAll, gitDiscardFile, gitDiscardHunk, gitDiscardLines, gitFetch, gitLog, gitMerge, gitMergeAbort, gitPull, gitPush, gitRebaseContinue, gitResolveContent, gitResolveSide, gitSwitch, gitTagFile, gitTagTree, gitTags, gitUnresolve, type PullMode } from '../../git/ops.js';
import { agentCwd, othersInRepo } from '../../services/agents.js';
import { body, type Body } from '../body.js';
import { requireLocal } from '../guards.js';
import { route } from '../router.js';
import { numList, qpath, text } from '../validate.js';

// Errors from git (GitOpError, PathError) become 400 in http/errors.ts. Everything here is scoped to the agent's effective folder.
const CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'";
const q = (url: URL, key: string) => url.searchParams.get(key) ?? '';
const old = (url: URL) => url.searchParams.get('old') ?? undefined;

// ---- read-only explorer ----
route('GET', '/api/agents/:id/git/status', ({ params }) => gitStatus(agentCwd(params[0])));
route('GET', '/api/agents/:id/git/ls', ({ params, url }) => gitList(agentCwd(params[0]), qpath(url)));
route('GET', '/api/agents/:id/git/tree', ({ params }) => gitTree(agentCwd(params[0])));
route('GET', '/api/agents/:id/git/diff', ({ params, url }) => gitDiff(agentCwd(params[0]), qpath(url), old(url)));
route('GET', '/api/agents/:id/git/file', ({ params, url }) => gitFile(agentCwd(params[0]), qpath(url)));
route('GET', '/api/agents/:id/git/raw', async ({ params, url, res }) => {
  const img = await gitImagePath(agentCwd(params[0]), qpath(url));
  // Served only as an inert image: no sniffing, and a sandbox policy so an SVG can never run scripts.
  res.writeHead(200, { 'content-type': img.type, 'content-length': img.size, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': CSP });
  createReadStream(img.abs).pipe(res);
});

// ---- history and actions (writes: commit, pull, push, fetch, branches) ----
/** The API allows any origin (it is a local tool), so writes also check that the request comes from a local page. */
const gitWrite = (path: string, fn: (cwd: string, b: Body) => Promise<unknown>) =>
  route('POST', `/api/agents/:id/git/${path}`, async ({ req, params }) => {
    requireLocal(req, 'Git actions are only allowed from the local app');
    const b = await body(req); return fn(agentCwd(params[0]), b);
  });

route('GET', '/api/agents/:id/git/log', ({ params, url }) => {
  const by = url.searchParams.get('by');
  return gitLog(agentCwd(params[0]), Number(url.searchParams.get('skip') ?? 0), {
    path: url.searchParams.get('path') ?? undefined, q: url.searchParams.get('q') ?? undefined, ref: url.searchParams.get('ref') ?? undefined,
    by: by === 'author' || by === 'content' ? by : 'message',
  });
});
route('GET', '/api/agents/:id/git/commit', ({ params, url }) => gitCommitDetail(agentCwd(params[0]), q(url, 'sha')));
route('GET', '/api/agents/:id/git/commit-diff', ({ params, url }) => gitCommitDiff(agentCwd(params[0]), q(url, 'sha'), qpath(url), old(url)));
route('GET', '/api/agents/:id/git/blame', ({ params, url }) => gitBlame(agentCwd(params[0]), qpath(url)));
// Smart switch: what would happen, plus which other agents are working in the same repository right now (a switch moves their files too).
route('GET', '/api/agents/:id/git/switch-plan', async ({ params, url }) => {
  const cwd = agentCwd(params[0]);
  const plan = await planSwitch(cwd, q(url, 'branch'));
  const others = await othersInRepo(params[0], cwd);
  return { ...plan, others, selfRunning: agents.get(params[0])?.status === 'running' };
});
route('GET', '/api/agents/:id/git/stashes', ({ params }) => listStashes(agentCwd(params[0])));
route('GET', '/api/agents/:id/git/stash', ({ params, url }) => stashDetail(agentCwd(params[0]), q(url, 'sha')));
route('GET', '/api/agents/:id/git/refs', ({ params }) => gitRefs(agentCwd(params[0])));
route('GET', '/api/agents/:id/git/compare', ({ params, url }) => gitCompare(agentCwd(params[0]), q(url, 'base'), q(url, 'head')));
route('GET', '/api/agents/:id/git/compare-diff', ({ params, url }) => gitCompareDiff(agentCwd(params[0]), q(url, 'base'), q(url, 'head'), qpath(url), old(url)));
route('GET', '/api/agents/:id/git/grep', ({ params, url }) => gitGrep(agentCwd(params[0]), q(url, 'q'), url.searchParams.get('case') === '1'));
route('GET', '/api/agents/:id/git/ref-file', ({ params, url }) => gitRefFile(agentCwd(params[0]), q(url, 'ref'), qpath(url)));
route('GET', '/api/agents/:id/git/raw-at', async ({ params, url, res }) => {
  const img = await gitImageAt(agentCwd(params[0]), q(url, 'ref'), qpath(url));
  res.writeHead(200, { 'content-type': img.type, 'content-length': img.bytes.length, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff', 'content-security-policy': CSP });
  res.end(img.bytes);
});
route('GET', '/api/agents/:id/git/tags', ({ params }) => gitTags(agentCwd(params[0])));
route('GET', '/api/agents/:id/git/tag-tree', ({ params, url }) => gitTagTree(agentCwd(params[0]), q(url, 'tag')));
route('GET', '/api/agents/:id/git/tag-file', ({ params, url }) => gitTagFile(agentCwd(params[0]), q(url, 'tag'), qpath(url)));
route('GET', '/api/agents/:id/git/branches', ({ params }) => gitBranches(agentCwd(params[0])));
gitWrite('commit', (cwd, b) => gitCommitChanges(cwd, text(b.message), Array.isArray(b.paths) ? b.paths.map(String) : []));
gitWrite('fetch', (cwd) => gitFetch(cwd));
gitWrite('pull', (cwd, b) => gitPull(cwd, (['ff-only', 'merge', 'rebase'].includes(b.mode as string) ? b.mode : 'ff-only') as PullMode));
gitWrite('push', (cwd) => gitPush(cwd));
gitWrite('switch', (cwd, b) => gitSwitch(cwd, text(b.branch), !!b.create));
gitWrite('branch-create', (cwd, b) => gitBranchCreate(cwd, text(b.branch), text(b.from)));
gitWrite('branch-delete', (cwd, b) => gitBranchDelete(cwd, text(b.branch), !!b.force));
gitWrite('merge', (cwd, b) => gitMerge(cwd, text(b.branch)));
gitWrite('merge-abort', (cwd) => gitMergeAbort(cwd));
gitWrite('switch-smart', (cwd, b) => smartSwitch(cwd, text(b.branch)));
gitWrite('smart-finish', (cwd) => smartFinish(cwd));
gitWrite('smart-cancel', (cwd) => smartCancel(cwd));
gitWrite('stash-save', (cwd, b) => stashSave(cwd, text(b.message)));
gitWrite('stash-apply', (cwd, b) => stashApply(cwd, text(b.sha), !!b.pop));
gitWrite('stash-drop', (cwd, b) => stashDrop(cwd, text(b.sha)));
gitWrite('discard', (cwd, b) => gitDiscardFile(cwd, text(b.path), b.oldPath ? String(b.oldPath) : undefined));
gitWrite('discard-hunk', (cwd, b) => gitDiscardHunk(cwd, text(b.path), Number(b.index), text(b.header)));
gitWrite('discard-lines', (cwd, b) => gitDiscardLines(cwd, text(b.path), Number(b.index), text(b.header), numList(b.lines)));
gitWrite('discard-all', (cwd) => gitDiscardAll(cwd));
gitWrite('rebase-continue', (cwd) => gitRebaseContinue(cwd));
gitWrite('resolve-side', (cwd, b) => gitResolveSide(cwd, text(b.path), b.side as Parameters<typeof gitResolveSide>[2]));
gitWrite('resolve', (cwd, b) => gitResolveContent(cwd, text(b.path), text(b.content), !!b.keepMarkers));
gitWrite('unresolve', (cwd, b) => gitUnresolve(cwd, text(b.path)));
