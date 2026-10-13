import type { DbEngine, DbResult, DbTable } from '@/lib/types';

const quote = (e: DbEngine, n: string) => (e === 'mysql' ? `\`${n.replace(/`/g, '``')}\`` : e === 'mssql' ? `[${n.replace(/]/g, ']]')}]` : `"${n.replace(/"/g, '""')}"`);
/** The statement that shows the first rows of a table, written the way the engine wants it. */
export function selectFrom(e: DbEngine, t: DbTable): string {
  const from = e === 'sqlite' ? quote(e, t.name) : `${quote(e, t.schema)}.${quote(e, t.name)}`;
  return e === 'mssql' ? `SELECT TOP 100 * FROM ${from}` : `SELECT * FROM ${from} LIMIT 100`;
}
const csvCell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (r: DbResult) => [r.columns.map((c) => csvCell(c.name)).join(','), ...r.rows.map((row) => row.map(csvCell).join(','))].join('\n');
export const toJson = (r: DbResult) => JSON.stringify(r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c.name, row[i]]))), null, 2);
