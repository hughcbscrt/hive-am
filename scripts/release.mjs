// Release: ask for the changes, bump versions, update CHANGELOG.md (Keep a Changelog), commit, tag and push.
//   node scripts/release.mjs <patch|minor|major|x.y.z> [--dry-run] [--no-push] [--allow-branch] [--yes]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ask, askEntries, countEntries, label, load, release, sectionsText, TYPES } from './changelog.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const sh = (cmd, a) => execFileSync(cmd, a, { cwd: root, stdio: 'inherit' });
const die = (m) => { console.error(`release: ${m}`); process.exit(1); };

const [bump, ...flags] = process.argv.slice(2);
const dry = flags.includes('--dry-run'), noPush = flags.includes('--no-push'), anyBranch = flags.includes('--allow-branch'), yes = flags.includes('--yes');
if (!bump) die('uso: release.mjs <patch|minor|major|x.y.z> [--dry-run] [--no-push] [--allow-branch] [--yes]');

const current = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const next = (() => {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;
  const [M, m, p] = current.split('.').map(Number);
  if (bump === 'major') return `${M + 1}.0.0`;
  if (bump === 'minor') return `${M}.${m + 1}.0`;
  if (bump === 'patch') return `${M}.${m}.${p + 1}`;
  return die(`"${bump}" no es patch, minor, major ni una versión x.y.z`);
})();
const tag = `v${next}`;
const date = new Date().toISOString().slice(0, 10);
const tty = process.stdin.isTTY && process.stdout.isTTY;

const lastTag = (() => { try { return git('describe', '--tags', '--abbrev=0', '--match', 'v*'); } catch { return ''; } })();
const commits = () => git('log', lastTag ? `${lastTag}..HEAD` : 'HEAD', '--no-merges', '--format=%s').split('\n').filter((s) => s && !/^release v\d/.test(s));

const data = load();
const show = () => console.log(`\n## [${next}] - ${date}\n\n${sectionsText(data.unreleased, data.lang)}\n`);

console.log(`${current} → ${next}  (${tag})  ${lastTag ? `desde ${lastTag}` : 'primera versión'}`);
if (dry) {
  if (countEntries(data.unreleased)) show();
  else console.log('\nNo hay cambios en la sección "Sin publicar"; `make release` te los pedirá. Commits como referencia:\n' + commits().slice(0, 25).map((s) => `  · ${s}`).join('\n'));
  console.log('\n(prueba: no se cambió nada)');
  process.exit(0);
}

// Checks before asking anything.
if (git('status', '--porcelain')) die('hay cambios sin subir. Haz commit (y push) primero.');
const branch = git('branch', '--show-current');
if (branch !== 'main' && !anyBranch) die(`estás en "${branch}", no en main (usa ALLOW_BRANCH=1 para publicar desde aquí).`);
if (git('tag', '--list', tag)) die(`el tag ${tag} ya existe.`);
if (!noPush) {
  git('fetch', 'origin', '--quiet');
  const behind = git('rev-list', '--count', `HEAD..origin/${branch}`);
  if (behind !== '0') die(`${branch} está ${behind} commit(s) detrás de origin/${branch}. Haz pull primero.`);
  const ahead = git('rev-list', '--count', `origin/${branch}..HEAD`);
  if (ahead !== '0') die(`hay ${ahead} commit(s) sin subir a origin/${branch}. Haz push primero.`);
}

// The changes of this version, by type.
if (!countEntries(data.unreleased)) {
  if (!tty) die('la sección "Sin publicar" de CHANGELOG.md está vacía y no hay terminal para pedirte los cambios (usa `make changelog-add`).');
  const refs = commits();
  if (refs.length) console.log(`\nCommits desde ${lastTag || 'el inicio'} (referencia):\n${refs.slice(0, 25).map((s) => `  · ${s}`).join('\n')}${refs.length > 25 ? `\n  … y ${refs.length - 25} más` : ''}`);
  await askEntries(data);
} else if (tty && !yes) {
  console.log('\nCambios registrados en "Sin publicar":');
  show();
  if (/^(s|si|sí|y|yes)$/i.test(await ask('¿Agregar más cambios? [s/N] '))) await askEntries(data);
}
if (!countEntries(data.unreleased)) die('no hay cambios que registrar; no se publica nada.');

show();
if (tty && !yes && !/^(|s|si|sí|y|yes)$/i.test(await ask(`¿Publicar ${tag}? [S/n] `))) die('cancelado.');

console.log('› comprobando tipos');
sh('npm', ['run', 'typecheck']);
console.log('› subiendo versiones');
sh('npm', ['version', next, '--no-git-tag-version', '--workspaces', '--include-workspace-root', '--allow-same-version']);
release(data, next, date);

git('add', 'package.json', 'package-lock.json', 'server/package.json', 'web/package.json', 'CHANGELOG.md');
git('commit', '-m', `release ${tag}`);
git('tag', '-a', tag, '-m', `hive-am ${tag}`);
console.log(`› commit y tag ${tag} creados`);
if (noPush) console.log(`(sin subir) git push origin ${branch} ${tag}`);
else { sh('git', ['push', 'origin', branch, tag]); console.log(`› subidos ${branch} y ${tag}`); }
