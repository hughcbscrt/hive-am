// Assembles the npm package in dist/npm: compiled server, built web UI, launcher, and a package.json with only runtime dependencies.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const run = (cmd, args, cwd = root, env = {}) => execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });

const rootPkg = read('package.json');
const server = read('server/package.json');
const web = read('web/package.json');
const out = join(root, 'dist', 'npm');
const stage = join(root, 'dist', 'stage');

rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. Server: TypeScript → JavaScript, plus the MCP script it hands to the agents' CLIs.
console.log('› server');
run('npx', ['tsc', '-p', 'server/tsconfig.build.json', '--outDir', join(out, 'server', 'dist')]);
cpSync(join(root, 'server', 'mcp'), join(out, 'server', 'mcp'), { recursive: true });
writeFileSync(join(out, 'server', 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n');

// 2. Web: built in a staging copy inside the repo (so it resolves the same node_modules) with the default `.next` folder.
console.log('› web');
mkdirSync(join(stage, 'web'), { recursive: true });
for (const f of ['app', 'components', 'lib', 'public', 'next.config.mjs', 'tsconfig.json', 'package.json']) {
  cpSync(join(root, 'web', f), join(stage, 'web', f), { recursive: true });
}
run('npx', ['next', 'build'], join(stage, 'web'));
mkdirSync(join(out, 'web'), { recursive: true });
cpSync(join(stage, 'web', '.next'), join(out, 'web', '.next'), { recursive: true, filter: (src) => !src.includes(`${join('.next', 'cache')}`) });
for (const f of ['public', 'next.config.mjs']) cpSync(join(stage, 'web', f), join(out, 'web', f), { recursive: true });
rmSync(stage, { recursive: true, force: true });

// 3. Launcher and documents.
cpSync(join(root, 'bin'), join(out, 'bin'), { recursive: true });
for (const f of ['README.md', 'LICENSE', 'CHANGELOG.md']) if (existsSync(join(root, f))) cpSync(join(root, f), join(out, f));

// 4. package.json: metadata from the root, runtime dependencies of both workspaces.
const { private: _p, workspaces: _w, scripts: _s, devDependencies: _d, ...meta } = rootPkg;
const pkg = {
  ...meta,
  type: 'module',
  bin: { 'hive-am': 'bin/hive-am.mjs' },
  files: ['bin', 'server/dist', 'server/mcp', 'server/package.json', 'web/.next', 'web/public', 'web/next.config.mjs', 'README.md', 'LICENSE', 'CHANGELOG.md'],
  dependencies: { ...server.dependencies, ...web.dependencies },
  optionalDependencies: server.optionalDependencies,   // the terminal library: where it cannot be installed, hive-am still runs and says terminals are off
  engines: { node: '>=20' },
};
writeFileSync(join(out, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
console.log(`› dist/npm ready: ${pkg.name}@${pkg.version}`);
