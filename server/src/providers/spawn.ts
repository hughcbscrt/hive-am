import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

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
  const kill = () => { if (!child.killed) child.kill('SIGTERM'); };
  o.signal.addEventListener('abort', kill, { once: true });

  let stderr = '';
  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
  const exit = new Promise<number | null>((res) => {
    child.on('error', (e) => { stderr += String(e); res(-1); });
    // 'exit' (not 'close'): a daemon the CLI forks (e.g. opencode's background service) can keep
    // inheriting our stdout pipe forever, so 'close' would never fire. Drain briefly, then cut the pipe.
    child.on('exit', (c) => { setTimeout(() => child.stdout.destroy(), 250); res(c); });
  });

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
