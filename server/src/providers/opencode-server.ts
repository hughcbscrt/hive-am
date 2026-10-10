import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../db.js';
import { createHash, randomBytes } from 'node:crypto';

/**
 * One long-lived `opencode serve` per agent. A private server per turn (`opencode run --standalone`) boots from zero every time and its
 * hive MCP server connects only after the model has already taken its first step, so the first `tools.hive.*` call always fails
 * ("Unknown tool") and costs a whole extra model step. A server that stays up has hive connected before the message arrives, and
 * the turn skips OpenCode's ~4 s boot too. The server reads the agent's config (permissions, MCP) once when it starts, so a change
 * in that config restarts it; it stops by itself after a while without turns.
 */
const IDLE_MS = 5 * 60_000;
/** Servers kept alive at once (each takes roughly 150 MB idle and 300 MB after a turn). The least recently used one is stopped to make room; `HIVE_AM_OPENCODE_SERVERS` changes it. */
const MAX_SERVERS = Math.max(1, Number(process.env.HIVE_AM_OPENCODE_SERVERS) || 2);
const START_TIMEOUT_MS = 20_000;
const MCP_WAIT_MS = 10_000;

interface Srv { busy: number; used: number; mcp: string[]; proc: ChildProcess; url: string; password: string; key: string; idle?: ReturnType<typeof setTimeout>; ready: Promise<void> }
const servers = new Map<string, Srv>();

export interface ServerAccess { url: string; password: string; /** Call when the turn ends: the idle countdown starts only then. */ release: () => void }

export function stopOpencodeServer(agentId: string): void {
  const s = servers.get(agentId);
  if (!s) return;
  servers.delete(agentId);
  savePids();
  if (s.idle) clearTimeout(s.idle);
  if (!s.proc.killed) s.proc.kill('SIGTERM');
}

const stopAll = () => { for (const id of [...servers.keys()]) stopOpencodeServer(id); };
process.on('exit', stopAll);
// A signal (Ctrl+C, a `tsx watch` restart, a service manager) ends the process without an 'exit' event, which would leave the servers orphaned.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(sig, () => { stopAll(); process.kill(process.pid, sig); });

// If hive-am dies without any chance to clean up (kill -9, a crash), its servers survive it. They are listed on disk and stopped at the next start.
const PIDFILE = join(DATA_DIR, 'opencode-servers.json');
const savePids = () => { try { writeFileSync(PIDFILE, JSON.stringify([...servers.values()].map((x) => x.proc.pid).filter(Boolean))); } catch { /* best effort */ } };
function reapOrphans(): void {
  if (!existsSync(PIDFILE)) return;
  try {
    for (const pid of JSON.parse(readFileSync(PIDFILE, 'utf8')) as number[]) {
      try {
        const cmd = execFileSync('ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        if (/opencode/.test(cmd) && /serve --hostname 127\.0\.0\.1/.test(cmd)) process.kill(pid, 'SIGTERM');   // only what is surely ours
      } catch { /* already gone */ }
    }
    writeFileSync(PIDFILE, '[]');
  } catch { /* unreadable list: nothing to do */ }
}
reapOrphans();

const auth = (password: string) => ({ authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` });

/** Waits until every MCP server the config asks for has finished connecting (connected or failed): no more "Unknown tool" at the first step. */
async function mcpSettled(s: Srv, signal: AbortSignal): Promise<void> {
  const until = Date.now() + MCP_WAIT_MS;
  while (Date.now() < until && !signal.aborted) {
    try {
      const r = await fetch(`${s.url}/api/mcp`, { headers: auth(s.password), signal: AbortSignal.timeout(2000) });
      if (r.ok) {
        const j: any = await r.json();
        const list: any[] = Array.isArray(j?.data) ? j.data : [];
        // Every server the config asks for must be listed (the list is empty until OpenCode starts connecting) and done connecting.
        const done = (name: string) => { const m = list.find((x) => x?.name === name); return !!m?.status?.status && m.status.status !== 'connecting' && m.status.status !== 'pending'; };
        if (s.mcp.every(done)) return;
      }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
}

function launch(agentId: string, cwd: string, config: unknown, key: string, signal: AbortSignal): Srv {
  const password = randomBytes(18).toString('base64url');
  const proc = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
    cwd, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PWD: cwd, OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_SERVER_PASSWORD: password },
  });
  const srv: Srv = { busy: 0, used: Date.now(), mcp: Object.keys((config as any)?.mcp ?? {}), proc, url: '', password, key, ready: Promise.resolve() };
  srv.ready = new Promise<void>((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error('opencode serve did not start in time')), START_TIMEOUT_MS);
    const onData = (d: Buffer) => {
      out = (out + d).slice(-2000);
      const m = /listening on (http:\/\/\S+)/i.exec(out);
      if (m && !srv.url) { srv.url = m[1].replace(/\/$/, ''); clearTimeout(timer); resolve(); }
    };
    proc.stdout!.on('data', onData); proc.stderr!.on('data', onData);   // keep draining so the pipes never fill up
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    proc.on('exit', (c) => { clearTimeout(timer); if (!srv.url) reject(new Error(`opencode serve exited with code ${c}`)); if (servers.get(agentId) === srv) servers.delete(agentId); });
  }).then(() => mcpSettled(srv, signal));
  servers.set(agentId, srv);
  savePids();
  return srv;
}

/** The agent's server, started (or restarted when its config changed) and ready for a turn. Throws if it cannot start: callers fall back to a private server. */
export async function opencodeServer(agentId: string, cwd: string, config: unknown, signal: AbortSignal): Promise<ServerAccess> {
  const key = createHash('sha1').update(cwd + JSON.stringify(config)).digest('hex');
  let s = servers.get(agentId);
  if (s && (s.key !== key || s.proc.exitCode !== null)) { stopOpencodeServer(agentId); s = undefined; }
  if (!s) {
    // Room for one more: stop the least recently used server that is not in the middle of a turn.
    while (servers.size >= MAX_SERVERS) {
      const idle = [...servers.entries()].filter(([, x]) => x.busy === 0).sort((a, b) => a[1].used - b[1].used)[0];
      if (!idle) break;
      stopOpencodeServer(idle[0]);
    }
    s = launch(agentId, cwd, config, key, signal);
  }
  s.busy++; s.used = Date.now();
  if (s.idle) { clearTimeout(s.idle); s.idle = undefined; }
  const srv = s;
  let released = false;
  const release = () => {
    if (released) return;
    released = true; srv.busy = Math.max(0, srv.busy - 1); srv.used = Date.now();
    // After a burst (more agents running at once than the limit), the extra servers go as soon as their turn ends instead of lingering.
    while (servers.size > MAX_SERVERS) {
      const lru = [...servers.entries()].filter(([, x]) => x.busy === 0).sort((x, y) => x[1].used - y[1].used)[0];
      if (!lru) break;
      stopOpencodeServer(lru[0]);
    }
    if (srv.busy === 0 && servers.get(agentId) === srv) {
      srv.idle = setTimeout(() => { if (servers.get(agentId) === srv && srv.busy === 0) stopOpencodeServer(agentId); }, IDLE_MS);
      srv.idle.unref?.();
    }
  };
  try { await s.ready; }
  catch (e) { release(); if (servers.get(agentId) === s) stopOpencodeServer(agentId); throw e; }
  return { url: s.url, password: s.password, release };
}
