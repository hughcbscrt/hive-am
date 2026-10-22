import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Provider } from '../types.js';

const exec = promisify(execFile);
export const PROVIDERS: Record<Provider, { bin: string; label: string }> = {
  claude: { bin: 'claude', label: 'Claude Code' },
  opencode: { bin: 'opencode', label: 'OpenCode' },
  kiro: { bin: 'kiro-cli', label: 'Kiro' },
  cursor: { bin: 'cursor-agent', label: 'Cursor' },
};
/** Own keys only: `"constructor" in PROVIDERS` is true. */
export const isProvider = (v: unknown): v is Provider => typeof v === 'string' && Object.hasOwn(PROVIDERS, v);

export interface ProviderStatus { id: Provider; label: string; installed: boolean; version: string }
let providerCache: { at: number; data: ProviderStatus[] } | null = null;
/** Which CLIs are installed. Probing spawns processes, so the answer is kept for a minute. */
export async function providerStatus(): Promise<ProviderStatus[]> {
  if (providerCache && Date.now() - providerCache.at < 60_000) return providerCache.data;
  const data = await Promise.all((Object.keys(PROVIDERS) as Provider[]).map(async (id): Promise<ProviderStatus> => {
    try {
      const { stdout } = await exec(PROVIDERS[id].bin, ['--version'], { timeout: 8000 });
      return { id, label: PROVIDERS[id].label, installed: true, version: stdout.trim().split('\n')[0].slice(0, 60) };
    } catch { return { id, label: PROVIDERS[id].label, installed: false, version: '' }; }
  }));
  providerCache = { at: Date.now(), data };
  return data;
}
