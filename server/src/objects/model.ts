/**
 * Objects of a colony: things that are not agents but live next to them. A server is a command that hive-am keeps running; a Docker
 * object is a container (or a compose project) that hive-am starts, stops and reads the logs of.
 */
export class ObjectError extends Error {}

export type ObjectKind = 'server' | 'docker' | 'http' | 'boss';
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
}

export interface DockerConfig {
  /** `container`: hive-am creates it. `compose`: a docker-compose project. `existing`: a container that was already there (monitored; never deleted). */
  mode: 'container' | 'compose' | 'existing';
  image?: string; ports?: string[]; volumes?: string[]; env?: Record<string, string>; restart?: 'no' | 'always' | 'unless-stopped' | 'on-failure'; command?: string;
  file?: string; project?: string; services?: string[];
  container?: string;
}

/** A folder of `.http` / `.rest` files whose requests can be run (the IntelliJ / VS Code REST client format). */
export interface HttpConfig { folder: string; /** The environment selected by default (from the http-client.env.json files). */ env?: string }
/** Groups other objects (servers and containers of the same colony) to start, stop and read them together. */
export interface BossConfig { members: string[] }

export interface ObjectRow { id: string; colony_id: string | null; kind: ObjectKind; name: string; config: ServerConfig | DockerConfig | HttpConfig | BossConfig; created_at: number; updated_at: number }
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

export function parseServer(c: any): ServerConfig {
  const start = str(c?.start, 'The start command');
  if (!start) throw new ObjectError('Write the command that starts it');
  const cwd = str(c?.cwd, 'The folder');
  if (!cwd.startsWith('/')) throw new ObjectError('The folder must be an absolute path');
  return { cwd, start, stop: optStr(c?.stop, 'The stop command'), env: env(c?.env), port: c?.port === undefined || c?.port === null || c?.port === '' ? undefined : port(c.port, 'The port') };
}

export function parseDocker(c: any): DockerConfig {
  const mode = c?.mode;
  if (mode !== 'container' && mode !== 'compose' && mode !== 'existing') throw new ObjectError('Choose how the container is managed: create it, compose, or an existing one');
  if (mode === 'existing') {
    const container = str(c?.container, 'The container');
    if (!CONTAINER.test(container)) throw new ObjectError('The container name is not valid');
    return { mode, container };
  }
  if (mode === 'compose') {
    const file = str(c?.file, 'The compose file');
    if (!file.startsWith('/')) throw new ObjectError('The compose file must be an absolute path');
    const project = optStr(c?.project, 'The project name');
    if (project && !PROJECT.test(project)) throw new ObjectError('The project name must be lowercase letters, digits, - or _');
    return { mode, file, project, services: list(c?.services, 'Services', (s) => { if (!CONTAINER.test(s)) throw new ObjectError(`"${s}" is not a valid service name`); return s; }) };
  }
  const image = str(c?.image, 'The image');
  if (!IMAGE.test(image)) throw new ObjectError('The image name is not valid');
  const restart = optStr(c?.restart, 'The restart policy');
  if (restart && !['no', 'always', 'unless-stopped', 'on-failure'].includes(restart)) throw new ObjectError('Unknown restart policy');
  return {
    mode, image, restart: restart as DockerConfig['restart'], command: optStr(c?.command, 'The command'), env: env(c?.env),
    ports: list(c?.ports, 'Ports', (s) => { if (!PORT_SPEC.test(s)) throw new ObjectError(`"${s}" is not a port mapping (use 8080:80)`); return s; }),
    volumes: list(c?.volumes, 'Volumes', (s) => { if (s.startsWith('-') || !s.includes(':')) throw new ObjectError(`"${s}" is not a volume (use /host/path:/in/container)`); return s; }),
  };
}

export function parseHttp(c: any): HttpConfig {
  const folder = str(c?.folder, 'The folder');
  if (!folder.startsWith('/')) throw new ObjectError('The folder must be an absolute path');
  const env = optStr(c?.env, 'The environment', 100);
  return { folder, env };
}

export function parseBoss(c: any): BossConfig {
  if (!Array.isArray(c?.members)) throw new ObjectError('Choose the objects it groups');
  const members = [...new Set(c.members.map((x: unknown) => str(x, 'A member')))] as string[];
  if (members.length > 30) throw new ObjectError('A boss groups at most 30 objects');
  return { members };
}

export function parseConfig(kind: ObjectKind, c: unknown): ServerConfig | DockerConfig | HttpConfig | BossConfig {
  return kind === 'server' ? parseServer(c) : kind === 'docker' ? parseDocker(c) : kind === 'http' ? parseHttp(c) : parseBoss(c);
}
export function parseName(v: unknown): string {
  const name = str(v, 'The name', NAME_MAX);
  if (!name) throw new ObjectError('Give it a name');
  return name;
}
export const isKind = (k: unknown): k is ObjectKind => k === 'server' || k === 'docker' || k === 'http' || k === 'boss';

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
