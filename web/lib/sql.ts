import type { DbEngine, DbSchema, DbTable } from '@/lib/types';

export interface SqlItem { label: string; insert: string; hint?: string }
export interface SqlSug { items: SqlItem[]; from: number; to: number }
/** What the editor knows about the database: its tables, and (loaded on demand) the columns of each. */
export interface SqlCtx { schema: DbSchema | null; cols: (t: DbTable) => string[] | undefined; need: (t: DbTable) => void }

const KEYWORDS = ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS NULL', 'IS NOT NULL', 'LIKE', 'BETWEEN', 'EXISTS', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'ON', 'USING',
  'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'DISTINCT', 'AS', 'ASC', 'DESC', 'UNION', 'UNION ALL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'CAST',
  'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'NULL', 'TRUE', 'FALSE', 'WITH', 'TOP'];
const NOT_ALIAS = new Set(['where', 'on', 'join', 'inner', 'left', 'right', 'full', 'cross', 'group', 'order', 'limit', 'set', 'values', 'using', 'union', 'having', 'offset', 'natural', 'outer', 'select', 'and', 'or']);

const DIALECT: Record<DbEngine, 'mysql' | 'postgresql' | 'sqlite' | 'transactsql'> = { mysql: 'mysql', postgresql: 'postgresql', sqlite: 'sqlite', mssql: 'transactsql' };
/** Re-indents the statement (the selection, or everything), with upper-case keywords. Loaded on demand: it is a big library. */
export async function formatSql(sql: string, engine: DbEngine): Promise<string> {
  const { format } = await import('sql-formatter');
  return format(sql, { language: DIALECT[engine] ?? 'sql', keywordCase: 'upper', tabWidth: 2, linesBetweenQueries: 1 });
}

const unquote = (s: string) => s.replace(/^["`[]|["`\]]$/g, '');
const SAFE = /^[a-z_][a-z0-9_$]*$/;
const quoteName = (e: DbEngine, n: string) => (SAFE.test(n) ? n : e === 'mysql' ? `\`${n}\`` : e === 'mssql' ? `[${n}]` : `"${n}"`);
const DEFAULT_SCHEMAS = new Set(['public', 'dbo', 'main']);

interface Ref { table: DbTable; alias?: string }
/** The tables a statement reads from or writes to (FROM / JOIN / UPDATE / INTO), with the alias each one is given. */
function refsOf(text: string, tables: DbTable[]): Ref[] {
  const out: Ref[] = [];
  const re = /\b(?:from|join|update|into)\s+((?:["`[]?[\w$]+["`\]]?\.)?["`[]?[\w$]+["`\]]?)(?:\s+(?:as\s+)?([A-Za-z_]\w*))?/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const parts = m[1].split('.').map(unquote); const name = parts[parts.length - 1].toLowerCase(), sch = parts.length > 1 ? parts[0].toLowerCase() : '';
    const table = tables.find((t) => t.name.toLowerCase() === name && (!sch || t.schema.toLowerCase() === sch)); if (!table) continue;
    const alias = m[2] && !NOT_ALIAS.has(m[2].toLowerCase()) ? m[2] : undefined;
    out.push({ table, alias });
  }
  return out;
}

const rank = (label: string, q: string) => (label.toLowerCase().startsWith(q) ? 0 : 1);

/**
 * What can be suggested at the caret: after `schema.` its tables, after `table.` or `alias.` its columns, after FROM / JOIN / UPDATE / INTO
 * the tables and schemas, and anywhere else the columns of the tables in the statement, the tables and the SQL keywords.
 * `explicit` (Ctrl+Space) also suggests with nothing typed yet.
 */
export function suggestSql(text: string, caret: number, ctx: SqlCtx, explicit = false): SqlSug | null {
  const engine = ctx.schema?.engine ?? 'postgresql';
  const tables = ctx.schema?.tables ?? [];
  const head = text.slice(0, caret);
  const word = /[\w$]*$/.exec(head)![0], from = caret - word.length, before = head.slice(0, from);
  const ls = head.lastIndexOf('\n') + 1;
  if (/--/.test(head.slice(ls)) || (head.split("'").length - 1) % 2 === 1 || (head.lastIndexOf('/*') > head.lastIndexOf('*/'))) return null; // in a comment or a string
  const q = word.toLowerCase();
  const stmt = text.slice(Math.max(text.lastIndexOf(';', caret - 1) + 1, 0), (() => { const e = text.indexOf(';', caret); return e < 0 ? text.length : e; })());
  const qual = /(["`[]?[\w$]+["`\]]?)\.$/.exec(before);
  const done = (items: SqlItem[]) => { const f = items.filter((i) => !q || (i.label.toLowerCase().includes(q) && i.label.toLowerCase() !== q)).sort((a, b) => rank(a.label, q) - rank(b.label, q)).slice(0, 14); return f.length ? { items: f, from, to: caret } : null; };

  if (qual) {
    const name = unquote(qual[1]).toLowerCase();
    const bySchema = tables.filter((t) => t.schema.toLowerCase() === name);
    if (bySchema.length) return done(bySchema.map((t) => ({ label: t.name, insert: quoteName(engine, t.name), hint: t.type === 'view' ? 'view' : 'table' })));
    const ref = refsOf(stmt, tables).find((r) => (r.alias ?? '').toLowerCase() === name || r.table.name.toLowerCase() === name);
    if (!ref) return null;
    const cols = ctx.cols(ref.table); if (!cols) { ctx.need(ref.table); return null; }
    return done(cols.map((c) => ({ label: c, insert: quoteName(engine, c), hint: ref.table.name })));
  }
  if (!word && !explicit) return null;
  const expectTable = /\b(from|join|update|into|table)\s+$/i.test(before);
  const asTable = (t: DbTable): SqlItem => ({ label: t.name, insert: engine !== 'sqlite' && engine !== 'mysql' && !DEFAULT_SCHEMAS.has(t.schema) ? `${quoteName(engine, t.schema)}.${quoteName(engine, t.name)}` : quoteName(engine, t.name), hint: engine === 'sqlite' || engine === 'mysql' || DEFAULT_SCHEMAS.has(t.schema) ? (t.type === 'view' ? 'view' : undefined) : t.schema });
  const schemas = [...new Set(tables.map((t) => t.schema))].filter((s) => engine !== 'sqlite' && engine !== 'mysql' && tables.some((t) => t.schema === s));
  const items: SqlItem[] = [];
  if (!expectTable) {
    for (const r of refsOf(stmt, tables)) {
      const cols = ctx.cols(r.table); if (!cols) { ctx.need(r.table); continue; }
      for (const c of cols) if (!items.some((i) => i.label === c)) items.push({ label: c, insert: quoteName(engine, c), hint: r.alias ?? r.table.name });
    }
  }
  for (const t of tables) items.push(asTable(t));
  for (const s of schemas) items.push({ label: s, insert: quoteName(engine, s), hint: 'schema' });
  if (!expectTable) {
    const lower = word !== '' && word === word.toLowerCase();
    for (const k of KEYWORDS) items.push({ label: lower ? k.toLowerCase() : k, insert: `${lower ? k.toLowerCase() : k} `, hint: 'SQL' });
  }
  return done(items);
}
