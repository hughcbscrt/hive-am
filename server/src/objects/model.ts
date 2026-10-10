/**
 * Objects of a colony: things that are not agents but live next to them. A server is a command that hive-am keeps running; a Docker
 * object is a container (or a compose project) that hive-am starts, stops and reads the logs of.
 */
export class ObjectError extends Error {}

export type ObjectKind = 'server' | 'docker' | 'http' | 'cluster';
/** `ready` is for objects that are not run but used (HTTP requests): their files are there and can be used. */
export type ObjectStatus = 'running' | 'starting' | 'stopped' | 'error' | 'unknown' | 'ready';

export interface ServerConfig {
  cwd: string;
  /** A shell command, started from `cwd` (e.g. `npm run dev`). */
  start: string;
  /** Optional shell command that stops it cleanly (e.g. `docker compose down`); the process group is always stopped afterwards. */
  stop?: string;
  env?: Record<string, string>;
  /** When set the object is "starting" until something listens on it, and "running" after. */
  port?: number;
  /** What to do when it ends by itself (not when you stop it): never, only after a failure, or always. */
  restart?: 'no' | 'on-failure' | 'always';
  /** How many automatic restarts in 10 minutes before hive-am gives up (default 5). */
  maxRestarts?: number;
  health?: HealthConfig;
  /** Seconds between asking it to stop and killing it (default 8). */
  stopTimeoutSec?: number;
  /** Size of its log file, in MB, before the old part is set aside (default 5). */
  logMaxMb?: number;
}

/** A check that says whether a running server is really working. */
export interface HealthConfig {
  kind: 'http' | 'tcp' | 'command';
  /** http: a URL (healthy when it answers 2xx or 3xx); tcp: a port or host:port; command: a shell command (healthy when it exits with 0). */
  target: string;
  intervalSec?: number; timeoutSec?: number;
  /** Failed checks in a row before it counts as unhealthy (default 3). */
  retries?: number;
  /** Restart it when it is unhealthy (counts as one of the automatic restarts). */
  restartWhenUnhealthy?: boolean;
}

export interface DockerConfig {
  /** `container`: hive-am creates it. `compose`: a docker-compose project. `existing`: a container that was already there (monitored; never deleted). */
  mode: 'container' | 'compose' | 'existing';
  image?: string; ports?: string[]; volumes?: string[]; env?: Record<string, string>; restart?: 'no' | 'always' | 'unless-stopped' | 'on-failure'; command?: string;
  file?: string; project?: string; services?: string[];
  container?: string;
  /** Only for a container hive-am creates: limits and where it is attached. They apply the next time it is started (it is created again). */
  memory?: string; cpus?: number; network?: string;
  stopTimeoutSec?: number; logMaxMb?: number;
}

/** A folder of `.http` / `.rest` files whose requests can be run (the IntelliJ / VS Code REST client format). */
/** A value of an environment. A secret is hidden once saved: the API never returns it (`set` says there is one). */
export interface HttpVariable { value: string; secret?: boolean; set?: boolean }
export interface HttpConfig {
  folder: string;
  /** The environment selected by default. */
  env?: string;
  /** Variables of hive-am, per environment (`$shared` applies to all), for when there is no http-client.env.json or it lacks something. The files win. */
  variables?: Record<string, Record<string, HttpVariable>>;
}
/** Groups other objects (servers and containers of the same colony) to start, stop and read them together. */
export interface ClusterConfig { members: string[] }

export interface ObjectRow { id: string; colony_id: string | null; kind: ObjectKind; name: string; config: ServerConfig | DockerConfig | HttpConfig | ClusterConfig; created_at: number; updated_at: number }
export interface ObjectState { status: ObjectStatus; /** Why, in a few words (an exit code, "unhealthy", "docker is not available"…). */ detail?: string; pid?: number; since?: number }
export type ObjectView = ObjectRow & { state: ObjectState };

export const NAME_MAX = 60;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PORT_SPEC = /^((\d{1,3}\.){3}\d{1,3}:)?\d{1,5}:\d{1,5}(\/(tcp|udp))?$/;
const IMAGE = /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,199}$/;
const CONTAINER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const PROJECT = /^[a-z0-9][a-z0-9_-]{0,62}$/;

const str = (v: unknown, what: string, max = 2000): string => {
  if (typeof v !== 'string') throw new ObjectError(`${what} must be text`);
  if (v.includes('\0') || v.length > max) throw new ObjectError(`${what} is not valid`);
  return v.trim();
};
const optStr = (v: unknown, what: string, max?: number) => (v === undefined || v === null || v === '' ? undefined : str(v, what, max));
const port = (v: unknown, what: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new ObjectError(`${what} must be a port between 1 and 65535`);
  return n;
};
const env = (v: unknown): Record<string, string> | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) throw new ObjectError('Environment variables must be NAME: value pairs');
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (!ENV_KEY.test(k)) throw new ObjectError(`"${k}" is not a valid variable name`);
    out[k] = str(String(val ?? ''), `Value of ${k}`, 4000);
  }
  return Object.keys(out).length ? out : undefined;
};
const list = (v: unknown, what: string, each: (s: string) => string): string[] | undefined => {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) throw new ObjectError(`${what} must be a list`);
  const out = v.map((x) => each(str(x, what))).filter(Boolean);
  if (out.length > 50) throw new ObjectError(`${what} has too many entries`);
  return out.length ? out : undefined;
};

const oneOf = <T extends string>(v: unknown, list: readonly T[], what: string): T | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  if (!list.includes(v as T)) throw new ObjectError(`${what} is not valid`);
  return v as T;
};
const num = (v: unknown, what: string, min: number, max: number): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new ObjectError(`${what} must be between ${min} and ${max}`);
  return n;
};

export function parseHealth(h: any): HealthConfig | undefined {
  if (!h || !h.target) return undefined;
  const kind = oneOf(h.kind, ['http', 'tcp', 'command'] as const, 'The kind of health check');
  if (!kind) throw new ObjectError('Choose the kind of health check');
  const target = str(h.target, 'The health check target', 1000);
  if (kind === 'http' && !/^https?:\/\//i.test(target)) throw new ObjectError('The health check URL must start with http:// or https://');
  if (kind === 'tcp' && !/^((\d{1,3}\.){3}\d{1,3}:|localhost:)?\d{1,5}$/.test(target)) throw new ObjectError('The health check port must be a number or host:port');
  return { kind, target, intervalSec: num(h.intervalSec, 'The interval', 2, 3600), timeoutSec: num(h.timeoutSec, 'The timeout', 1, 120), retries: num(h.retries, 'The retries', 1, 20), restartWhenUnhealthy: h.restartWhenUnhealthy ? true : undefined };
}

export function parseServer(c: any): ServerConfig {
  const start = str(c?.start, 'The start command');
  if (!start) throw new ObjectError('Write the command that starts it');
  const cwd = str(c?.cwd, 'The folder');
  if (!cwd.startsWith('/')) throw new ObjectError('The folder must be an absolute path');
  return {
    cwd, start, stop: optStr(c?.stop, 'The stop command'), env: env(c?.env), port: c?.port === undefined || c?.port === null || c?.port === '' ? undefined : port(c.port, 'The port'),
    restart: oneOf(c?.restart, ['no', 'on-failure', 'always'] as const, 'The restart policy'), maxRestarts: num(c?.maxRestarts, 'The restart limit', 1, 100),
    health: parseHealth(c?.health), stopTimeoutSec: num(c?.stopTimeoutSec, 'The stop timeout', 1, 300), logMaxMb: num(c?.logMaxMb, 'The log size', 0.05, 500),
  };
}

export function parseDocker(c: any): DockerConfig {
  const mode = c?.mode;
  if (mode !== 'container' && mode !== 'compose' && mode !== 'existing') throw new ObjectError('Choose how the container is managed: create it, compose, or an existing one');
  if (mode === 'existing') {
    const container = str(c?.container, 'The container');
    if (!CONTAINER.test(container)) throw new ObjectError('The container name is not valid');
    return { mode, container, stopTimeoutSec: num(c?.stopTimeoutSec, 'The stop timeout', 1, 300) };
  }
  if (mode === 'compose') {
    const file = str(c?.file, 'The compose file');
    if (!file.startsWith('/')) throw new ObjectError('The compose file must be an absolute path');
    const project = optStr(c?.project, 'The project name');
    if (project && !PROJECT.test(project)) throw new ObjectError('The project name must be lowercase letters, digits, - or _');
    return { mode, file, project, stopTimeoutSec: num(c?.stopTimeoutSec, 'The stop timeout', 1, 300), services: list(c?.services, 'Services', (s) => { if (!CONTAINER.test(s)) throw new ObjectError(`"${s}" is not a valid service name`); return s; }) };
  }
  const image = str(c?.image, 'The image');
  if (!IMAGE.test(image)) throw new ObjectError('The image name is not valid');
  const restart = optStr(c?.restart, 'The restart policy');
  if (restart && !['no', 'always', 'unless-stopped', 'on-failure'].includes(restart)) throw new ObjectError('Unknown restart policy');
  return {
    mode, image, restart: restart as DockerConfig['restart'], command: optStr(c?.command, 'The command'), env: env(c?.env),
    memory: ((v) => { if (v && !/^\d+(\.\d+)?[bkmg]?$/i.test(v)) throw new ObjectError('The memory limit must look like 512m or 1g'); return v; })(optStr(c?.memory, 'The memory limit', 20)),
    cpus: num(c?.cpus, 'The CPU limit', 0.01, 256), network: ((v) => { if (v && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(v)) throw new ObjectError('The network name is not valid'); return v; })(optStr(c?.network, 'The network', 64)),
    stopTimeoutSec: num(c?.stopTimeoutSec, 'The stop timeout', 1, 300), logMaxMb: num(c?.logMaxMb, 'The log size', 0.05, 500),
    ports: list(c?.ports, 'Ports', (s) => { if (!PORT_SPEC.test(s)) throw new ObjectError(`"${s}" is not a port mapping (use 8080:80)`); return s; }),
    volumes: list(c?.volumes, 'Volumes', (s) => { if (s.startsWith('-') || !s.includes(':')) throw new ObjectError(`"${s}" is not a volume (use /host/path:/in/container)`); return s; }),
  };
}

const ENV_NAME = /^[\w.$-]{1,60}$/, VAR_NAME = /^[A-Za-z_][\w.-]{0,80}$/;
export function parseHttp(c: any): HttpConfig {
  const folder = str(c?.folder, 'The folder');
  if (!folder.startsWith('/')) throw new ObjectError('The folder must be an absolute path');
  const envName = optStr(c?.env, 'The environment', 100);
  let variables: HttpConfig['variables'];
  if (c?.variables && typeof c.variables === 'object') {
    variables = {};
    const envs = Object.entries(c.variables as Record<string, unknown>);
    if (envs.length > 30) throw new ObjectError('At most 30 environments');
    for (const [name, vars] of envs) {
      if (!ENV_NAME.test(name)) throw new ObjectError(`"${name}" is not a valid environment name`);
      if (!vars || typeof vars !== 'object') continue;
      const out: Record<string, HttpVariable> = {};
      const entries = Object.entries(vars as Record<string, any>);
      if (entries.length > 100) throw new ObjectError(`At most 100 variables in ${name}`);
      for (const [k, v] of entries) {
        if (!VAR_NAME.test(k)) throw new ObjectError(`"${k}" is not a valid variable name`);
        out[k] = { value: typeof v?.value === 'string' ? str(v.value, `The value of ${k}`, 4000) : '', ...(v?.secret ? { secret: true } : {}) };
      }
      variables[name] = out;
    }
    if (!Object.keys(variables).length) variables = undefined;
  }
  return { folder, env: envName, variables };
}

export function parseCluster(c: any): ClusterConfig {
  if (!Array.isArray(c?.members)) throw new ObjectError('Choose the objects it groups');
  const members = [...new Set(c.members.map((x: unknown) => str(x, 'A member')))] as string[];
  if (members.length > 30) throw new ObjectError('A cluster groups at most 30 objects');
  return { members };
}

export function parseConfig(kind: ObjectKind, c: unknown): ServerConfig | DockerConfig | HttpConfig | ClusterConfig {
  return kind === 'server' ? parseServer(c) : kind === 'docker' ? parseDocker(c) : kind === 'http' ? parseHttp(c) : parseCluster(c);
}
export function parseName(v: unknown): string {
  const name = str(v, 'The name', NAME_MAX);
  if (!name) throw new ObjectError('Give it a name');
  return name;
}
export const isKind = (k: unknown): k is ObjectKind => k === 'server' || k === 'docker' || k === 'http' || k === 'cluster';
/** `boss` was the first name of a cluster: the API still accepts it. */
export const kindOf = (k: unknown): unknown => (k === 'boss' ? 'cluster' : k);

/** Splits a command line the way a shell would for quotes (no expansion): `sh -c "echo hi"` → ["sh", "-c", "echo hi"]. */
export function splitArgs(line: string): string[] {
  const out: string[] = []; let cur = '', q: '"' | "'" | null = null, any = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === q) q = null; else if (ch === '\\' && q === '"' && i + 1 < line.length) cur += line[++i]; else cur += ch; }
    else if (ch === '"' || ch === "'") { q = ch; any = true; }
    else if (/\s/.test(ch)) { if (cur || any) { out.push(cur); cur = ''; any = false; } }
    else if (ch === '\\' && i + 1 < line.length) cur += line[++i];
    else cur += ch;
  }
  if (q) throw new ObjectError('A quote is not closed in the command');
  if (cur || any) out.push(cur);
  return out;
}
