import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './db.js';
import type { Provider } from './types.js';

/**
 * Size of each model's context window, learned from what the CLIs report: Claude says it in every result, Kiro lists it with its
 * models and OpenCode's server has a catalog. A saved conversation does not keep it, so what was learned is stored on disk
 * (`context-windows.json`) and used for any conversation of that model, also from before it was learned.
 */
const FILE = join(DATA_DIR, 'context-windows.json');
let known: Record<string, number> | null = null;
const key = (provider: Provider, model: string) => `${provider}:${model}`;

function load(): Record<string, number> {
  if (known) return known;
  try { known = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {}; } catch { known = {}; }
  return known!;
}

/** Remembers a model's window. Writes the file only when something changed. */
export function learnWindows(provider: Provider, windows: Record<string, number>): void {
  const all = load(); let changed = false;
  for (const [model, tokens] of Object.entries(windows)) {
    if (!model || !Number.isFinite(tokens) || tokens <= 0) continue;
    const k = key(provider, model);
    if (all[k] !== tokens) { all[k] = tokens; changed = true; }
  }
  if (changed) { try { writeFileSync(FILE, JSON.stringify(all, null, 1)); } catch { /* best effort: it is learned again next time */ } }
}

/**
 * The window of a model in tokens, or null when it is not known (the chat then shows tokens instead of a made-up percentage).
 * For a Claude model that was never seen on this machine it is derived from the id: Claude 5 and newer have 1M, older ones 200k,
 * and a `[1m]` suffix is the 1M variant.
 */
export function contextWindow(provider: Provider | undefined, model: string | undefined): number | null {
  if (!provider || !model || model.startsWith('<')) return null;
  const learned = load()[key(provider, model)];
  if (learned) return learned;
  if (provider !== 'claude') return null;
  if (/\[1m\]/i.test(model)) return 1_000_000;
  const major = /^claude-(?:opus|sonnet|haiku)-(\d+)/.exec(model)?.[1];
  if (major) return Number(major) >= 5 ? 1_000_000 : 200_000;
  return model.startsWith('claude-') ? 200_000 : null;
}
