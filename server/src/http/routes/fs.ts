import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { bad } from '../errors.js';
import { route } from '../router.js';

// ---- folder picker ----
route('GET', '/api/fs/dirs', ({ url }) => {
  const p = resolve(url.searchParams.get('path') || homedir());
  if (!existsSync(p) || !statSync(p).isDirectory()) throw bad('Not a folder');
  // `files=yml,yaml` also lists the files with those extensions (to pick a file, e.g. a compose file). A name with no dot is its own
  // extension, so `files=dockerfile,containerfile` lists `Dockerfile`, `Containerfile` and `web.Dockerfile`.
  const exts = (url.searchParams.get('files') ?? '').split(',').map((x) => x.trim().toLowerCase().replace(/^\./, '')).filter((x) => /^[a-z0-9]{1,16}$/.test(x));
  let dirs: string[] = [], files: string[] = [];
  try {
    const all = readdirSync(p, { withFileTypes: true });
    dirs = all.filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules').map((d) => d.name).sort((a, b) => a.localeCompare(b));
    if (exts.length) files = all.filter((d) => d.isFile() && exts.includes(d.name.split('.').pop()!.toLowerCase())).map((d) => d.name).sort((a, b) => a.localeCompare(b));
  } catch { /* unreadable */ }
  return { path: p, parent: p === '/' ? null : dirname(p), dirs: dirs.map((n) => ({ name: n, path: join(p, n) })), files: files.map((n) => ({ name: n, path: join(p, n) })) };
});
