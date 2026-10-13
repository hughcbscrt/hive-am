import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { noteServer, readSaved, rotateLog } from './runner.js';
import type { HealthConfig, ObjectRow, ObjectState, ServerConfig } from './model.js';

/**
 * What keeps a server object in good shape without anyone looking: it restarts it when it ends by itself (never, after a failure, or
 * always) with a longer wait each time and a limit, it asks a health check whether a running server is really working (and can restart it
 * when it is not), and it keeps its log from growing. Stopping it yourself is never undone: a stopped server stays stopped.
 */
const BASE_MS = () => Number(process.env.HIVE_AM_OBJECT_BACKOFF_MS) || 1000;
const WINDOW_MS = () => Number(process.env.HIVE_AM_OBJECT_RESTART_WINDOW_MS) || 600_000;
const MAX_WAIT_MS = 30_000;

interface Sup { restarts: number[]; pendingExit: number; nextAt: number; gaveUp: boolean; fails: number; lastCheck: number; detail: string; startedAt: number }
const all = new Map<string, Sup>();
const get = (id: string): Sup => { let s = all.get(id); if (!s) all.set(id, s = { restarts: [], pendingExit: 0, nextAt: 0, gaveUp: false, fails: 0, lastCheck: 0, detail: '', startedAt: 0 }); return s; };

/** A person started or stopped it: the automatic restarts begin again from nothing. */
export const resetSupervision = (id: string) => { all.delete(id); };
export const forgetSupervision = resetSupervision;

async function check(cfg: ServerConfig, h: HealthConfig): Promise<{ ok: boolean; detail: string }> {
  const timeout = (h.timeoutSec ?? 5) * 1000;
  try {
    if (h.kind === 'http') {
      const r = await fetch(h.target, { signal: AbortSignal.timeout(timeout), redirect: 'manual' });
      return r.status >= 200 && r.status < 400 ? { ok: true, detail: '' } : { ok: false, detail: `${h.target} answered ${r.status}` };
    }
    if (h.kind === 'tcp') {
      const [host, p] = h.target.includes(':') ? [h.target.split(':')[0], Number(h.target.split(':').pop())] : ['127.0.0.1', Number(h.target)];
      const up = await new Promise<boolean>((resolve) => { const s = connect({ host, port: p }, () => { s.destroy(); resolve(true); }); s.setTimeout(timeout, () => { s.destroy(); resolve(false); }); s.on('error', () => resolve(false)); });
      return up ? { ok: true, detail: '' } : { ok: false, detail: `nothing answers on ${h.target}` };
    }
    return await new Promise((resolve) => {
      const c = spawn('sh', ['-c', h.target], { cwd: cfg.cwd, env: { ...process.env, ...cfg.env }, stdio: 'ignore' });
      const t = setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* gone */ } resolve({ ok: false, detail: `the check took more than ${timeout / 1000} s` }); }, timeout);
      c.on('exit', (code) => { clearTimeout(t); resolve(code === 0 ? { ok: true, detail: '' } : { ok: false, detail: `the check exited with ${code}` }); });
      c.on('error', () => { clearTimeout(t); resolve({ ok: false, detail: 'the check could not run' }); });
    });
  } catch (e) { return { ok: false, detail: `${h.target}: ${(e as Error).name === 'TimeoutError' ? 'no answer in time' : (e as Error).message}` }; }
}

export interface Actions { start: () => Promise<void>; restart: () => Promise<void> }

/** Takes the state of a server (alive or not) and returns what it really is, doing what the configuration asks. */
export async function supervise(o: ObjectRow, cfg: ServerConfig, state: ObjectState, act: Actions): Promise<ObjectState> {
  rotateLog(o.id, cfg);
  const S = get(o.id), now = Date.now(), saved = readSaved(o.id);
  const max = cfg.maxRestarts ?? 5;
  S.restarts = S.restarts.filter((t) => now - t < WINDOW_MS());
  const budget = () => S.restarts.length < max;
  const wait = () => Math.min(MAX_WAIT_MS, BASE_MS() * 2 ** S.restarts.length);

  // Running: is it working?
  if ((state.status === 'running') && cfg.health) {
    if (S.startedAt !== saved?.startedAt) { S.startedAt = saved?.startedAt ?? 0; S.fails = 0; S.lastCheck = 0; }
    if (now - S.lastCheck >= (cfg.health.intervalSec ?? 15) * 1000) {
      S.lastCheck = now;
      const r = await check(cfg, cfg.health);
      if (r.ok) { S.fails = 0; S.detail = ''; } else { S.fails++; S.detail = r.detail; }
    }
    if (S.fails >= (cfg.health.retries ?? 3)) {
      if (cfg.health.restartWhenUnhealthy && budget()) {
        S.restarts.push(now); S.fails = 0; S.lastCheck = now;
        noteServer(o.id, `unhealthy (${S.detail}): restarting (${S.restarts.length}/${max})`);
        await act.restart().catch(() => undefined);
        return { status: 'starting', detail: `was unhealthy: restarting (${S.restarts.length}/${max})` };
      }
      return { status: 'error', pid: state.pid, since: state.since, detail: `unhealthy: ${S.detail}${cfg.health.restartWhenUnhealthy ? ` (gave up after ${max} restarts)` : ''}` };
    }
    return state;
  }
  if (state.status === 'running' || state.status === 'starting') return state;

  // Not running. It ended by itself, and the person did not stop it?
  const policy = cfg.restart ?? 'no';
  const ended = saved && !saved.stopped && saved.exit;
  if (!ended || policy === 'no') return state;
  const failed = ended.code !== 0 || !!ended.signal;
  if (!(policy === 'always' || failed)) return state;
  if (S.gaveUp) return { ...state, detail: `${state.detail ?? 'ended'} · gave up after ${max} restarts` };
  if (S.pendingExit !== ended.at) { S.pendingExit = ended.at; S.nextAt = now + wait(); }
  if (!budget()) { S.gaveUp = true; noteServer(o.id, `gave up: it ended ${max} times in ${Math.round(WINDOW_MS() / 60000)} minutes`); return { ...state, detail: `${state.detail ?? 'ended'} · gave up after ${max} restarts` }; }
  if (now < S.nextAt) return { ...state, detail: `${state.detail ?? 'ended'} · restarting in ${Math.ceil((S.nextAt - now) / 1000)} s (${S.restarts.length + 1}/${max})` };
  S.restarts.push(now);
  noteServer(o.id, `ended by itself: restarting (${S.restarts.length}/${max})`);
  await act.start().catch((e) => noteServer(o.id, `could not restart: ${e instanceof Error ? e.message : e}`));
  return { status: 'starting', detail: `restarted (${S.restarts.length}/${max})` };
}
