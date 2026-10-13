import { execFile } from 'node:child_process';

export interface ExecResult { out: string; err: string; code: number; /** The program is not installed (or not in the PATH). */ missing: boolean; /** It was cut off by the timeout. */ timedOut: boolean }

/**
 * Runs a program without a shell (every value is one argument) and always resolves: output, exit code and whether it was missing or
 * timed out. Callers decide what each case means for them. A death by signal or an overflowed buffer counts as a failure (code 1).
 */
export function execCapture(file: string, args: string[], o: { cwd?: string; timeout?: number; maxBuffer?: number; env?: NodeJS.ProcessEnv } = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(file, args, { cwd: o.cwd, timeout: o.timeout ?? 15_000, maxBuffer: o.maxBuffer ?? 8 * 1024 * 1024, env: o.env, encoding: 'utf8' }, (e: any, stdout, stderr) => {
      resolve({
        out: String(stdout ?? ''), err: String(stderr ?? ''),
        code: e ? (typeof e.code === 'number' ? e.code : 1) : 0,
        missing: e?.code === 'ENOENT', timedOut: !!e?.killed && e?.code !== 'ENOENT',
      });
    });
  });
}
