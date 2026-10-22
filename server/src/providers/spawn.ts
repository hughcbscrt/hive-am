import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/** A CLI that prints nothing for this long has hung (a long turn is fine as long as it keeps emitting). */
const STALL_MS = () => Number(process.env.HIVE_AM_TURN_STALL_MS) || 10 * 60_000;
const quietFor = (ms: number) => ms >= 60_000 ? `${Math.round(ms / 6000) / 10} minutes` : `${Math.round(ms / 100) / 10} seconds`;
const KILL_GRACE_MS = Number(process.env.HIVE_AM_KILL_GRACE_MS) || 5000;

/** The CLI hung and was cut off; adapters must not replace this reason with an error the dying CLI printed. */
export class StalledError extends Error {}

export interface SpawnOpts {
  cmd: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  stdin?: string;
  signal: AbortSignal;
  /** The error quotes the start of stderr instead of its end (a CLI that prints the reason and then a long list). */
  stderrHead?: boolean;
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

  // Silence, not length: the timer restarts on every stdout line and, when it fires, ends the CLI like a Stop would, but the turn fails with its own text.
  let stalled = false;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  const armStall = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => { stalled = true; kill(); }, STALL_MS());
    stallTimer.unref?.();
  };
  armStall();

  let stderr = ''; let head = '';
  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); if (head.length < 600) head = (head + d).slice(0, 600); });
  const exit = new Promise<number | null>((res) => {
    child.on('error', (e) => { stderr += String(e); res(-1); });
    // 'exit' (not 'close'): a daemon the CLI forks (e.g. opencode's background service) can keep
    // inheriting our stdout pipe forever, so 'close' would never fire. Drain briefly, then cut the pipe.
    child.on('exit', (c) => { if (hardKill) clearTimeout(hardKill); setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); }, 250); res(c); });
  });

  child.stdin.on('error', () => { /* the CLI quit before reading its prompt: its exit code tells why */ });
  if (o.stdin !== undefined) child.stdin.end(o.stdin); else child.stdin.end();

  try {
    // readline only ends on the stream's 'end'; a stream we destroy (the exit handler above) emits 'close' alone, so close it ourselves.
    const rl = createInterface({ input: child.stdout });
    child.stdout.on('close', () => rl.close());
    for await (const line of rl) { armStall(); if (line.trim()) yield line; }
  } finally {
    clearTimeout(stallTimer);
    o.signal.removeEventListener('abort', kill);
    kill();
  }
  const code = await exit;
  if (stalled && !o.signal.aborted) throw new StalledError(`${o.cmd} stopped answering (nothing on stdout for ${quietFor(STALL_MS())})`);
  const said = o.stderrHead ? head.trim() : stderr.trim().slice(-600);
  if (code !== 0 && !o.signal.aborted) throw new Error(`${o.cmd} exited with code ${code}${said ? `: ${said}` : ''}`);
}

export function safeJson(line: string): any | null {
  try { return JSON.parse(line); } catch { return null; }
}

/**
 * The JSON objects a CLI prints, one per line; lines that are not JSON (banners, warnings) are skipped.
 * A CLI that exits cleanly having printed only prose (its usage text, say) has not answered: that is an error carrying its first line.
 */
export async function* spawnJson(o: SpawnOpts): AsyncGenerator<any> {
  let events = 0;
  let firstNoise = '';
  for await (const line of spawnLines(o)) {
    const ev = safeJson(line);
    if (ev) { events++; yield ev; } else firstNoise ||= line.trim();
  }
  if (!events && firstNoise && !o.signal.aborted) throw new Error(`${o.cmd} produced no events, it printed: ${firstNoise.slice(0, 300)}`);
}

/** The text of a tool result, which CLIs send as a string, a list of blocks or any other JSON. */
export function flattenText(c: unknown): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x: any) => (typeof x === 'string' ? x : x?.text ?? '')).join('\n');
  return c == null ? '' : JSON.stringify(c);
}
