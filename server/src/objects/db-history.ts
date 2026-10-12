import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR } from '../db.js';

/**
 * What a database object remembers, on disk so it survives a restart: the queries that were run (the last 200, newest first; the text is
 * cut at 20,000 characters, the rows are never kept) and the queries the person saved with a name.
 */
export interface DbHistoryEntry { n: number; at: number; sql: string; database?: string; ok: boolean; ms: number; rows?: number; affected?: number; error?: string }
export interface DbSaved { id: string; name: string; sql: string; database?: string; at: number }
const HISTORY_MAX = 200, SQL_MAX = 20_000, SAVED_MAX = 100;
const dirOf = (kind: 'db-history' | 'db-saved') => join(DATA_DIR, kind);
const fileOf = (kind: 'db-history' | 'db-saved', id: string) => join(dirOf(kind), `${id.replace(/[^\w-]/g, '')}.json`);
const cache = new Map<string, unknown[]>();

function load<T>(kind: 'db-history' | 'db-saved', id: string): T[] {
  const key = `${kind}/${id}`; let list = cache.get(key) as T[] | undefined;
  if (!list) { try { list = existsSync(fileOf(kind, id)) ? (JSON.parse(readFileSync(fileOf(kind, id), 'utf8')) as T[]) : []; } catch { list = []; } cache.set(key, list); }
  return list;
}
function save(kind: 'db-history' | 'db-saved', id: string, list: unknown[]) {
  try { mkdirSync(dirOf(kind), { recursive: true }); const f = fileOf(kind, id), tmp = `${f}.tmp`; writeFileSync(tmp, JSON.stringify(list)); renameSync(tmp, f); } catch { /* a convenience: never breaks a query */ }
}

export function recordQuery(id: string, e: Omit<DbHistoryEntry, 'n' | 'at'>): void {
  const list = load<DbHistoryEntry>('db-history', id);
  list.unshift({ ...e, sql: e.sql.length > SQL_MAX ? e.sql.slice(0, SQL_MAX) : e.sql, n: (list[0]?.n ?? 0) + 1, at: Date.now() });
  if (list.length > HISTORY_MAX) list.length = HISTORY_MAX;
  save('db-history', id, list);
}
export const listQueries = (id: string) => load<DbHistoryEntry>('db-history', id);
export const clearQueries = (id: string) => { cache.delete(`db-history/${id}`); try { rmSync(fileOf('db-history', id), { force: true }); } catch { /* none */ } };

export const listSaved = (id: string) => load<DbSaved>('db-saved', id);
export function addSaved(id: string, p: { name: string; sql: string; database?: string }): DbSaved {
  const list = load<DbSaved>('db-saved', id);
  if (list.length >= SAVED_MAX) throw new Error(`At most ${SAVED_MAX} saved queries`);
  const e: DbSaved = { id: randomUUID(), name: p.name, sql: p.sql.slice(0, SQL_MAX), database: p.database, at: Date.now() };
  list.unshift(e); save('db-saved', id, list); return e;
}
/** Renames a saved query and/or replaces its text (and database); it keeps its place in the list. */
export function updateSaved(id: string, savedId: string, p: { name?: string; sql?: string; database?: string | null }): DbSaved | undefined {
  const list = load<DbSaved>('db-saved', id), e = list.find((x) => x.id === savedId);
  if (!e) return undefined;
  if (p.name !== undefined) e.name = p.name;
  if (p.sql !== undefined) e.sql = p.sql.slice(0, SQL_MAX);
  if (p.database !== undefined) e.database = p.database ?? undefined;
  save('db-saved', id, list); return e;
}
export function removeSaved(id: string, savedId: string): boolean {
  const list = load<DbSaved>('db-saved', id), i = list.findIndex((x) => x.id === savedId);
  if (i < 0) return false; list.splice(i, 1); save('db-saved', id, list); return true;
}
export function forgetQueries(id: string) { clearQueries(id); cache.delete(`db-saved/${id}`); try { rmSync(fileOf('db-saved', id), { force: true }); } catch { /* none */ } }
