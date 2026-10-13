'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import type { DatabaseConfig, DbHistoryEntry, DbResult, DbSaved, DbSchema, DbTable, DbTableColumn, ObjectView } from '@/lib/types';
import { useToast } from '@/components/ui';
import { formatSql, type SqlCtx } from '@/lib/sql';
import { selectFrom } from './db/dbSql';
import { QueryPane } from './db/QueryPane';
import { SchemaPane } from './db/SchemaPane';
import { HistoryPane } from './db/HistoryPane';
import { NameModal } from './db/NameModal';

export type DbPane = 'query' | 'schema' | 'history';
export { selectFrom };

/**
 * A database object on its screens (Queries, Schema, History): the three share what is typed, the database that is picked, the last result and
 * the schema, so going from a table to its rows and back keeps everything.
 */
export function DbWorkspace({ object: o, pane, onPane }: { object: ObjectView; pane: DbPane; onPane: (p: DbPane) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const cfg = o.config as DatabaseConfig;
  const key = `hive-am.dbq.${o.id}`;
  const [sql, setSqlState] = useState('');
  const [database, setDatabase] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DbResult | null>(null);
  const [error, setError] = useState('');
  const [schema, setSchema] = useState<DbSchema | null>(null);
  const [schemaErr, setSchemaErr] = useState('');
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [saved, setSaved] = useState<DbSaved[]>([]);
  const [hist, setHist] = useState<DbHistoryEntry[] | null>(null);
  const [naming, setNaming] = useState(false);
  const area = useRef<HTMLTextAreaElement | null>(null);
  // The columns of each table, loaded when the editor asks for them (to suggest them), kept while the database is the same.
  const colCache = useRef(new Map<string, string[] | 'loading'>());
  const [, bump] = useState(0);
  const colKey = (tb: DbTable) => `${database ?? ''}|${tb.schema}.${tb.name}`;
  const ctx = useMemo<SqlCtx>(() => ({
    schema,
    cols: (tb) => { const c = colCache.current.get(colKey(tb)); return Array.isArray(c) ? c : undefined; },
    need: (tb) => {
      const k = colKey(tb); if (colCache.current.has(k)) return; colCache.current.set(k, 'loading');
      const cur = database ?? schema?.database;
      api.get<DbTableColumn[]>(`/objects/${o.id}/db/columns?schema=${encodeURIComponent(tb.schema)}&table=${encodeURIComponent(tb.name)}${cur && schema && schema.engine !== 'sqlite' ? `&database=${encodeURIComponent(cur)}` : ''}`)
        .then((c) => colCache.current.set(k, c.map((x) => x.name))).catch(() => colCache.current.delete(k)).finally(() => bump((n) => n + 1));
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [schema, database, o.id]);
  useEffect(() => { colCache.current.clear(); }, [o.id, o.updated_at, database]);
  const pick = useRef<{ from: number; to: number } | null>(null);

  useEffect(() => { try { setSqlState(localStorage.getItem(key) ?? ''); } catch { /* none */ } }, [key]);
  const setSql = (v: string) => { setSqlState(v); try { localStorage.setItem(key, v); } catch { /* none */ } };

  const loadSchema = useCallback(async (db?: string) => {
    setLoadingSchema(true); setSchemaErr('');
    try { const s = await api.get<DbSchema>(`/objects/${o.id}/db/schema${db ? `?database=${encodeURIComponent(db)}` : ''}`); setSchema(s); }
    catch (e) { setSchemaErr(e instanceof Error ? e.message : ''); } finally { setLoadingSchema(false); }
  }, [o.id]);
  const loadHistory = useCallback(() => { api.get<DbHistoryEntry[]>(`/objects/${o.id}/db/history`).then(setHist).catch(() => setHist([])); api.get<DbSaved[]>(`/objects/${o.id}/db/saved`).then(setSaved).catch(() => undefined); }, [o.id]);
  useEffect(() => { void loadSchema(database); }, [loadSchema, database, o.updated_at]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const run = async (text?: string) => {
    const el = area.current;
    const chosen = el && el.selectionEnd > el.selectionStart ? sql.slice(el.selectionStart, el.selectionEnd) : sql;     // a selection runs on its own
    const q = (text ?? chosen).trim();
    if (!q || busy) return;
    setBusy(true); setError('');
    try { const r = await api.post<DbResult>(`/objects/${o.id}/db/query`, { sql: q, database }); setResult(r); }
    catch (e) { setResult(null); setError(e instanceof Error ? e.message : ''); }
    finally { setBusy(false); loadHistory(); }
  };
  const openTable = (tb: DbTable) => { const q = selectFrom(schema?.engine ?? cfg.engine, tb); setSql(q); onPane('query'); void run(q); };
  /** A query from the history or the saved ones goes at the end of the editor (what you already typed stays) and is left selected, so Ctrl+Enter runs just it. */
  const use = (q: string, db?: string) => {
    const base = sql.trimEnd(); const lead = base ? `${base}\n\n` : '';
    setSql(lead + q); pick.current = { from: lead.length, to: lead.length + q.length };
    if (db !== undefined) setDatabase(db); onPane('query');
  };
  useEffect(() => {
    const r = pick.current, el = area.current; if (!r || !el || pane !== 'query') return;
    pick.current = null;
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(r.from, r.to); el.scrollTop = el.scrollHeight; });
  });
  const format = async () => {
    const el = area.current; const sel = el && el.selectionEnd > el.selectionStart;
    try {
      if (sel && el) { const out = await formatSql(sql.slice(el.selectionStart, el.selectionEnd), schema?.engine ?? cfg.engine); setSql(sql.slice(0, el.selectionStart) + out + sql.slice(el.selectionEnd)); }
      else setSql(await formatSql(sql, schema?.engine ?? cfg.engine));
    } catch (e) { toast(t('db.format.fail', { error: e instanceof Error ? e.message.split('\n')[0] : '' }), 'err'); }
  };
  const save = async (name: string) => {
    try { await api.post(`/objects/${o.id}/db/saved`, { name, sql, database }); toast(t('db.saved.done')); loadHistory(); }
    catch (e) { toast(e instanceof Error ? e.message : '', 'err'); }
  };

  return (
    <div className="dbw">
      {pane === 'query' && (
        <QueryPane o={o} sql={sql} setSql={setSql} area={area} run={() => void run()} format={() => void format()} ctx={ctx} busy={busy} result={result} error={error} schema={schema}
          database={database} setDatabase={setDatabase} saved={saved} onSave={() => setNaming(true)} onUse={use} onManage={() => onPane('history')} />
      )}
      {pane === 'schema' && <SchemaPane o={o} schema={schema} err={schemaErr} loading={loadingSchema} onReload={() => void loadSchema(database)} database={database} setDatabase={setDatabase} onOpen={openTable} />}
      {pane === 'history' && <HistoryPane o={o} hist={hist} saved={saved} sql={sql} database={database} onUse={use} onChanged={loadHistory} />}
      {naming && <NameModal onClose={() => setNaming(false)} onSave={(n) => { setNaming(false); void save(n); }} />}
    </div>
  );
}

