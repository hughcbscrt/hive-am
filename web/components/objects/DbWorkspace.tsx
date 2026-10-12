'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { BookMarked, ChevronDown, ChevronRight, Copy, Download, Loader2, Play, RefreshCw, Save, Search, Table2, Trash2, Eye, Lock, Unlock } from 'lucide-react';
import { api } from '@/lib/api';
import { ago } from '@/lib/meta';
import { useI18n } from '@/lib/i18n/index';
import { useGitPrefs } from '@/lib/git/gitPrefs';
import type { DatabaseConfig, DbEngine, DbHistoryEntry, DbResult, DbSaved, DbSchema, DbTable, DbTableColumn, ObjectView } from '@/lib/types';
import { Modal, useToast } from '@/components/ui';
import { CodeEditor } from '@/components/git/CodeEditor';
import { GitSettings } from '@/components/git/GitSettings';
import { HelpPopover } from '@/components/HelpPopover';
import { Menu, MenuGroup, MenuItem } from '@/components/Menu';

export type DbPane = 'query' | 'schema' | 'history';
const SHOWN_STEP = 500;

const quote = (e: DbEngine, n: string) => (e === 'mysql' ? `\`${n.replace(/`/g, '``')}\`` : e === 'mssql' ? `[${n.replace(/]/g, ']]')}]` : `"${n.replace(/"/g, '""')}"`);
/** The statement that shows the first rows of a table, written the way the engine wants it. */
export function selectFrom(e: DbEngine, t: DbTable): string {
  const from = e === 'sqlite' ? quote(e, t.name) : `${quote(e, t.schema)}.${quote(e, t.name)}`;
  return e === 'mssql' ? `SELECT TOP 100 * FROM ${from}` : `SELECT * FROM ${from} LIMIT 100`;
}
const csvCell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (r: DbResult) => [r.columns.map((c) => csvCell(c.name)).join(','), ...r.rows.map((row) => row.map(csvCell).join(','))].join('\n');
const toJson = (r: DbResult) => JSON.stringify(r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c.name, row[i]]))), null, 2);

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
  const use = (q: string, db?: string) => { setSql(q); if (db !== undefined) setDatabase(db); onPane('query'); };
  const save = async (name: string) => {
    try { await api.post(`/objects/${o.id}/db/saved`, { name, sql, database }); toast(t('db.saved.done')); loadHistory(); }
    catch (e) { toast(e instanceof Error ? e.message : '', 'err'); }
  };

  return (
    <div className="dbw">
      {pane === 'query' && (
        <QueryPane o={o} sql={sql} setSql={setSql} area={area} run={() => void run()} busy={busy} result={result} error={error} schema={schema}
          database={database} setDatabase={setDatabase} saved={saved} onSave={() => setNaming(true)} onUse={use} />
      )}
      {pane === 'schema' && <SchemaPane o={o} schema={schema} err={schemaErr} loading={loadingSchema} onReload={() => void loadSchema(database)} database={database} setDatabase={setDatabase} onOpen={openTable} />}
      {pane === 'history' && <HistoryPane o={o} hist={hist} saved={saved} onUse={use} onChanged={loadHistory} />}
      {naming && <NameModal onClose={() => setNaming(false)} onSave={(n) => { setNaming(false); void save(n); }} />}
    </div>
  );
}

function ReadOnlyBadge({ cfg }: { cfg: DatabaseConfig }) {
  const { t } = useI18n();
  return cfg.readOnly !== false
    ? <span className="db-badge ro" title={t('db.readonly.on')}><Lock size={12} />{t('db.readonly.badge')}</span>
    : <span className="db-badge rw" title={t('db.readonly.off')}><Unlock size={12} />{t('db.write.badge')}</span>;
}

function QueryPane({ o, sql, setSql, area, run, busy, result, error, schema, database, setDatabase, saved, onSave, onUse }: {
  o: ObjectView; sql: string; setSql: (v: string) => void; area: MutableRefObject<HTMLTextAreaElement | null>; run: () => void; busy: boolean; result: DbResult | null; error: string;
  schema: DbSchema | null; database?: string; setDatabase: (d: string | undefined) => void; saved: DbSaved[]; onSave: () => void; onUse: (q: string, db?: string) => void;
}) {
  const { t } = useI18n();
  const prefs = useGitPrefs();
  const cfg = o.config as DatabaseConfig;
  const dbs = schema?.databases ?? [];
  return (
    <div className="dbq">
      <div className="dbq-bar">
        <button className="btn primary sm" disabled={busy || !sql.trim()} onClick={run} title="Ctrl/⌘ + Enter">{busy ? <Loader2 size={14} className="spin" /> : <Play size={14} />}{busy ? t('db.running') : t('db.run')}</button>
        <button className="btn sm" disabled={!sql.trim()} onClick={onSave}><Save size={14} />{t('db.save')}</button>
        <Menu label={t('db.saved')} icon={<BookMarked size={14} />}>{(close) => (<>
          {saved.length === 0 ? <p className="muted small" style={{ margin: 8, maxWidth: 240 }}>{t('db.saved.none')}</p>
            : <MenuGroup label={t('db.saved.title')}>{saved.map((s) => <MenuItem key={s.id} hint={s.sql.replace(/\s+/g, ' ').slice(0, 70)} onClick={() => { close(); onUse(s.sql, s.database); }}>{s.name}</MenuItem>)}</MenuGroup>}
        </>)}</Menu>
        {dbs.length > 1 && (
          <select className="select db-pick" value={database ?? schema?.database ?? ''} onChange={(e) => setDatabase(e.target.value)} aria-label={t('db.database.pick')} title={t('db.database.pick')}>
            {dbs.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        <span className="grow" />
        <ReadOnlyBadge cfg={cfg} />
        <HelpPopover size="sm" label={t('common.help')} title={t('db.help.title')}><p>{t('db.help.1')}</p><p>{t('db.help.2')}</p></HelpPopover>
        <GitSettings compact />
      </div>
      <div className="db-ed gx" data-gx-theme={prefs.theme} style={{ ['--g-tab' as never]: prefs.tabSize }}>
        <CodeEditor value={sql} onChange={setSql} path="query.sql" areaRef={area} label={t('db.editor')}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); } }} />
      </div>
      <div className="dbq-res">
        {busy && !result && !error ? <p className="muted small db-note"><Loader2 size={14} className="spin" /> {t('db.running')}</p>
          : error ? <div className="gx-note err db-err">{error}</div>
          : result ? <Results result={result} /> : <p className="muted small db-note">{t('db.result.none')}</p>}
      </div>
    </div>
  );
}

function Results({ result }: { result: DbResult }) {
  const { t } = useI18n();
  const toast = useToast();
  const [shown, setShown] = useState(SHOWN_STEP);
  useEffect(() => setShown(SHOWN_STEP), [result]);
  const copy = (text: string) => { void navigator.clipboard?.writeText(text); toast(t('db.copied')); };
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([toCsv(result)], { type: 'text/csv' })); a.download = `query-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  const writes = result.columns.length === 0;
  return (
    <div className="dbr">
      <div className="dbr-bar small">
        <b>{writes ? t('db.result.affected', { count: result.affected ?? 0 }) : t('db.result.rows', { count: result.rows.length })}</b>
        <span className="muted">· {result.ms} ms</span>
        {result.truncated && <span className="db-trunc">{t('db.result.truncated', { count: result.rows.length })}</span>}
        <span className="grow" />
        {!writes && (<>
          <button className="btn ghost sm" onClick={() => copy(toCsv(result))}><Copy size={13} />CSV</button>
          <button className="btn ghost sm" onClick={() => copy(toJson(result))}><Copy size={13} />JSON</button>
          <button className="btn ghost sm" onClick={download}><Download size={13} />{t('db.download')}</button>
        </>)}
      </div>
      {writes ? null : result.rows.length === 0 ? <p className="muted small db-note">{t('db.result.empty')}</p> : (
        <div className="dbr-scroll">
          <table className="dbr-table">
            <thead><tr><th className="n">#</th>{result.columns.map((c, i) => <th key={i} className={typeof result.rows.find((r) => r[i] !== null)?.[i] === 'number' ? 'num' : ''}>{c.name}</th>)}</tr></thead>
            <tbody>{result.rows.slice(0, shown).map((row, r) => (
              <tr key={r}><td className="n">{r + 1}</td>{row.map((v, i) => <td key={i} className={typeof v === 'number' ? 'num' : ''} title={typeof v === 'string' && v.length > 40 ? v : undefined}>{v === null ? <i className="db-null">NULL</i> : String(v)}</td>)}</tr>
            ))}</tbody>
          </table>
          {result.rows.length > shown && <button className="btn sm dbr-more" onClick={() => setShown((s) => s + SHOWN_STEP)}>{t('db.result.more', { count: Math.min(SHOWN_STEP, result.rows.length - shown) })}</button>}
        </div>
      )}
    </div>
  );
}

function SchemaPane({ o, schema, err, loading, onReload, database, setDatabase, onOpen }: {
  o: ObjectView; schema: DbSchema | null; err: string; loading: boolean; onReload: () => void; database?: string; setDatabase: (d: string | undefined) => void; onOpen: (t: DbTable) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [sel, setSel] = useState<DbTable | null>(null);
  const [cols, setCols] = useState<DbTableColumn[] | null>(null);
  const [colErr, setColErr] = useState('');
  const dbs = schema?.databases ?? [];
  const cur = database ?? schema?.database;
  useEffect(() => {
    if (!sel) return;
    setCols(null); setColErr('');
    api.get<DbTableColumn[]>(`/objects/${o.id}/db/columns?schema=${encodeURIComponent(sel.schema)}&table=${encodeURIComponent(sel.name)}${cur && schema && schema.engine !== 'sqlite' ? `&database=${encodeURIComponent(cur)}` : ''}`).then(setCols).catch((e) => setColErr(e instanceof Error ? e.message : ''));
  }, [sel, o.id, cur, schema]);
  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase(); const m = new Map<string, DbTable[]>();
    for (const tb of schema?.tables ?? []) { if (f && !tb.name.toLowerCase().includes(f)) continue; (m.get(tb.schema) ?? m.set(tb.schema, []).get(tb.schema)!).push(tb); }
    return [...m];
  }, [schema, filter]);
  const single = groups.length === 1;
  return (
    <div className="dbs">
      <aside className="dbs-list">
        <div className="dbs-head">
          {dbs.length > 1 && <select className="select" value={cur ?? ''} onChange={(e) => { setSel(null); setDatabase(e.target.value); }} aria-label={t('db.database.pick')}>{dbs.map((d) => <option key={d} value={d}>{d}</option>)}</select>}
          <div className="search grow"><Search size={14} /><input className="input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('db.schema.filter')} aria-label={t('db.schema.filter')} /></div>
          <button className="btn ghost icon sm" onClick={onReload} aria-label={t('db.schema.refresh')} title={t('db.schema.refresh')}><RefreshCw size={14} className={loading ? 'spin' : ''} /></button>
        </div>
        <div className="dbs-tree">
          {err ? <p className="gx-note err">{err}</p> : !schema && loading ? <p className="muted small db-note"><Loader2 size={14} className="spin" /> {t('db.schema.loading')}</p>
            : groups.length === 0 ? <p className="muted small db-note">{t('db.schema.empty')}</p>
            : groups.map(([sch, list]) => (
              <div key={sch}>
                {!single && <button className="dbs-group" onClick={() => setOpen((x) => ({ ...x, [sch]: x[sch] === false }))}>{open[sch] === false ? <ChevronRight size={14} /> : <ChevronDown size={14} />}{sch}<span className="muted">{list.length}</span></button>}
                {(single || open[sch] !== false) && list.map((tb) => (
                  <button key={`${tb.schema}.${tb.name}`} className={`dbs-table ${sel?.schema === tb.schema && sel.name === tb.name ? 'on' : ''}`} onClick={() => setSel(tb)} onDoubleClick={() => onOpen(tb)}>
                    {tb.type === 'view' ? <Eye size={14} /> : <Table2 size={14} />}<span className="nm">{tb.name}</span>{tb.rows !== undefined && <span className="muted">≈{tb.rows.toLocaleString()}</span>}
                  </button>))}
              </div>))}
        </div>
      </aside>
      <section className="dbs-detail">
        {!sel ? <p className="muted db-note">{t('db.schema.pick')}</p> : (<>
          <div className="row gap-s wrap">
            <h3 className="mono" style={{ margin: 0 }}>{sel.schema !== 'main' && schema?.engine !== 'mysql' ? `${sel.schema}.` : ''}{sel.name}</h3>
            <span className="muted small">{sel.type === 'view' ? t('db.schema.view') : t('db.schema.table')}{sel.rows !== undefined ? ` · ${t('db.rows.est', { count: sel.rows.toLocaleString() })}` : ''}</span>
            <span className="grow" />
            <button className="btn primary sm" onClick={() => onOpen(sel)}><Play size={14} />{t('db.select100')}</button>
            <button className="btn sm" onClick={() => { void navigator.clipboard?.writeText(sel.name); toast(t('db.copied')); }}><Copy size={14} />{t('db.copyName')}</button>
          </div>
          {colErr ? <p className="gx-note err">{colErr}</p> : !cols ? <p className="muted small db-note"><Loader2 size={14} className="spin" /> {t('db.schema.loading')}</p> : (
            <table className="dbr-table dbs-cols">
              <thead><tr><th>{t('db.col.name')}</th><th>{t('db.col.type')}</th><th>{t('db.col.null')}</th><th>{t('db.col.key')}</th><th>{t('db.col.default')}</th></tr></thead>
              <tbody>{cols.map((c) => <tr key={c.name}><td className="mono">{c.name}</td><td className="mono">{c.type}</td><td>{c.nullable ? t('db.yes') : <b>{t('db.no')}</b>}</td><td>{c.key ? <span className="db-key">{c.key}</span> : ''}</td><td className="mono">{c.default ?? <i className="db-null">NULL</i>}</td></tr>)}</tbody>
            </table>
          )}
        </>)}
      </section>
    </div>
  );
}

function HistoryPane({ o, hist, saved, onUse, onChanged }: { o: ObjectView; hist: DbHistoryEntry[] | null; saved: DbSaved[]; onUse: (q: string, db?: string) => void; onChanged: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const clear = async () => { try { await api.del(`/objects/${o.id}/db/history`); onChanged(); } catch (e) { toast(e instanceof Error ? e.message : '', 'err'); } };
  const drop = async (id: string) => { try { await api.del(`/objects/${o.id}/db/saved/${id}`); onChanged(); } catch (e) { toast(e instanceof Error ? e.message : '', 'err'); } };
  return (
    <div className="dbh">
      <section>
        <div className="row gap-s"><h3 className="grow">{t('db.saved.title')}</h3></div>
        {saved.length === 0 ? <p className="muted small">{t('db.saved.none')}</p> : saved.map((s) => (
          <div key={s.id} className="dbh-row">
            <button className="dbh-main" onClick={() => onUse(s.sql, s.database)}><b>{s.name}</b><code className="mono">{s.sql.replace(/\s+/g, ' ').slice(0, 160)}</code></button>
            <button className="btn ghost icon sm" onClick={() => void drop(s.id)} aria-label={t('db.delete')} title={t('db.delete')}><Trash2 size={14} /></button>
          </div>))}
      </section>
      <section>
        <div className="row gap-s"><h3 className="grow">{t('db.hist.title')}</h3>{hist && hist.length > 0 && <button className="btn ghost sm" onClick={() => void clear()}><Trash2 size={14} />{t('db.hist.clear')}</button>}</div>
        {hist === null ? <p className="muted small">{t('git.loading')}</p> : hist.length === 0 ? <p className="muted small">{t('db.hist.empty')}</p> : hist.map((h) => (
          <div key={h.n} className="dbh-row">
            <button className="dbh-main" onClick={() => onUse(h.sql, h.database)} title={h.error}>
              <span className="row gap-s small"><i className={`dot ${h.ok ? 'ok' : 'err'}`} /><span className="muted">{ago(h.at)}</span>{h.ok ? <span className="muted">· {h.rows !== undefined ? t('db.result.rows', { count: h.rows }) : t('db.result.affected', { count: h.affected ?? 0 })} · {h.ms} ms</span> : <span className="db-bad">{h.error}</span>}</span>
              <code className="mono">{h.sql.replace(/\s+/g, ' ').slice(0, 200)}</code>
            </button>
          </div>))}
      </section>
    </div>
  );
}

function NameModal({ onClose, onSave }: { onClose: () => void; onSave: (n: string) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  return (
    <Modal title={t('db.save')} onClose={onClose}>
      <div className="field"><label>{t('db.saved.name')}</label><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onSave(name.trim()); }} /></div>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>{t('db.save')}</button></div>
    </Modal>
  );
}

