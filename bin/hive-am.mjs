#!/usr/bin/env node
// hive-am launcher: starts the API server and the web UI from the published package.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const args = process.argv.slice(2);

const HELP = `hive-am ${pkg.version}
${pkg.description}

Usage:
  hive-am [start]        start the server (API + WebSocket, port 4400) and the web UI (port 4401)
  hive-am --version      print the version
  hive-am --help         show this help

Environment:
  HIVE_AM_HOME           data folder (default ~/.hive-am)
  HIVE_AM_WEB_PORT       port of the web UI (default 4401)

The API server always uses port 4400: the packaged UI is built to talk to it.
Requires Node >= ${pkg.engines?.node?.replace('>=', '') ?? '20'} and at least one of the CLIs installed and logged in: claude, opencode, kiro-cli.`;

if (args.includes('--help') || args.includes('-h')) { console.log(HELP); process.exit(0); }
if (args.includes('--version') || args.includes('-v')) { console.log(pkg.version); process.exit(0); }
if (args.length && args[0] !== 'start') { console.error(`Unknown command: ${args[0]}\n\n${HELP}`); process.exit(1); }

if (process.env.HIVE_AM_PORT && process.env.HIVE_AM_PORT !== '4400') {
  console.error('HIVE_AM_PORT is not supported by the packaged build: the UI is built to talk to the API on port 4400.');
  process.exit(1);
}

const webPort = process.env.HIVE_AM_WEB_PORT ?? '4401';
const next = join(dirname(createRequire(import.meta.url).resolve('next/package.json')), 'dist', 'bin', 'next');

const children = [
  spawn(process.execPath, [join(root, 'server', 'dist', 'index.js')], { cwd: join(root, 'server'), stdio: 'inherit' }),
  spawn(process.execPath, [next, 'start', '-p', webPort, '-H', '127.0.0.1'], { cwd: join(root, 'web'), stdio: 'inherit' }),
];

let closing = false;
const stop = (code = 0) => {
  if (closing) return;
  closing = true;
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500).unref();
};
for (const c of children) c.on('exit', (code) => { if (!closing) { console.error('hive-am: a process exited, stopping.'); stop(code ?? 1); } });
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
setTimeout(() => console.log(`\nhive-am is running → http://127.0.0.1:${webPort}  (API on 127.0.0.1:4400)`), 2500).unref();
