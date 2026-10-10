import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { agents, resolved } from './db.js';
import { objectsStore } from './objects/store.js';
import { containerName } from './objects/docker.js';
import type { DockerConfig, ServerConfig } from './objects/model.js';

/**
 * Terminals: real shells (a pseudo-terminal each) that the interface shows in its bottom panel. They are the user's own shell on their own
 * machine, so they are as powerful as that: the server only serves them to pages and programs of this machine (see `isLocalRequest`) and
 * `HIVE_AM_TERMINALS=0` turns them off. A terminal lives in the server, not in the page: reloading the page, or opening another one,
 * shows the same terminals with what they printed last. They end when the server stops.
 */
const MAX_TERMINALS = 12, BUFFER = 256 * 1024;
export const terminalsEnabled = () => process.env.HIVE_AM_TERMINALS !== '0';

type Pty = import('@homebridge/node-pty-prebuilt-multiarch').IPty;
let lib: typeof import('@homebridge/node-pty-prebuilt-multiarch') | null | undefined;
async function ptyLib() {
  if (lib !== undefined) return lib;
  try { lib = await import('@homebridge/node-pty-prebuilt-multiarch'); } catch { lib = null; }
  return lib;
}

export class TerminalError extends Error {}

interface Term {
  id: string; title: string; cwd: string; command: string; created: number; cols: number; rows: number;
  pty: Pty; chunks: string[]; size: number; clients: Set<WebSocket>; exit?: { code: number; signal?: number };
}
const terms = new Map<string, Term>();

export const listTerminals = () => [...terms.values()].map((t) => ({ id: t.id, title: t.title, cwd: t.cwd, command: t.command, created: t.created, alive: !t.exit, exitCode: t.exit?.code ?? null }));

/** Only a page or a program of this machine may reach a terminal: the host must be a loopback name (a page that reached us through another name — DNS rebinding — is refused) and a browser's origin must be one too. */
export function isLocalRequest(req: IncomingMessage): boolean {
  const loop = (h: string) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(h.replace(/:\d+$/, '').toLowerCase());
  const host = String(req.headers.host ?? '');
  if (!loop(host)) return false;
  const origin = req.headers.origin;
  if (origin) { try { if (!loop(new URL(origin).hostname === '::1' ? '[::1]' : new URL(origin).hostname)) return false; } catch { return false; } }
  return true;
}

export interface TerminalSpec { cwd?: unknown; title?: unknown; objectId?: unknown; agentId?: unknown }

/** Where and what to run: the user's shell in a folder, or a shell inside a container of an object. */
function plan(spec: TerminalSpec): { cwd: string; file: string; args: string[]; title: string } {
  const shell = process.env.SHELL && existsSync(process.env.SHELL) ? process.env.SHELL : '/bin/bash';
  let cwd = typeof spec.cwd === 'string' && spec.cwd ? spec.cwd : homedir(), title = typeof spec.title === 'string' ? spec.title.slice(0, 60) : '';
  let file = shell, args: string[] = shell.endsWith('bash') || shell.endsWith('zsh') ? ['-i'] : [];
  if (typeof spec.agentId === 'string') {
    const a = agents.get(spec.agentId); if (!a) throw new TerminalError('That agent no longer exists');
    cwd = resolved(a).cwd; title ||= a.name;
  }
  if (typeof spec.objectId === 'string') {
    const o = objectsStore.get(spec.objectId); if (!o) throw new TerminalError('That object no longer exists');
    title ||= o.name;
    if (o.kind === 'server') cwd = (o.config as ServerConfig).cwd;
    else if (o.kind === 'docker') {
      const c = o.config as DockerConfig;
      if (c.mode === 'compose') throw new TerminalError('A compose project has several containers: use its logs, or open a terminal on one of them as an "existing container" object.');
      // A shell inside the container: bash when it has one, sh otherwise.
      file = 'docker'; args = ['exec', '-it', c.mode === 'existing' ? c.container! : containerName(o.id), 'sh', '-c', 'command -v bash >/dev/null 2>&1 && exec bash || exec sh'];
    } else throw new TerminalError('This kind of object has no terminal.');
  }
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new TerminalError(`The folder ${cwd} does not exist`);
  return { cwd, file, args, title: title || cwd.split('/').filter(Boolean).pop() || '/' };
}

export async function createTerminal(spec: TerminalSpec) {
  if (!terminalsEnabled()) throw new TerminalError('Terminals are turned off (HIVE_AM_TERMINALS=0).');
  const p = await ptyLib();
  if (!p) throw new TerminalError('Terminals need the node-pty library, which could not be loaded on this system. Reinstall hive-am without --omit=optional, or install @homebridge/node-pty-prebuilt-multiarch.');
  if (terms.size >= MAX_TERMINALS) throw new TerminalError(`There are already ${MAX_TERMINALS} terminals: close one first.`);
  const { cwd, file, args, title } = plan(spec);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== undefined && !k.startsWith('HIVE_AM_') && k !== 'HIVE_AGENT_ID' && k !== 'HIVE_CAPS')) as Record<string, string>;
  const pty = p.spawn(file, args, { name: 'xterm-256color', cols: 100, rows: 28, cwd, env: { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } });
  const t: Term = { id: randomUUID(), title, cwd, command: [file, ...args].join(' '), created: Date.now(), cols: 100, rows: 28, pty, chunks: [], size: 0, clients: new Set() };
  terms.set(t.id, t);
  pty.onData((d) => {
    t.chunks.push(d); t.size += d.length;
    while (t.size > BUFFER && t.chunks.length > 1) t.size -= t.chunks.shift()!.length;      // the oldest output goes first
    const msg = JSON.stringify({ t: 'out', d });
    for (const c of t.clients) if (c.readyState === c.OPEN) c.send(msg);
  });
  pty.onExit(({ exitCode, signal }) => {
    t.exit = { code: exitCode, signal };
    const msg = JSON.stringify({ t: 'exit', code: exitCode });
    for (const c of t.clients) if (c.readyState === c.OPEN) c.send(msg);
  });
  return { id: t.id, title: t.title, cwd: t.cwd };
}

export function closeTerminal(id: string): boolean {
  const t = terms.get(id); if (!t) return false;
  try { if (!t.exit) t.pty.kill(); } catch { /* already gone */ }
  for (const c of t.clients) { try { c.close(); } catch { /* closed */ } }
  terms.delete(id);
  return true;
}

/** A page attaches to a terminal: it gets what the terminal printed so far, then everything live. Input and resizes come back as JSON. */
export function attachTerminal(ws: WebSocket, id: string): void {
  const t = terms.get(id);
  if (!t) { ws.send(JSON.stringify({ t: 'gone' })); ws.close(); return; }
  t.clients.add(ws);
  ws.send(JSON.stringify({ t: 'init', title: t.title, cols: t.cols, rows: t.rows, alive: !t.exit }));
  if (t.chunks.length) ws.send(JSON.stringify({ t: 'out', d: t.chunks.join('') }));
  if (t.exit) ws.send(JSON.stringify({ t: 'exit', code: t.exit.code }));
  ws.on('message', (raw) => {
    let m: any; try { m = JSON.parse(String(raw)); } catch { return; }
    if (t.exit) return;
    if (m.t === 'in' && typeof m.d === 'string' && m.d.length < 100_000) t.pty.write(m.d);
    else if (m.t === 'resize') {
      const cols = Math.max(2, Math.min(500, Math.floor(Number(m.cols)))), rows = Math.max(2, Math.min(200, Math.floor(Number(m.rows))));
      if (Number.isFinite(cols) && Number.isFinite(rows) && (cols !== t.cols || rows !== t.rows)) { t.cols = cols; t.rows = rows; try { t.pty.resize(cols, rows); } catch { /* ended */ } }
    }
  });
  ws.on('close', () => t.clients.delete(ws));
}

/** When hive-am stops, so do the shells it started. */
export function closeAllTerminals() { for (const id of [...terms.keys()]) closeTerminal(id); }
process.on('exit', closeAllTerminals);
