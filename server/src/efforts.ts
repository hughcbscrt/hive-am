import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './db.js';
import type { Provider } from './types.js';

/**
 * Reasoning effort: how hard the model thinks in a turn. Claude Code and Kiro take `--effort <level>`; OpenCode takes it as a variant of the
 * model (`provider/model#variant`) and the variants are whatever the chosen model has, so what OpenCode and Kiro report is learned and stored
 * on disk (`reasoning-efforts.json`), next to what is learned about context windows. An empty effort means the CLI's own default: no flag and no `#variant`.
 */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const validEffort = (v: unknown): v is string => typeof v === 'string' && (EFFORTS as readonly string[]).includes(v);
/** What an OpenCode variant id can look like (`0`..`5`, `none`, `high`, `xhigh`...). */
const VARIANT_ID = /^[\w.-]{1,24}$/;

/** One level a model takes. For OpenCode `id` is what goes after `#` and `level` the effort it stands for, when it says; for Kiro the id is the level. */
export interface Variant { id: string; level?: string }

const FILE = join(DATA_DIR, 'reasoning-efforts.json');
let known: Record<string, Variant[]> | null = null;
const key = (provider: Provider, model: string) => `${provider}:${model}`;
function load(): Record<string, Variant[]> {
  if (known) return known;
  try { known = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {}; } catch { known = {}; }
  return known!;
}

/** Remembers the levels models take. Writes the file only when something changed. A model with no levels is remembered as having none. */
export function learnEfforts(provider: Provider, models: Record<string, Variant[]>): void {
  const all = load(); let changed = false;
  for (const [model, variants] of Object.entries(models)) {
    if (!model || !Array.isArray(variants)) continue;
    const clean = variants.filter((v) => v && VARIANT_ID.test(String(v.id))).map((v) => ({ id: String(v.id), ...(typeof v.level === 'string' && v.level ? { level: v.level } : {}) }));
    const k = key(provider, model);
    if (JSON.stringify(all[k]) !== JSON.stringify(clean)) { all[k] = clean; changed = true; }
  }
  if (changed) { try { writeFileSync(FILE, JSON.stringify(all, null, 1)); } catch { /* best effort: it is learned again next time */ } }
}

/** What was learned about a model, or null when nothing was. */
export const learnedEfforts = (provider: Provider, model: string): Variant[] | null => load()[key(provider, model)] ?? null;

export interface EffortOptions {
  /** What can be chosen (besides the CLI's default). */
  options: Variant[];
  /** False when it is not known what this model takes (OpenCode before its catalog was read, or with no model chosen). */
  known: boolean;
}
/** The levels the form offers for a provider and (for OpenCode and Kiro) a model. */
export function effortOptions(provider: Provider, model: string): EffortOptions {
  const shared: Variant[] = EFFORTS.map((id) => ({ id, level: id }));
  if (provider === 'claude') return { options: shared, known: true };
  if (provider === 'kiro') {
    const learned = model ? learnedEfforts('kiro', model) : null;
    return learned && learned.length ? { options: learned.map((v) => ({ id: v.id, level: v.id })), known: true } : { options: shared, known: !!learned };
  }
  if (model.includes('#')) return { options: [], known: true };            // the model id carries its variant already: nothing is added to it
  const learned = model ? learnedEfforts('opencode', model) : null;
  return learned ? { options: learned, known: true } : { options: [], known: false };
}

/** Why an effort cannot be stored for this provider and model, or null when it can. An empty effort always can. */
export function checkEffort(provider: Provider, model: string, effort: unknown): string | null {
  if (effort === undefined || effort === null || effort === '') return null;
  if (typeof effort !== 'string') return 'effort must be text';
  if (provider === 'opencode') {
    if (model.includes('#')) return 'This model id already names its variant: leave the effort empty.';
    const learned = model ? learnedEfforts('opencode', model) : null;
    if (!learned) return VARIANT_ID.test(effort) ? null : `"${effort}" is not a variant name`;
    if (!learned.length) return `${model} takes no effort variant.`;
    return learned.some((v) => v.id === effort) ? null : `${model} has no "${effort}" variant (it has ${learned.map((v) => v.id).join(', ')}).`;
  }
  if (!validEffort(effort)) return `effort must be empty or one of ${EFFORTS.join(', ')}`;
  if (provider === 'kiro' && model) { const l = learnedEfforts('kiro', model); if (l && l.length && !l.some((v) => v.id === effort)) return `${model} takes ${l.map((v) => v.id).join(', ')}, not "${effort}".`; }
  return null;
}

/**
 * What to pass to the CLI for an effort asked at turn time (the agent's, or a connection's). A level that does not apply to the model comes
 * out empty (the CLI's default) instead of failing the turn; for OpenCode a level name is turned into the variant the model has for it.
 */
export function resolveEffort(provider: Provider, model: string, effort: string | undefined): string {
  if (!effort) return '';
  if (provider === 'opencode') {
    if (model.includes('#')) return '';
    const learned = model ? learnedEfforts('opencode', model) : null;
    if (!learned) return VARIANT_ID.test(effort) ? effort : '';
    return learned.find((v) => v.id === effort)?.id ?? learned.find((v) => v.level === effort)?.id ?? '';
  }
  return checkEffort(provider, model, effort) === null ? effort : '';
}
