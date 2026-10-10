import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { containerName } from './docker.js';
import { ObjectError, type DockerConfig, type ObjectRow } from './model.js';
import { readSaved } from './runner.js';

/**
 * What an object is using right now, for its panel: the CPU and memory of a server's processes, and what Docker reports for a container
 * (and the services of a compose project). Read on request, not polled.
 */
export interface ObjectStats {
  cpu: number | null;                 // percent of one core
  memBytes: number | null; memLimitBytes: number | null; pids: number | null;
  net?: string | null; block?: string | null;
  info: Record<string, string | number | null>;
  /** Compose: one row per service. */
  services?: { name: string; state: string; health: string; ports: string }[];
}

const run = (file: string, args: string[], o: { cwd?: string; timeout?: number } = {}) => new Promise<{ out: string; code: number }>((resolve) => {
  execFile(file, args, { cwd: o.cwd, timeout: o.timeout ?? 15_000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (e: any, stdout) => resolve({ out: String(stdout ?? ''), code: e ? (typeof e.code === 'number' ? e.code : 1) : 0 }));
});

const UNITS: Record<string, number> = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 };
/** "12.5MiB" → bytes. */
const bytes = (s: string): number | null => { const m = /^([\d.]+)\s*([a-z]+)$/i.exec(s.trim()); return m && UNITS[m[2].toLowerCase()] ? Math.round(Number(m[1]) * UNITS[m[2].toLowerCase()]) : null; };

/** The processes of a server: its whole process group (the shell, npm, node…). */
async function serverStats(o: ObjectRow): Promise<ObjectStats> {
  const saved = readSaved(o.id);
  const empty: ObjectStats = { cpu: null, memBytes: null, memLimitBytes: null, pids: null, info: {} };
  if (!saved) return empty;
  const { out, code } = await run('ps', ['-axo', 'pgid=,pcpu=,rss=']);
  if (code !== 0) return empty;
  let cpu = 0, rss = 0, n = 0;
  for (const line of out.split('\n')) {
    const [g, c, r] = line.trim().split(/\s+/);
    if (Number(g) === saved.pid) { cpu += Number(c) || 0; rss += Number(r) || 0; n++; }
  }
  return n ? { cpu: Math.round(cpu * 10) / 10, memBytes: rss * 1024, memLimitBytes: null, pids: n, info: { pid: saved.pid, started: saved.startedAt } } : { ...empty, info: { pid: saved.pid, started: saved.startedAt } };
}

async function containerStats(name: string): Promise<ObjectStats> {
  const [st, ins] = await Promise.all([
    run('docker', ['stats', '--no-stream', '--format', '{{json .}}', name]),
    run('docker', ['inspect', '-f', '{{.Config.Image}}|{{.State.Status}}|{{.RestartCount}}|{{.Created}}|{{.State.StartedAt}}|{{.HostConfig.RestartPolicy.Name}}|{{.HostConfig.NetworkMode}}|{{.HostConfig.Memory}}|{{.HostConfig.NanoCpus}}', name]),
  ]);
  const info: ObjectStats['info'] = {};
  if (ins.code === 0) {
    const [image, status, restarts, created, started, policy, network, mem, nano] = ins.out.trim().split('|');
    Object.assign(info, { image, status, restarts: Number(restarts), created: Date.parse(created) || null, started: Date.parse(started) || null, restartPolicy: policy || 'no', network, memoryLimit: Number(mem) || 0, cpuLimit: Number(nano) ? Number(nano) / 1e9 : 0 });
  }
  const ports = await run('docker', ['port', name]); if (ports.code === 0) info.ports = ports.out.trim().split('\n').filter(Boolean).join(', ');
  let j: any = null; try { j = JSON.parse(st.out.trim().split('\n')[0] ?? ''); } catch { /* not running */ }
  if (!j) return { cpu: null, memBytes: null, memLimitBytes: null, pids: null, info };
  const [used, limit] = String(j.MemUsage ?? '').split('/');
  return { cpu: Number.parseFloat(j.CPUPerc) || 0, memBytes: bytes(used ?? ''), memLimitBytes: bytes(limit ?? ''), pids: Number(j.PIDs) || null, net: j.NetIO ?? null, block: j.BlockIO ?? null, info };
}

async function composeStats(c: DockerConfig): Promise<ObjectStats> {
  if (!existsSync(c.file!)) throw new ObjectError('The compose file is missing');
  const args = ['compose', '-f', c.file!, ...(c.project ? ['-p', c.project] : [])];
  const ps = await run('docker', [...args, 'ps', '--all', '--format', 'json', ...(c.services ?? [])], { cwd: dirname(c.file!) });
  const t = ps.out.trim();
  const items: any[] = t.startsWith('[') ? (() => { try { return JSON.parse(t); } catch { return []; } })() : t.split('\n').flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  const services = items.map((x) => ({ name: String(x.Service ?? x.Name ?? ''), state: String(x.State ?? ''), health: String(x.Health ?? ''), ports: String(x.Publishers ? (x.Publishers as any[]).filter((p) => p.PublishedPort).map((p) => `${p.PublishedPort}→${p.TargetPort}`).join(', ') : x.Ports ?? '') }));
  const ids = items.filter((x) => x.State === 'running').map((x) => String(x.ID ?? x.Name));
  let cpu = 0, mem = 0, pids = 0;
  if (ids.length) {
    const st = await run('docker', ['stats', '--no-stream', '--format', '{{json .}}', ...ids]);
    for (const l of st.out.trim().split('\n')) { try { const j = JSON.parse(l); cpu += Number.parseFloat(j.CPUPerc) || 0; mem += bytes(String(j.MemUsage).split('/')[0] ?? '') ?? 0; pids += Number(j.PIDs) || 0; } catch { /* a line that is not json */ } }
  }
  return { cpu: ids.length ? Math.round(cpu * 10) / 10 : null, memBytes: ids.length ? mem : null, memLimitBytes: null, pids: ids.length ? pids : null, info: { services: services.length, running: ids.length }, services };
}

export async function objectStats(o: ObjectRow): Promise<ObjectStats> {
  if (o.kind === 'server') return serverStats(o);
  if (o.kind !== 'docker') throw new ObjectError('This kind of object has no usage figures');
  const c = o.config as DockerConfig;
  return c.mode === 'compose' ? composeStats(c) : containerStats(c.mode === 'existing' ? c.container! : containerName(o.id));
}
