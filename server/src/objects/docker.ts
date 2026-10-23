import { createHash } from 'node:crypto';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute } from 'node:path';
import { inspectMachine, NO_DAEMON } from './docker-info.js';
import { execCapture } from './exec.js';
import { IMAGE, ObjectError, splitArgs, type DockerConfig, type ObjectState } from './model.js';

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
  if (exists) { const r = await dk(['start', name]); if (r.code !== 0) throw fail(r, 'could not start it'); return; }
  if (c.mode === 'existing') throw new ObjectError(`There is no container named ${name}`);
  const args = ['run', '-d', '--name', name, '--label', `hive-am.object=${id}`, '--label', `hive-am.cfg=${cfgHash(c)}`];
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
      name: containerName(id), image: c.image, ports: c.ports ?? [], volumes: c.volumes ?? [], networks: c.network ? [c.network] : [], env: asEnv(c.env ?? {}),
      restart: c.restart, command: c.command, memory: c.memory, cpus: c.cpus, logMaxMb: c.logMaxMb, stopTimeoutSec: c.stopTimeoutSec,
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

/** A container hive-am created goes away with its object; a compose project is only stopped; an existing container is left alone. */
export async function removeDocker(id: string, c: DockerConfig): Promise<void> {
  if (c.mode === 'container') await dk(['rm', '-f', containerName(id)]).catch(() => undefined);
  else if (c.mode === 'compose' && existsSync(c.file!)) await dk(composeArgs(c, ['stop', ...(c.services ?? [])]), { cwd: dirname(c.file!) }).catch(() => undefined);
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
