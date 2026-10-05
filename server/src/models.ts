import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Provider } from './types.js';

const run = promisify(execFile);
const cache = new Map<Provider, { at: number; models: ModelInfo[] }>();
export interface ModelInfo { id: string; label: string }

const CLAUDE: ModelInfo[] = [
  { id: 'opus', label: 'Opus (latest)' },
  { id: 'sonnet', label: 'Sonnet (latest)' },
  { id: 'haiku', label: 'Haiku (latest)' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
];

async function discover(p: Provider): Promise<ModelInfo[]> {
  try {
    if (p === 'claude') return CLAUDE;
    if (p === 'opencode') {
      const { stdout } = await run('opencode', ['models'], { timeout: 20000, maxBuffer: 4e6 });
      return stdout.split('\n').map((s) => s.trim()).filter((s) => /^[\w.-]+\/\S+/.test(s)).map((id) => ({ id, label: id }));
    }
    const { stdout } = await run('kiro-cli', ['chat', '--list-models', '--format', 'json'], { timeout: 20000, maxBuffer: 4e6 });
    const j = JSON.parse(stdout);
    const list: any[] = Array.isArray(j) ? j : j.models ?? [];
    return list.map((m) => ({ id: m.model_id ?? m.id ?? m.name, label: m.model_name ?? m.name ?? m.model_id ?? m.id })).filter((m) => m.id);
  } catch {
    return [];
  }
}

export async function listModels(p: Provider): Promise<ModelInfo[]> {
  const hit = cache.get(p);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.models;
  const models = await discover(p);
  if (models.length) cache.set(p, { at: Date.now(), models });
  return models;
}
