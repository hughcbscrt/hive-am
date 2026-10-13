import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const KILL_GRACE_MS = Number(process.env.HIVE_AM_KILL_GRACE_MS) || 5000;

export interface SpawnOpts {
  cmd: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  stdin?: string;
  signal: AbortSignal;
}

/** Spawns a CLI and yields its stdout lines. Throws with stderr tail if it exits non-zero and nothing aborted it. */
export async function* spawnLines(o: SpawnOpts): AsyncGenerator<string> {
  const child = spawn(o.cmd, o.args, {
    cwd: o.cwd,
    // PWD is inherited from the hive-am server and some CLIs (OpenCode) trust it over the real cwd, so set it explicitly.
    env: { ...process.env, PWD: o.cwd, ...o.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  // SIGTERM first; a CLI that ignores it (busy inside a tool) is cut off after a grace period so a stopped turn never leaves a process behind.
  let hardKill: ReturnType<typeof setTimeout> | undefined;
  const kill = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (!child.killed) child.kill('SIGTERM');
    hardKill ??= setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, KILL_GRACE_MS);
    hardKill.unref?.();
  };
  o.signal.addEventListener('abort', kill, { once: true });

  let stderr = '';
  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
  const exit = new Promise<number | null>((res) => {
    child.on('error', (e) => { stderr += String(e); res(-1); });
    // 'exit' (not 'close'): a daemon the CLI forks (e.g. opencode's background service) can keep
    // inheriting our stdout pipe forever, so 'close' would never fire. Drain briefly, then cut the pipe.
    child.on('exit', (c) => { if (hardKill) clearTimeout(hardKill); setTimeout(() => child.stdout.destroy(), 250); res(c); });
  });

  child.stdin.on('error', () => { /* the CLI quit before reading its prompt: its exit code tells why */ });
  if (o.stdin !== undefined) child.stdin.end(o.stdin); else child.stdin.end();

  try {
    for await (const line of createInterface({ input: child.stdout })) if (line.trim()) yield line;
  } finally {
    o.signal.removeEventListener('abort', kill);
    kill();
  }
  const code = await exit;
  if (code !== 0 && !o.signal.aborted) throw new Error(`${o.cmd} exited with code ${code}${stderr ? `: ${stderr.trim().slice(-600)}` : ''}`);
}

export function safeJson(line: string): any | null {
  try { return JSON.parse(line); } catch { return null; }
}

/** The JSON objects a CLI prints, one per line; lines that are not JSON (banners, warnings) are skipped. */
export async function* spawnJson(o: SpawnOpts): AsyncGenerator<any> {
  for await (const line of spawnLines(o)) { const ev = safeJson(line); if (ev) yield ev; }
}

/** The text of a tool result, which CLIs send as a string, a list of blocks or any other JSON. */
export function flattenText(c: unknown): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x: any) => (typeof x === 'string' ? x : x?.text ?? '')).join('\n');
  return c == null ? '' : JSON.stringify(c);
}
