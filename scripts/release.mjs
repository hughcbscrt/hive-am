// Release: bump versions, write the changelog entry, commit, tag and push.
//   node scripts/release.mjs <patch|minor|major|x.y.z> [--dry-run] [--no-push] [--allow-branch]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const sh = (cmd, a) => execFileSync(cmd, a, { cwd: root, stdio: 'inherit' });
const die = (m) => { console.error(`release: ${m}`); process.exit(1); };

const [bump, ...flags] = process.argv.slice(2);
const dry = flags.includes('--dry-run'), noPush = flags.includes('--no-push'), anyBranch = flags.includes('--allow-branch');
if (!bump) die('usage: release.mjs <patch|minor|major|x.y.z> [--dry-run] [--no-push] [--allow-branch]');

const pkgPath = join(root, 'package.json');
const current = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
const next = (() => {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;
  const [M, m, p] = current.split('.').map(Number);
  if (bump === 'major') return `${M + 1}.0.0`;
  if (bump === 'minor') return `${M}.${m + 1}.0`;
  if (bump === 'patch') return `${M}.${m}.${p + 1}`;
  return die(`unknown bump "${bump}"`);
})();
const tag = `v${next}`;

// Commits since the last tag (all of them for the first release); merges and earlier release commits are left out.
const lastTag = (() => { try { return git('describe', '--tags', '--abbrev=0', '--match', 'v*'); } catch { return ''; } })();
const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
const subjects = git('log', range, '--no-merges', '--format=%s').split('\n').filter((s) => s && !/^release v\d/.test(s));
const date = new Date().toISOString().slice(0, 10);
const entry = `## [${next}] - ${date}\n\n${subjects.length ? subjects.map((s) => `- ${s}`).join('\n') : '- No changes recorded.'}\n`;

console.log(`${current} → ${next}  (${tag})  ${lastTag ? `since ${lastTag}` : 'first release'}\n`);
console.log(entry);
if (dry) { console.log('(dry run: nothing was changed)'); process.exit(0); }

if (git('status', '--porcelain')) die('the working tree has uncommitted changes. Commit or stash them first.');
const branch = git('branch', '--show-current');
if (branch !== 'main' && !anyBranch) die(`you are on "${branch}", not main (use ALLOW_BRANCH=1 to release from here).`);
if (git('tag', '--list', tag)) die(`the tag ${tag} already exists.`);
if (!noPush) {
  git('fetch', 'origin', '--quiet');
  const behind = git('rev-list', '--count', `HEAD..origin/${branch}`);
  if (behind !== '0') die(`${branch} is ${behind} commit(s) behind origin/${branch}. Pull first.`);
}

console.log('› typecheck');
sh('npm', ['run', 'typecheck']);

console.log('› bump versions');
sh('npm', ['version', next, '--no-git-tag-version', '--workspaces', '--include-workspace-root', '--allow-same-version']);

const clPath = join(root, 'CHANGELOG.md');
const header = '# Changelog\n\nAll notable changes to hive-am are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [Semantic Versioning](https://semver.org/).\n\n';
const old = existsSync(clPath) ? readFileSync(clPath, 'utf8').replace(/^# Changelog[\s\S]*?(?=^## \[)/m, '') : '';
writeFileSync(clPath, `${header}${entry}\n${old}`.replace(/\n+$/, '\n'));

git('add', 'package.json', 'package-lock.json', 'server/package.json', 'web/package.json', 'CHANGELOG.md');
git('commit', '-m', `release ${tag}`);
git('tag', '-a', tag, '-m', `hive-am ${tag}`);
console.log(`› committed and tagged ${tag}`);
if (noPush) console.log(`(not pushed) git push origin ${branch} ${tag}`);
else { sh('git', ['push', 'origin', branch, tag]); console.log(`› pushed ${branch} and ${tag}`); }
