import { createHash } from 'node:crypto';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute } from 'node:path';
import { inspectMachine, maskVar, NO_DAEMON } from './docker-info.js';
import { execCapture } from './exec.js';
import { IMAGE, ObjectError, parseDocker, splitArgs, type DockerConfig, type ObjectState } from './model.js';

/**
 * A Docker object drives the `docker` command (never a shell, every value is one argument): start, stop, restart, status and logs of a
 * container hive-am created, of a compose project, or of a container that already existed. Anything hive-am did not create is only
 * ever started, stopped or read, never removed.
 */
const TIMEOUT = 60_000;
const DOCKER_ENV = { ...process.env, DOCKER_CLI_HINTS: 'false' };

interface Out { out: string; err: string; code: number }
async function dk(args: string[], o: { cwd?: string; timeout?: number } = {}): Promise<Out> {
  const r = await execCapture('docker', args, { cwd: o.cwd, timeout: o.timeout ?? TIMEOUT, maxBuffer: 16 * 1024 * 1024, env: DOCKER_ENV });
  if (r.missing) throw new ObjectError('Docker is not installed or not in the PATH');
  if (r.timedOut) throw new ObjectError(`docker ${args[0]} took too long`);
  return r;
}
const fail = (r: Out, what: string) => new ObjectError(`${what}: ${(r.err || r.out).trim().split('\n').slice(-3).join(' ').slice(0, 400) || `docker exited with ${r.code}`}`);

/** What makes a container different from another one when hive-am creates it: if it changes, the container is created again on the next start. */
const CFG_FIELDS = ['image', 'ports', 'volumes', 'env', 'restart', 'command', 'memory', 'cpus', 'network', 'logMaxMb'] as const;
/**
 * The options of `docker run` added later. They count only when set, after the others: the hash of a configuration without them is the same
 * as before they existed, so updating hive-am does not create every container again. The additional networks are not here: they are
 * connected and disconnected in place.
 */
const CFG_LATER = ['labels', 'user', 'workdir', 'entrypoint', 'hostname'] as const;
const RECREATES = [...CFG_FIELDS, ...CFG_LATER];
export const cfgHash = (c: DockerConfig) => {
  const base: unknown[] = CFG_FIELDS.map((k) => c[k] ?? null);
  const later = CFG_LATER.filter((k) => c[k] !== undefined).map((k) => [k, c[k]]);
  return createHash('sha1').update(JSON.stringify(later.length ? [...base, ...later] : base)).digest('hex').slice(0, 12);
};
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
const SERVICE = /^[\w][\w.-]{0,80}$/;
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
  if (exists && c.mode === 'container') await reconcileNetworks(name, c);
  if (exists) { const r = await dk(['start', name]); if (r.code !== 0) throw fail(r, 'could not start it'); return; }
  if (c.mode === 'existing') throw new ObjectError(`There is no container named ${name}`);
  await createContainer(id, c, true);
}

/**
 * The `docker run` of a container hive-am creates, every value one argument. `hive-am.networks=1` says that hive-am keeps its additional
 * networks as configured: one connected by hand is disconnected on the next start (a container created before that label existed only
 * loses one when it is taken out of the settings and applied).
 */
export function runArgs(id: string, c: DockerConfig): string[] {
  const args = ['run', '-d', '--name', containerName(id), '--label', `hive-am.object=${id}`, '--label', `hive-am.cfg=${cfgHash(c)}`];
  if (c.memory) args.push('--memory', c.memory);
  if (c.cpus) args.push('--cpus', String(c.cpus));
  if (c.network) args.push('--network', c.network);
  // A container always gets a log limit (10 MB x 3 unless set): docker's default is no limit, and a chatty container fills the disk.
  args.push('--log-opt', `max-size=${Math.max(1, Math.round((c.logMaxMb ?? 10) * 1024))}k`, '--log-opt', 'max-file=3');
  if (c.stopTimeoutSec) args.push('--stop-timeout', String(c.stopTimeoutSec));
  if (c.restart && c.restart !== 'no') args.push('--restart', c.restart);
  for (const p of c.ports ?? []) args.push('-p', p);
  for (const v of c.volumes ?? []) args.push('-v', v);
  for (const [k, v] of Object.entries(c.env ?? {})) args.push('-e', `${k}=${v}`);
  args.push('--label', 'hive-am.networks=1');
  for (const [k, v] of Object.entries(c.labels ?? {})) args.push('--label', `${k}=${v}`);
  if (c.user) args.push('--user', c.user);
  if (c.workdir) args.push('--workdir', c.workdir);
  if (c.entrypoint) args.push('--entrypoint', c.entrypoint);
  if (c.hostname) args.push('--hostname', c.hostname);
  args.push(c.image!, ...(c.command ? splitArgs(c.command) : []));
  return args;
}

/**
 * Creates the container (and starts it with `start`). With additional networks it is created first and connected to them before it
 * starts, so its program finds them from the beginning; without them it is the same single `docker run -d` as always.
 */
async function createContainer(id: string, c: DockerConfig, start: boolean): Promise<void> {
  const args = runArgs(id, c), name = containerName(id);
  if (start && !c.extraNetworks?.length) {
    const r = await dk(args, { timeout: 300_000 });                                // a first run may pull the image
    if (r.code !== 0) throw fail(r, 'could not create it');
    return;
  }
  const r = await dk(['create', ...args.slice(2)], { timeout: 300_000 });
  if (r.code !== 0) throw fail(r, 'could not create it');
  await reconcileNetworks(name, c);
  if (start) { const s = await dk(['start', name]); if (s.code !== 0) throw fail(s, 'could not start it'); }
}

/** The networks a container is on now, the one it was created on (`--network`, never changed in place) and whether hive-am keeps the rest. */
async function networksOf(name: string): Promise<{ main: string; now: string[]; kept: boolean } | null> {
  const r = await dk(['inspect', '-f', '{{.HostConfig.NetworkMode}}|{{index .Config.Labels "hive-am.networks"}}|{{json .NetworkSettings.Networks}}', name]);
  if (r.code !== 0) return null;
  const [mode, kept, ...rest] = r.out.trim().split('|');
  let now: string[] = [];
  try { now = Object.keys(JSON.parse(rest.join('|')) ?? {}); } catch { /* none */ }
  return { main: mode === 'default' ? 'bridge' : mode, now, kept: kept === '1' };
}

/** Which additional networks to connect and disconnect so the container matches `c`; `drop` are the ones just taken out of the settings. */
function networkChanges(n: { main: string; now: string[]; kept: boolean }, c: DockerConfig, drop: string[] = []) {
  const want = new Set(c.extraNetworks ?? []);
  return {
    connect: [...want].filter((x) => x !== n.main && !n.now.includes(x)),
    // The main network is never disconnected here (changing it creates the container again); another one only if hive-am keeps them, or just dropped.
    disconnect: n.now.filter((x) => x !== n.main && !want.has(x) && (n.kept || drop.includes(x))),
  };
}

/** Connects and disconnects the additional networks in place (`docker network connect / disconnect`: it works on a stopped container too). */
export async function reconcileNetworks(name: string, c: DockerConfig, drop: string[] = []): Promise<{ connected: string[]; disconnected: string[] }> {
  const n = await networksOf(name);
  if (!n) throw new ObjectError(`There is no container named ${name}`);
  const { connect, disconnect } = networkChanges(n, c, drop);
  for (const x of connect) { const r = await dk(['network', 'connect', x, name]); if (r.code !== 0) throw fail(r, `could not connect it to ${x}`); }
  for (const x of disconnect) { const r = await dk(['network', 'disconnect', x, name]); if (r.code !== 0 && !/is not connected/i.test(r.err)) throw fail(r, `could not disconnect it from ${x}`); }
  return { connected: connect, disconnected: disconnect };
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
  if (c.mode === 'container') await reconcileNetworks(name, c);
  const r = await dk(['restart', ...stopArgs(c), name], { timeout: 300_000 }); if (r.code !== 0) throw fail(r, 'could not restart it');
}

export type DockerAction = 'start' | 'stop' | 'restart' | 'recreate' | 'rebuild';

/** One service of a compose project, alone: start (creating it if needed), stop, restart, create it again, or build it again and create it. */
export async function composeServiceAction(c: DockerConfig, service: string, action: DockerAction): Promise<void> {
  if (c.mode !== 'compose') throw new ObjectError('Only a compose project has services');
  if (!SERVICE.test(service)) throw new ObjectError('That is not a service name');
  checkCompose(c);
  const rest = action === 'start' ? ['up', '-d', service]
    : action === 'recreate' ? ['up', '-d', '--force-recreate', service]
    : action === 'rebuild' ? ['up', '-d', '--build', service]
    : [action, ...stopArgs(c), service];
  const r = await dk(composeArgs(c, rest), { cwd: dirname(c.file!), timeout: action === 'rebuild' ? 900_000 : 300_000 });
  if (r.code !== 0) throw fail(r, `compose ${action} failed`);
}

/** The whole object: create its container(s) again (a compose project with --force-recreate; a container hive-am made is removed and run again), or build them again first. */
export async function recreateDocker(id: string, c: DockerConfig, build = false): Promise<void> {
  if (c.mode === 'compose') {
    checkCompose(c);
    const r = await dk(composeArgs(c, ['up', '-d', ...(build ? ['--build'] : ['--force-recreate']), ...(c.services ?? [])]), { cwd: dirname(c.file!), timeout: build ? 900_000 : 300_000 });
    if (r.code !== 0) throw fail(r, `compose ${build ? 'rebuild' : 'recreate'} failed`);
    return;
  }
  if (build) throw new ObjectError('Only a compose project builds images');
  if (c.mode === 'existing') throw new ObjectError('A container that already existed is never removed: it cannot be created again from here');
  await dk(['rm', '-f', nameOf(id, c)], { timeout: 120_000 });
  await startDocker(id, c);
}

/** The id of the container of one service of a compose project, or '' when it has none. */
async function serviceContainer(c: DockerConfig, service: string): Promise<{ cid: string; r: Out }> {
  const r = await dk(composeArgs(c, ['ps', '-a', '-q', service]), { cwd: dirname(c.file!) });
  return { cid: r.code === 0 ? r.out.trim().split('\n')[0] : '', r };
}

/** The id of the container behind an object (or behind one service of a compose project), or an error when there is none. */
export async function containerOf(id: string, c: DockerConfig, service?: string): Promise<string> {
  if (c.mode !== 'compose') return nameOf(id, c);
  if (!service || !SERVICE.test(service)) throw new ObjectError('Say which service');
  checkCompose(c);
  const { cid } = await serviceContainer(c, service);
  if (!cid) throw new ObjectError(`The service ${service} has no container: start it first`);
  return cid;
}

/** What `docker inspect` says about a container, cut down to what is read: command, variables, ports, mounts, networks, health. */
export interface Inspected {
  id: string; name: string; image: string; status: string; created: string; started: string; restartPolicy: string; restarts: number;
  command: string; entrypoint: string; workdir: string; user: string;
  env: { name: string; value: string }[];
  ports: { container: string; host: string }[];
  mounts: { type: string; source: string; destination: string; rw: boolean }[];
  networks: { name: string; ip: string; gateway: string; aliases: string[] }[];
  health?: { status: string; log: { at: string; exit: number; output: string }[] };
  labels: Record<string, string>;
}
/** What hive-am has configured for it (for a compose service, what `docker compose config` says; `error` when the file could not be read). */
export interface Configured {
  name: string; image?: string; ports: string[]; volumes: string[]; networks: string[]; env: { name: string; value: string }[];
  restart?: string; command?: string; memory?: string; cpus?: number; logMaxMb?: number; stopTimeoutSec?: number; error?: string;
  user?: string; workdir?: string; entrypoint?: string; hostname?: string; labels?: Record<string, string>;
}
/**
 * Inspect always says what is configured. `exists: false` when Docker has no container for it: `not-created` (hive-am creates it on the
 * first start), `not-found` (an existing container that is not there), `no-service` (a compose service never started), `no-docker`.
 * `cfgStale`: the settings changed since hive-am created the container, so it is created again on the next start.
 */
export type InspectResult =
  | ({ exists: true; cfgStale: boolean; configured: Configured } & Inspected)
  | { exists: false; reason: 'not-created' | 'not-found' | 'no-service' | 'no-docker'; error?: string; configured: Configured };

const asEnv = (e: Record<string, string | null | undefined>) => Object.entries(e).map(([name, value]) => ({ name, value: value ?? '' }));

/** One service of `docker compose config --format json` in the same terms as a container hive-am creates. */
function composeConfigured(service: string, s: any): Configured {
  const lim = s.deploy?.resources?.limits ?? {};
  const mem = s.mem_limit ?? lim.memory;
  return {
    name: service, image: s.image ? String(s.image) : undefined,
    ports: ((s.ports ?? []) as any[]).map((p) => `${p.host_ip ? `${p.host_ip}:` : ''}${p.published ? `${p.published}:` : ''}${p.target}${p.protocol && p.protocol !== 'tcp' ? `/${p.protocol}` : ''}`),
    volumes: ((s.volumes ?? []) as any[]).map((v) => `${v.source ? `${v.source}:` : ''}${v.target}${v.read_only ? ':ro' : ''}`),
    networks: Object.keys(s.networks ?? {}),
    env: asEnv(Array.isArray(s.environment) ? Object.fromEntries((s.environment as string[]).map((e) => { const i = e.indexOf('='); return i < 0 ? [e, ''] : [e.slice(0, i), e.slice(i + 1)]; })) : s.environment ?? {}),
    restart: s.restart ? String(s.restart) : undefined,
    command: Array.isArray(s.command) ? s.command.join(' ') : s.command ? String(s.command) : undefined,
    memory: mem === undefined || mem === null ? undefined : /^\d+$/.test(String(mem)) ? `${Math.round(Number(mem) / 1048576)}m` : String(mem),
    cpus: (s.cpus ?? lim.cpus) ? Number(s.cpus ?? lim.cpus) : undefined,
  };
}

async function configuredOf(id: string, c: DockerConfig, service?: string): Promise<Configured> {
  if (c.mode === 'existing') return { name: c.container!, ports: [], volumes: [], networks: [], env: [] };
  if (c.mode === 'container') {
    return {
      name: containerName(id), image: c.image, ports: c.ports ?? [], volumes: c.volumes ?? [], networks: [...(c.network ? [c.network] : []), ...(c.extraNetworks ?? [])], env: asEnv(c.env ?? {}),
      restart: c.restart, command: c.command, memory: c.memory, cpus: c.cpus, logMaxMb: c.logMaxMb, stopTimeoutSec: c.stopTimeoutSec,
      user: c.user, workdir: c.workdir, entrypoint: c.entrypoint, hostname: c.hostname, labels: c.labels,
    };
  }
  const only: Configured = { name: service!, ports: [], volumes: [], networks: [], env: [] };
  try {
    const r = await dk(composeArgs(c, ['config', '--format', 'json']), { cwd: dirname(c.file!), timeout: 20_000 });
    if (r.code !== 0) return { ...only, error: fail(r, 'compose config failed').message };
    const s = JSON.parse(r.out).services?.[service!];
    return s ? composeConfigured(service!, s) : { ...only, error: `The compose file has no service ${service}` };
  } catch (e) { return { ...only, error: e instanceof Error ? e.message : 'compose config failed' }; }
}

export async function inspectDocker(id: string, c: DockerConfig, service?: string): Promise<InspectResult> {
  if (c.mode === 'compose') { if (!service || !SERVICE.test(service)) throw new ObjectError('Say which service'); checkCompose(c); }
  const configured = await configuredOf(id, c, service);
  try {
    let ref = nameOf(id, c);
    if (c.mode === 'compose') {
      const { cid, r } = await serviceContainer(c, service!);
      if (r.code !== 0) { if (NO_DAEMON.test(r.err)) return { exists: false, reason: 'no-docker', error: r.err.trim().split('\n').pop()?.slice(0, 200), configured }; throw fail(r, 'compose ps failed'); }
      if (!cid) return { exists: false, reason: 'no-service', configured };
      ref = cid;
    }
    const r = await dk(['inspect', '--type', 'container', ref]);
    if (r.code !== 0) {
      if (NO_DAEMON.test(r.err)) return { exists: false, reason: 'no-docker', error: r.err.trim().split('\n').pop()?.slice(0, 200), configured };
      return { exists: false, reason: c.mode === 'existing' ? 'not-found' : c.mode === 'compose' ? 'no-service' : 'not-created', configured };
    }
    const d = inspected(JSON.parse(r.out)[0]);
    const made = d.labels['hive-am.cfg'];
    return { exists: true, cfgStale: c.mode === 'container' && !!made && made !== cfgHash(c), configured, ...d };
  } catch (e) {
    // `dk` only throws when Docker is missing or does not answer in time: one notice, not an error.
    if (e instanceof ObjectError && /not installed|took too long/.test(e.message)) return { exists: false, reason: 'no-docker', error: e.message, configured };
    throw e;
  }
}

/** The whole `docker inspect` of the container behind an object (or one compose service), with the secret-looking variables hidden unless `reveal`. */
export async function inspectRaw(id: string, c: DockerConfig, service: string | undefined, reveal: boolean) {
  return inspectMachine('container', await containerOf(id, c, service), reveal);
}

function inspected(j: any): Inspected {
  const cfg = j.Config ?? {}, st = j.State ?? {}, net = j.NetworkSettings ?? {};
  return {
    id: String(j.Id ?? '').slice(0, 12), name: String(j.Name ?? '').replace(/^\//, ''), image: String(cfg.Image ?? ''), status: String(st.Status ?? ''), created: String(j.Created ?? ''), started: String(st.StartedAt ?? ''),
    restartPolicy: String(j.HostConfig?.RestartPolicy?.Name || 'no'), restarts: Number(j.RestartCount ?? 0),
    command: Array.isArray(cfg.Cmd) ? cfg.Cmd.join(' ') : '', entrypoint: Array.isArray(cfg.Entrypoint) ? cfg.Entrypoint.join(' ') : String(cfg.Entrypoint ?? ''), workdir: String(cfg.WorkingDir ?? ''), user: String(cfg.User ?? ''),
    env: ((cfg.Env ?? []) as string[]).map((e) => { const i = e.indexOf('='); return i < 0 ? { name: e, value: '' } : { name: e.slice(0, i), value: e.slice(i + 1) }; }),
    ports: Object.entries((net.Ports ?? {}) as Record<string, { HostIp: string; HostPort: string }[] | null>).flatMap(([cp, hs]) => (hs && hs.length ? [...new Map(hs.map((h) => [h.HostPort, h])).values()].map((h) => ({ container: cp, host: h.HostPort })) : [{ container: cp, host: '' }])),
    mounts: ((j.Mounts ?? []) as any[]).map((m) => ({ type: String(m.Type ?? ''), source: String(m.Source ?? m.Name ?? ''), destination: String(m.Destination ?? ''), rw: m.RW !== false })),
    networks: Object.entries((net.Networks ?? {}) as Record<string, any>).map(([name, n]) => ({ name, ip: String(n.IPAddress ?? ''), gateway: String(n.Gateway ?? ''), aliases: (n.Aliases ?? []) as string[] })),
    health: st.Health ? { status: String(st.Health.Status ?? ''), log: ((st.Health.Log ?? []) as any[]).slice(-5).map((l) => ({ at: String(l.End ?? l.Start ?? ''), exit: Number(l.ExitCode ?? 0), output: String(l.Output ?? '').slice(0, 300) })) } : undefined,
    labels: (cfg.Labels ?? {}) as Record<string, string>,
  };
}

/**
 * After the compose file is saved: `docker compose config -q` says whether Docker can read it (`null` when Docker is not there to ask), and
 * whether services are running, which keep the definition they were created with until they are recreated. Neither changes anything.
 */
export async function composeCheck(c: DockerConfig): Promise<{ ok: boolean; error?: string } | null> {
  try {
    const r = await dk(composeArgs(c, ['config', '-q']), { cwd: dirname(c.file!), timeout: 20_000 });
    return r.code === 0 ? { ok: true } : { ok: false, error: (r.err || r.out).trim().split('\n').slice(-3).join('\n').slice(0, 600) || `docker exited with ${r.code}` };
  } catch { return null; }
}
export async function composeRunning(id: string, c: DockerConfig): Promise<boolean> {
  const s = await dockerState(id, c);
  return s.status === 'running' || s.status === 'starting';
}

/** A container hive-am created goes away with its object; a compose project is only stopped; an existing container is left alone. */
export async function removeDocker(id: string, c: DockerConfig): Promise<void> {
  if (c.mode === 'container') await dk(['rm', '-f', containerName(id)]).catch(() => undefined);
  else if (c.mode === 'compose' && existsSync(c.file!)) await dk(composeArgs(c, ['stop', ...(c.services ?? [])]), { cwd: dirname(c.file!) }).catch(() => undefined);
}

// ---------------------------------------------------------------- changing a container hive-am created
/** One setting that changes, as it is shown in the confirmation (variables with their secrets hidden). */
export interface PlanItem { field: string; from: string; to: string }
/**
 * What applying a configuration would do to the container, without touching Docker: `recreate` when it is created again (the settings it
 * was created with differ: `changes` says which, `stale` when it already differed before this change), the additional networks connected
 * and disconnected in place, what only applies on the next stop (`later`), the anonymous volumes that would be left behind (`rm -f` does
 * not remove them, and the new container does not mount them) and the commands it would run (`preview`, secrets hidden).
 */
export interface Plan {
  exists: boolean; running: boolean; recreate: boolean; stale: boolean;
  changes: PlanItem[]; connect: string[]; disconnect: string[]; later: PlanItem[];
  anonymous: { name: string; destination: string }[];
  preview: string[];
}

const ANONYMOUS = /^[0-9a-f]{64}$/;
/** An argument as a shell would need it, only to show a command (hive-am never runs a shell). */
export const quoteArg = (a: string) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
const shown = (v: unknown): string => {
  if (v === undefined || v === null || v === '') return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return Object.entries(v as Record<string, string>).map(([k, x]) => maskVar(`${k}=${x}`)).join(', ');
  return String(v);
};
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The commands applying `c` runs for a new container, with the values of secret-looking variables hidden. */
function previewOf(id: string, c: DockerConfig): string[] {
  const args = runArgs(id, c).map((a, i, all) => (all[i - 1] === '-e' ? maskVar(a) : a));
  const line = (xs: string[]) => `docker ${xs.map(quoteArg).join(' ')}`;
  if (!c.extraNetworks?.length) return [line(args)];
  const name = containerName(id);
  return [line(['create', ...args.slice(2)]), ...c.extraNetworks.map((n) => line(['network', 'connect', n, name])), line(['start', name])];
}

export async function planChange(id: string, saved: DockerConfig, next: DockerConfig): Promise<Plan> {
  if (saved.mode !== 'container' || next.mode !== 'container') throw new ObjectError(saved.mode === 'existing' ? 'A container that already existed is never changed by hive-am: create a managed copy instead' : 'Only a container hive-am creates is changed this way');
  const name = containerName(id);
  const changes = RECREATES.filter((k) => !same(saved[k], next[k])).map((k) => ({ field: k, from: shown(saved[k]), to: shown(next[k]) }));
  const later = !same(saved.stopTimeoutSec, next.stopTimeoutSec) ? [{ field: 'stopTimeoutSec', from: shown(saved.stopTimeoutSec), to: shown(next.stopTimeoutSec) }] : [];
  const r = await dk(['inspect', '--type', 'container', name]);
  const plan: Plan = { exists: false, running: false, recreate: false, stale: false, changes, connect: [], disconnect: [], later, anonymous: [], preview: previewOf(id, next) };
  if (r.code !== 0) {
    if (NO_DAEMON.test(r.err)) throw fail(r, 'Docker is not answering');
    // Not created yet: everything applies when it is created, on the next start.
    return { ...plan, connect: [], disconnect: [] };
  }
  const j = JSON.parse(r.out)[0] ?? {};
  const made = String(j.Config?.Labels?.['hive-am.cfg'] ?? '');
  plan.exists = true;
  plan.running = !!j.State?.Running;
  // A container created by a hive-am older than the label is left as it is, as on start.
  plan.recreate = !!made && made !== cfgHash(next);
  plan.stale = !!made && made !== cfgHash(saved);
  if (plan.recreate) {
    plan.anonymous = ((j.Mounts ?? []) as any[]).filter((m) => m.Type === 'volume' && ANONYMOUS.test(String(m.Name ?? ''))).map((m) => ({ name: String(m.Name), destination: String(m.Destination ?? '') }));
    return plan;
  }
  const mode = String(j.HostConfig?.NetworkMode ?? 'default');
  const n = { main: mode === 'default' ? 'bridge' : mode, now: Object.keys(j.NetworkSettings?.Networks ?? {}), kept: j.Config?.Labels?.['hive-am.networks'] === '1' };
  const dropped = (saved.extraNetworks ?? []).filter((x) => !(next.extraNetworks ?? []).includes(x));
  const { connect, disconnect } = networkChanges(n, next, dropped);
  return { ...plan, connect, disconnect, preview: [] };
}

/**
 * Makes Docker match the saved settings of a container hive-am created, keeping it running or stopped as it is: created again when the
 * settings it was created with changed (only with `confirm`: what was written inside it is lost), otherwise its additional networks are
 * connected and disconnected in place. `drop` are the networks just taken out of the settings. Not created yet: nothing to do.
 */
export async function applyDocker(id: string, c: DockerConfig, o: { confirm?: boolean; drop?: string[] } = {}): Promise<{ applied: 'nothing' | 'recreated' | 'networks'; connected: string[]; disconnected: string[] }> {
  if (c.mode !== 'container') throw new ObjectError(c.mode === 'existing' ? 'A container that already existed is never changed by hive-am: create a managed copy instead' : 'Only a container hive-am creates is applied this way');
  const name = containerName(id);
  const st = await dk(['inspect', '-f', '{{.State.Running}}|{{index .Config.Labels "hive-am.cfg"}}', name]);
  if (st.code !== 0) { if (NO_DAEMON.test(st.err)) throw fail(st, 'Docker is not answering'); return { applied: 'nothing', connected: [], disconnected: [] }; }
  const [running, made] = st.out.trim().split('|');
  if (made && made !== cfgHash(c)) {
    if (!o.confirm) throw new ObjectError('Creating the container again loses what was written inside it: confirm it first');
    if (running === 'true') await dk(['stop', ...stopArgs(c), name], { timeout: 300_000 });
    await dk(['rm', '-f', name], { timeout: 120_000 });
    await createContainer(id, c, running === 'true');
    return { applied: 'recreated', connected: c.extraNetworks ?? [], disconnected: [] };
  }
  const drop = (o.drop ?? []).filter((x) => typeof x === 'string');
  const r = await reconcileNetworks(name, c, drop);
  return { applied: 'networks', ...r };
}

/**
 * The settings of a container hive-am would create to run like an existing one, read from its `docker inspect` (and its image's, so that
 * what the image already sets, its variables, command, user or folder, is not copied as if chosen). The original is only read. What cannot
 * be copied is listed in `skipped` (an anonymous volume, a random host port, an option hive-am does not support).
 */
export async function managedCopy(c: DockerConfig): Promise<{ name: string; config: DockerConfig; skipped: string[] }> {
  if (c.mode !== 'existing') throw new ObjectError('Only an existing container is copied this way');
  const r = await dk(['inspect', '--type', 'container', c.container!]);
  if (r.code !== 0) { if (NO_DAEMON.test(r.err)) throw fail(r, 'Docker is not answering'); throw new ObjectError(`Docker has no container ${c.container}`); }
  const j = JSON.parse(r.out)[0] ?? {};
  const cfg = j.Config ?? {}, host = j.HostConfig ?? {};
  const ir = cfg.Image ? await dk(['image', 'inspect', String(cfg.Image)]) : null;
  const img = (ir && ir.code === 0 ? JSON.parse(ir.out)[0]?.Config : null) ?? {};
  const skipped: string[] = [];
  const ports: string[] = [];
  for (const [cp, hs] of Object.entries((host.PortBindings ?? {}) as Record<string, { HostIp?: string; HostPort?: string }[] | null>)) {
    const [port, proto] = cp.split('/');
    for (const h of hs ?? []) {
      if (!h.HostPort) { skipped.push(`port ${cp} (published on a random port)`); continue; }
      const ip = h.HostIp && h.HostIp !== '0.0.0.0' && !h.HostIp.includes(':') ? `${h.HostIp}:` : '';
      ports.push(`${ip}${h.HostPort}:${port}${proto && proto !== 'tcp' ? `/${proto}` : ''}`);
    }
  }
  const volumes: string[] = [];
  for (const m of (j.Mounts ?? []) as any[]) {
    const ro = m.RW === false ? ':ro' : '';
    if (m.Type === 'bind') volumes.push(`${m.Source}:${m.Destination}${ro}`);
    else if (m.Type === 'volume' && m.Name && !ANONYMOUS.test(String(m.Name))) volumes.push(`${m.Name}:${m.Destination}${ro}`);
    else skipped.push(m.Type === 'volume' ? `the anonymous volume at ${m.Destination} (the copy gets a new, empty one)` : `the ${m.Type} mount at ${m.Destination}`);
  }
  const imageEnv = new Set<string>((img.Env ?? []) as string[]);
  const env = Object.fromEntries(((cfg.Env ?? []) as string[]).filter((e) => !imageEnv.has(e)).map((e) => { const i = e.indexOf('='); return i < 0 ? [e, ''] : [e.slice(0, i), e.slice(i + 1)]; }));
  const differs = (k: string) => !same(cfg[k], img[k]);
  const entry = Array.isArray(cfg.Entrypoint) ? cfg.Entrypoint as string[] : [];
  if (differs('Entrypoint') && entry.length > 1) skipped.push(`the entrypoint ${entry.join(' ')} (hive-am takes one program; put the rest in the command)`);
  const mode = String(host.NetworkMode ?? 'default');
  if (mode.startsWith('container:')) skipped.push(`the network of another container (${mode})`);
  const network = mode === 'default' || mode === 'bridge' || mode.startsWith('container:') ? undefined : mode;
  const imageLabels = (img.Labels ?? {}) as Record<string, string>;
  const labels = Object.fromEntries(Object.entries((cfg.Labels ?? {}) as Record<string, string>).filter(([k, v]) => imageLabels[k] !== v && !k.startsWith('hive-am.') && !k.startsWith('com.docker.')));
  const restart = String(host.RestartPolicy?.Name ?? '');
  const candidate: Record<string, unknown> = {
    image: String(cfg.Image ?? ''), ports, volumes, env,
    restart: ['always', 'unless-stopped', 'on-failure'].includes(restart) ? restart : undefined,
    command: differs('Cmd') && Array.isArray(cfg.Cmd) ? (cfg.Cmd as string[]).map(quoteArg).join(' ') : undefined,
    entrypoint: differs('Entrypoint') && entry.length === 1 ? entry[0] : undefined,
    memory: host.Memory > 0 ? `${Math.max(1, Math.round(host.Memory / 1048576))}m` : undefined,
    cpus: host.NanoCpus > 0 ? host.NanoCpus / 1e9 : undefined,
    network,
    extraNetworks: network === 'host' || network === 'none' ? undefined : Object.keys(j.NetworkSettings?.Networks ?? {}).filter((x) => x !== (network ?? 'bridge')),
    labels,
    user: differs('User') ? cfg.User : undefined, workdir: differs('WorkingDir') ? cfg.WorkingDir : undefined,
    hostname: cfg.Hostname && !String(j.Id ?? '').startsWith(String(cfg.Hostname)) ? cfg.Hostname : undefined,
  };
  // Each value goes through the same checks as the form; one that does not pass is left out and said.
  const config: Record<string, unknown> = { mode: 'container', image: candidate.image };
  parseDocker(config);
  for (const [k, v] of Object.entries(candidate)) {
    if (k === 'image' || v === undefined || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length)) continue;
    const items = Array.isArray(v) ? v : [v];
    if (Array.isArray(v)) {
      const ok = items.filter((x) => { try { parseDocker({ ...config, [k]: [x] }); return true; } catch (e) { skipped.push(`${k} ${x}: ${(e as Error).message}`); return false; } });
      if (ok.length) config[k] = ok;
    } else {
      try { parseDocker({ ...config, [k]: v }); config[k] = v; } catch (e) { skipped.push(`${k}: ${(e as Error).message}`); }
    }
  }
  return { name: `${String(j.Name ?? c.container).replace(/^\//, '')}-copy`.slice(0, 60), config: parseDocker(config), skipped };
}

// ---------------------------------------------------------------- networks, volumes and images made from the form
/**
 * What the person asks for from the Docker form, one button each: create a network or a volume, build an image. What hive-am creates carries
 * the label `hive-am.created=1`, and only that can be removed from here, while no container (running or not) uses it. The checks are made
 * here, against Docker, right before removing: never on what the page says.
 */
export type MadeKind = 'network' | 'volume';
const CREATED = 'hive-am.created';
const MADE_NAME: Record<MadeKind, RegExp> = { network: /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/, volume: /^[A-Za-z0-9][A-Za-z0-9_.-]{1,63}$/ };
const BUILTIN_NETWORKS = ['bridge', 'host', 'none'];

function madeName(kind: MadeKind, raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!MADE_NAME[kind].test(name)) throw new ObjectError(`"${name}" is not a valid ${kind} name: letters, digits, _ . or -, starting with a letter or digit`);
  if (kind === 'network' && BUILTIN_NETWORKS.includes(name)) throw new ObjectError(`${name} is one of Docker's own networks`);
  // 64 hex digits is what Docker calls an anonymous volume, and what a network id looks like: never a name to create or remove.
  if (/^[0-9a-f]{64}$/.test(name)) throw new ObjectError(kind === 'volume' ? 'That name looks like an anonymous volume' : 'That name looks like a network id');
  return name;
}

/** The labels of a network or a volume, or null when Docker has none with exactly that name (a network is also found by an id prefix: not that). */
async function madeLabels(kind: MadeKind, name: string): Promise<Record<string, string> | null> {
  const r = await dk([kind, 'inspect', '-f', '{{.Name}}|{{json .Labels}}', name], { timeout: 20_000 });
  if (r.code !== 0) { if (NO_DAEMON.test(r.err)) throw fail(r, 'Docker is not answering'); return null; }
  const at = r.out.indexOf('|');
  if (r.out.slice(0, at).trim() !== name) return null;
  try { return JSON.parse(r.out.slice(at + 1)) ?? {}; } catch { return {}; }
}

/** Creates a network or a volume with hive-am's label. One that already exists is left as it is (`created: false`). */
export async function createMade(kind: MadeKind, raw: unknown): Promise<{ name: string; created: boolean }> {
  const name = madeName(kind, raw);
  if (await madeLabels(kind, name)) return { name, created: false };
  const r = await dk([kind, 'create', '--label', `${CREATED}=1`, name], { timeout: 30_000 });
  if (r.code !== 0) throw fail(r, `Could not create the ${kind} ${name}`);
  return { name, created: true };
}

/** Removes a network or a volume, only if hive-am created it (its label) and no container, running or stopped, uses it. */
export async function removeMade(kind: MadeKind, raw: unknown): Promise<{ name: string; removed: true }> {
  const name = madeName(kind, raw);
  const labels = await madeLabels(kind, name);
  if (!labels) throw new ObjectError(`Docker has no ${kind} ${name}`);
  if (labels[CREATED] !== '1' || 'com.docker.volume.anonymous' in labels) throw new ObjectError(`hive-am did not create the ${kind} ${name}, so it does not remove it`);
  // Docker itself removes a network a stopped container is still attached to: ask which containers use it. Docker cannot check and remove
  // in one step, so a container created and attached to it between `ps` and `rm` (and not started) would be detached; that window stays.
  const users = await dk(['ps', '-a', '-q', '--filter', `${kind}=${name}`], { timeout: 20_000 });
  if (users.code !== 0) throw fail(users, `Could not check which containers use the ${kind} ${name}`);
  const n = users.out.split('\n').filter((l) => l.trim()).length;
  if (n) throw new ObjectError(`The ${kind} ${name} is used by ${n} container${n === 1 ? '' : 's'}, so it is not removed`);
  const r = await dk([kind, 'rm', name], { timeout: 30_000 });
  if (r.code !== 0) throw fail(r, `Could not remove the ${kind} ${name}`);
  return { name, removed: true };
}

/** `Dockerfile`, `Containerfile`, `Dockerfile.<suffix>` or `<name>.Dockerfile` (any case): the only files built, read or written as a Dockerfile. */
export const DOCKERFILE_NAME = /^(?:(?:dockerfile|containerfile)(?:\.\w[\w.-]{0,80})?|\w[\w.-]{0,80}\.(?:dockerfile|containerfile))$/i;
/**
 * An absolute path to an existing regular file named like a Dockerfile, as its real path: a link is followed and the real name must be one
 * too. Anything else would let a build (whose error shows the last lines of the file) read any file of the machine.
 */
export function dockerfilePath(raw: unknown): string {
  const file = typeof raw === 'string' ? raw.trim() : '';
  if (!file || !isAbsolute(file)) throw new ObjectError('Choose the Dockerfile (an absolute path)');
  if (!DOCKERFILE_NAME.test(basename(file))) throw new ObjectError(`${basename(file)} is not named like a Dockerfile (Dockerfile, Containerfile, Dockerfile.<name> or <name>.Dockerfile)`);
  if (!existsSync(file)) throw new ObjectError(`The Dockerfile ${file} does not exist`);
  if (!statSync(file).isFile()) throw new ObjectError(`${file} is not a file`);
  const real = realpathSync(file);
  if (!DOCKERFILE_NAME.test(basename(real))) throw new ObjectError(`${file} leads to ${basename(real)}, which is not named like a Dockerfile`);
  return real;
}

/**
 * `docker build -t tag -f dockerfile context`: the context is the Dockerfile's folder unless another is given. It runs the Dockerfile's
 * `RUN` steps on this machine and may download base images, so it can take long (up to 15 minutes, like rebuilding a compose project). On
 * failure the error carries the last lines of the output.
 */
export async function buildImage(o: { dockerfile?: unknown; context?: unknown; tag?: unknown }): Promise<{ tag: string; output: string }> {
  const file = dockerfilePath(o.dockerfile);
  // The folder it was picked from, even when that name is a link to a Dockerfile elsewhere.
  const context = typeof o.context === 'string' && o.context.trim() ? o.context.trim() : dirname(String(o.dockerfile).trim());
  if (!isAbsolute(context) || !existsSync(context) || !statSync(context).isDirectory()) throw new ObjectError(`The build folder ${context} is not a folder of this machine`);
  const tag = typeof o.tag === 'string' ? o.tag.trim() : '';
  if (!IMAGE.test(tag)) throw new ObjectError('The image name is not valid (for example my-app:dev)');
  const r = await dk(['build', '-t', tag, '-f', file, '--label', `${CREATED}=1`, context], { cwd: context, timeout: 900_000 });
  const tail = (n: number) => `${r.out}\n${r.err}`.split('\n').filter((l) => l.trim()).slice(-n).join('\n');
  if (r.code !== 0) throw new ObjectError(`The build failed:\n${tail(12).slice(-2000)}`);
  return { tag, output: tail(20) };
}

const STAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/;

/**
 * The latest output. `after` is the time (RFC 3339) of the last line already seen; without it the last `tail` lines come back.
 * Lines carry docker's own timestamp, which is what makes "only what is new" possible; it is cut out of the text shown.
 */
/**
 * `--since` alone makes docker read the whole log file on every call (4 s for a 200 MB log, measured), so it always goes with `--tail`, which
 * lets it read from the end: a poll costs the same however big the log is. If more than SINCE_TAIL lines arrived between two polls the
 * oldest of them are skipped; the log pane shows the latest anyway.
 */
const SINCE_TAIL = 2000;
const tailArgs = (o: { tail?: number; after?: string }) => o.after ? ['--since', o.after, '--tail', String(SINCE_TAIL)] : ['--tail', String(Math.max(1, Math.min(o.tail ?? 300, 5000)))];

export async function dockerLogs(id: string, c: DockerConfig, o: { tail?: number; after?: string }): Promise<{ text: string; cursor: string }> {
  const base = c.mode === 'compose'
    ? composeArgs(c, ['logs', '--no-color', '--timestamps', ...tailArgs(o), ...(c.services ?? [])])
    : ['logs', '--timestamps', ...tailArgs(o), nameOf(id, c)];
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
