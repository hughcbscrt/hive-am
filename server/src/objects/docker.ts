import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { ObjectError, splitArgs, type DockerConfig, type ObjectState } from './model.js';

/**
 * A Docker object drives the `docker` command (never a shell, every value is one argument): start, stop, restart, status and logs of a
 * container hive-am created, of a compose project, or of a container that already existed. Anything hive-am did not create is only
 * ever started, stopped or read, never removed.
 */
const TIMEOUT = 60_000;
const DOCKER_ENV = { ...process.env, DOCKER_CLI_HINTS: 'false' };

interface Out { out: string; err: string; code: number }
function dk(args: string[], o: { cwd?: string; timeout?: number } = {}): Promise<Out> {
  return new Promise((resolve, reject) => {
    execFile('docker', args, { cwd: o.cwd, timeout: o.timeout ?? TIMEOUT, maxBuffer: 16 * 1024 * 1024, env: DOCKER_ENV, encoding: 'utf8' }, (e: any, stdout, stderr) => {
      if (e && e.code === 'ENOENT') return reject(new ObjectError('Docker is not installed or not in the PATH'));
      if (e && e.killed) return reject(new ObjectError(`docker ${args[0]} took too long`));
      resolve({ out: String(stdout ?? ''), err: String(stderr ?? ''), code: typeof e?.code === 'number' ? e.code : 0 });
    });
  });
}
const fail = (r: Out, what: string) => new ObjectError(`${what}: ${(r.err || r.out).trim().split('\n').slice(-3).join(' ').slice(0, 400) || `docker exited with ${r.code}`}`);

/** What makes a container different from another one when hive-am creates it: if it changes, the container is created again on the next start. */
const CFG_FIELDS = ['image', 'ports', 'volumes', 'env', 'restart', 'command', 'memory', 'cpus', 'network', 'logMaxMb'] as const;
export const cfgHash = (c: DockerConfig) => createHash('sha1').update(JSON.stringify(CFG_FIELDS.map((k) => c[k] ?? null))).digest('hex').slice(0, 12);
const stopArgs = (c: DockerConfig) => (c.stopTimeoutSec ? ['-t', String(c.stopTimeoutSec)] : []);
/** The hash a container was created with (empty when it does not exist). */
async function createdWith(name: string): Promise<string | null> {
  const r = await dk(['inspect', '-f', '{{index .Config.Labels "hive-am.cfg"}}', name]);
  return r.code === 0 ? r.out.trim() : null;
}

/** The name hive-am gives to a container it creates. */
export const containerName = (id: string) => `hive-am-${id.slice(0, 8)}`;
const nameOf = (id: string, c: DockerConfig) => (c.mode === 'existing' ? c.container! : containerName(id));

/** `docker compose -f file -p project` + what to do. The folder of the file is the working folder, as compose expects. */
const composeArgs = (c: DockerConfig, rest: string[]) => ['compose', '-f', c.file!, ...(c.project ? ['-p', c.project] : []), ...rest];
function checkCompose(c: DockerConfig) { if (!existsSync(c.file!)) throw new ObjectError(`The compose file ${c.file} does not exist`); }

export async function dockerState(id: string, c: DockerConfig): Promise<ObjectState> {
  try {
    if (c.mode === 'compose') {
      if (!existsSync(c.file!)) return { status: 'error', detail: 'the compose file is missing' };
      const r = await dk(composeArgs(c, ['ps', '--all', '--format', 'json', ...(c.services ?? [])]), { cwd: dirname(c.file!) });
      if (r.code !== 0) return { status: 'unknown', detail: r.err.trim().split('\n').pop()?.slice(0, 160) };
      const items = parseJsonLines(r.out);
      if (!items.length) return { status: 'stopped' };
      const states = items.map((x) => String(x.State ?? '').toLowerCase());
      const running = states.filter((s) => s === 'running').length;
      if (running === items.length) return items.some((x) => /starting|unhealthy/i.test(String(x.Health ?? x.Status ?? ''))) ? { status: 'starting', detail: 'health check pending' } : { status: 'running', detail: `${running} service${running === 1 ? '' : 's'}` };
      if (running > 0) return { status: 'starting', detail: `${running} of ${items.length} running` };
      return states.some((s) => s === 'exited') && items.some((x) => Number(x.ExitCode) > 0) ? { status: 'error', detail: 'a service exited with an error' } : { status: 'stopped' };
    }
    const r = await dk(['inspect', '-f', '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.State.ExitCode}}|{{.State.StartedAt}}', nameOf(id, c)]);
    if (r.code !== 0) return c.mode === 'existing' ? { status: 'unknown', detail: 'container not found' } : { status: 'stopped' };
    const [state, health, exit, started] = r.out.trim().split('|');
    const since = Date.parse(started) || undefined;
    if (state === 'running') return health === 'unhealthy' ? { status: 'error', detail: 'unhealthy', since } : health === 'starting' ? { status: 'starting', detail: 'health check pending', since } : { status: 'running', since };
    if (state === 'restarting') return { status: 'starting', detail: 'restarting', since };
    if (state === 'exited' && Number(exit) !== 0) return { status: 'error', detail: `exited with code ${exit}` };
    return { status: 'stopped' };
  } catch (e) { return { status: 'unknown', detail: e instanceof Error ? e.message : 'docker failed' }; }
}

/** `docker compose ps --format json` prints one JSON per line (or, in older versions, one array). */
function parseJsonLines(out: string): any[] {
  const t = out.trim(); if (!t) return [];
  if (t.startsWith('[')) { try { return JSON.parse(t); } catch { return []; } }
  return t.split('\n').flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

export async function startDocker(id: string, c: DockerConfig): Promise<void> {
  if (c.mode === 'compose') {
    checkCompose(c);
    const r = await dk(composeArgs(c, ['up', '-d', ...(c.services ?? [])]), { cwd: dirname(c.file!), timeout: 300_000 });
    if (r.code !== 0) throw fail(r, 'compose up failed');
    return;
  }
  const name = nameOf(id, c);
  let exists = (await dk(['inspect', '-f', '{{.Id}}', name])).code === 0;
  // A container hive-am created with other settings than the ones now configured is created again (what is inside it is lost, as with any recreate).
  if (exists && c.mode === 'container') { const w = await createdWith(name); if (w && w !== cfgHash(c)) { await dk(['rm', '-f', name]); exists = false; } }
  if (exists) { const r = await dk(['start', name]); if (r.code !== 0) throw fail(r, 'could not start it'); return; }
  if (c.mode === 'existing') throw new ObjectError(`There is no container named ${name}`);
  const args = ['run', '-d', '--name', name, '--label', `hive-am.object=${id}`, '--label', `hive-am.cfg=${cfgHash(c)}`];
  if (c.memory) args.push('--memory', c.memory);
  if (c.cpus) args.push('--cpus', String(c.cpus));
  if (c.network) args.push('--network', c.network);
  if (c.logMaxMb) args.push('--log-opt', `max-size=${Math.max(1, Math.round(c.logMaxMb * 1024))}k`, '--log-opt', 'max-file=3');
  if (c.stopTimeoutSec) args.push('--stop-timeout', String(c.stopTimeoutSec));
  if (c.restart && c.restart !== 'no') args.push('--restart', c.restart);
  for (const p of c.ports ?? []) args.push('-p', p);
  for (const v of c.volumes ?? []) args.push('-v', v);
  for (const [k, v] of Object.entries(c.env ?? {})) args.push('-e', `${k}=${v}`);
  args.push(c.image!, ...(c.command ? splitArgs(c.command) : []));
  const r = await dk(args, { timeout: 300_000 });                                  // a first run may pull the image
  if (r.code !== 0) throw fail(r, 'could not create it');
}

export async function stopDocker(id: string, c: DockerConfig): Promise<void> {
  if (c.mode === 'compose') { checkCompose(c); const r = await dk(composeArgs(c, ['stop', ...stopArgs(c), ...(c.services ?? [])]), { cwd: dirname(c.file!), timeout: 300_000 }); if (r.code !== 0) throw fail(r, 'compose stop failed'); return; }
  const r = await dk(['stop', ...stopArgs(c), nameOf(id, c)], { timeout: 300_000 });
  if (r.code !== 0 && !/No such container/i.test(r.err)) throw fail(r, 'could not stop it');
}

export async function restartDocker(id: string, c: DockerConfig): Promise<void> {
  if (c.mode === 'compose') { checkCompose(c); const r = await dk(composeArgs(c, ['restart', ...stopArgs(c), ...(c.services ?? [])]), { cwd: dirname(c.file!), timeout: 300_000 }); if (r.code !== 0) throw fail(r, 'compose restart failed'); return; }
  const name = nameOf(id, c);
  if ((await dk(['inspect', '-f', '{{.Id}}', name])).code !== 0) return startDocker(id, c);
  if (c.mode === 'container') { const w = await createdWith(name); if (w && w !== cfgHash(c)) { await dk(['stop', ...stopArgs(c), name], { timeout: 300_000 }); return startDocker(id, c); } }   // changed settings: created again
  const r = await dk(['restart', ...stopArgs(c), name], { timeout: 300_000 }); if (r.code !== 0) throw fail(r, 'could not restart it');
}

/** A container hive-am created goes away with its object; a compose project is only stopped; an existing container is left alone. */
export async function removeDocker(id: string, c: DockerConfig): Promise<void> {
  if (c.mode === 'container') await dk(['rm', '-f', containerName(id)]).catch(() => undefined);
  else if (c.mode === 'compose' && existsSync(c.file!)) await dk(composeArgs(c, ['stop', ...(c.services ?? [])]), { cwd: dirname(c.file!) }).catch(() => undefined);
}

const STAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/;

/**
 * The latest output. `after` is the time (RFC 3339) of the last line already seen; without it the last `tail` lines come back.
 * Lines carry docker's own timestamp, which is what makes "only what is new" possible; it is cut out of the text shown.
 */
export async function dockerLogs(id: string, c: DockerConfig, o: { tail?: number; after?: string }): Promise<{ text: string; cursor: string }> {
  const base = c.mode === 'compose'
    ? composeArgs(c, ['logs', '--no-color', '--timestamps', ...(o.after ? ['--since', o.after] : ['--tail', String(Math.max(1, Math.min(o.tail ?? 300, 5000)))]), ...(c.services ?? [])])
    : ['logs', '--timestamps', ...(o.after ? ['--since', o.after] : ['--tail', String(Math.max(1, Math.min(o.tail ?? 300, 5000)))]), nameOf(id, c)];
  if (c.mode === 'compose') checkCompose(c);
  const r = await dk(base, { cwd: c.mode === 'compose' ? dirname(c.file!) : undefined, timeout: 20_000 });
  if (r.code !== 0 && !r.out && !r.err) return { text: '', cursor: o.after ?? '' };
  if (r.code !== 0 && /No such container/i.test(r.err)) return { text: '', cursor: o.after ?? '' };
  // docker keeps stdout and stderr apart: put them back in order by their timestamps.
  const lines = `${r.out}${r.err && r.code === 0 ? `\n${r.err}` : ''}`.split('\n').filter(Boolean)
    .map((l) => ({ l, t: STAMP.exec(l.slice(0, 120))?.[0] ?? '' }));
  lines.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  let last = o.after ?? '';
  const shown: string[] = [];
  for (const { l, t } of lines) {
    if (o.after && t && t <= o.after) continue;                                   // `--since` includes the second it names
    if (t && t > last) last = t;
    shown.push(t ? l.replace(`${t} `, '').replace(t, '') : l);
  }
  return { text: shown.join('\n'), cursor: last };
}
