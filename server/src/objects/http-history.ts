import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../db.js';
import type { HttpRun } from './http.js';

/**
 * The runs of an HTTP object, kept on disk so they survive a restart: the last HISTORY_MAX, newest first. Bodies are cut to BODY_MAX
 * characters so the file stays small (the request, status, headers, tests and the start of the answer are kept).
 */
export interface HistoryEntry { n: number; at: number; file: string; index: number; name: string; method: string; env: string; run?: HttpRun; error?: string }
const HISTORY_MAX = 100, BODY_MAX = 100_000;
const DIR = join(DATA_DIR, 'http-history');
const fileOf = (id: string) => join(DIR, `${id.replace(/[^\w-]/g, '')}.json`);
const cache = new Map<string, HistoryEntry[]>();

function load(id: string): HistoryEntry[] {
  let list = cache.get(id);
  if (!list) { try { list = existsSync(fileOf(id)) ? (JSON.parse(readFileSync(fileOf(id), 'utf8')) as HistoryEntry[]) : []; } catch { list = []; } cache.set(id, list); }
  return list;
}
function save(id: string, list: HistoryEntry[]) {
  try { mkdirSync(DIR, { recursive: true }); const tmp = `${fileOf(id)}.tmp`; writeFileSync(tmp, JSON.stringify(list)); renameSync(tmp, fileOf(id)); } catch { /* the history is a convenience: never break a run for it */ }
}

export function recordRun(id: string, e: Omit<HistoryEntry, 'n' | 'at'>): HistoryEntry {
  const list = load(id);
  const run = e.run ? { ...e.run, body: e.run.body.length > BODY_MAX ? e.run.body.slice(0, BODY_MAX) : e.run.body, truncated: e.run.truncated || e.run.body.length > BODY_MAX } : undefined;
  const entry: HistoryEntry = { ...e, run, n: (list[0]?.n ?? 0) + 1, at: Date.now() };
  list.unshift(entry); if (list.length > HISTORY_MAX) list.length = HISTORY_MAX;
  save(id, list);
  return entry;
}
export const listHistory = (id: string): HistoryEntry[] => load(id);
export function clearHistory(id: string) { cache.delete(id); try { rmSync(fileOf(id), { force: true }); } catch { /* nothing to remove */ } }
