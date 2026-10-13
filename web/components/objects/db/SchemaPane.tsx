'use client';
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, Loader2, Play, RefreshCw, Table2, Eye } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import type { DbSchema, DbTable, DbTableColumn, ObjectView } from '@/lib/types';
import { SearchInput, useToast } from '@/components/ui';
import { MasterDetail } from '../MasterDetail';
import { fmtNum } from '@/lib/format';

export function SchemaPane({ o, schema, err, loading, onReload, database, setDatabase, onOpen }: {
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
  const names = useMemo(() => [...new Set((schema?.tables ?? []).map((tb) => tb.schema))], [schema]);
  const allOpen = names.every((n) => open[n] !== false);
  const setAll = (v: boolean) => setOpen(Object.fromEntries(names.map((n) => [n, v])));
  return (
    <MasterDetail gap list={
      <aside className="dbs-list">
        <div className="dbs-head">
          {dbs.length > 1 && <select className="select" value={cur ?? ''} onChange={(e) => { setSel(null); setDatabase(e.target.value); }} aria-label={t('db.database.pick')}>{dbs.map((d) => <option key={d} value={d}>{d}</option>)}</select>}
          <div className="dbs-tools">
          <SearchInput className="grow" value={filter} onChange={setFilter} placeholder={t('db.schema.filter')} label={t('db.schema.filter')} />
          {names.length > 1 && <button className="btn ghost icon sm" onClick={() => setAll(!allOpen)} aria-label={allOpen ? t('db.schema.collapseAll') : t('db.schema.expandAll')} title={allOpen ? t('db.schema.collapseAll') : t('db.schema.expandAll')}>{allOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}</button>}
          <button className="btn ghost icon sm" onClick={onReload} aria-label={t('db.schema.refresh')} title={t('db.schema.refresh')}><RefreshCw size={14} className={loading ? 'spin' : ''} /></button>
          </div>
        </div>
        <div className="dbs-tree">
          {err ? <p className="gx-note err">{err}</p> : !schema && loading ? <p className="muted small db-note"><Loader2 size={14} className="spin" /> {t('db.schema.loading')}</p>
            : groups.length === 0 ? <p className="muted small db-note">{t('db.schema.empty')}</p>
            : groups.map(([sch, list]) => (
              <div key={sch}>
                {!single && <button className="dbs-group" onClick={() => setOpen((x) => ({ ...x, [sch]: x[sch] === false }))}>{open[sch] === false ? <ChevronRight size={14} /> : <ChevronDown size={14} />}{sch}<span className="muted">{list.length}</span></button>}
                {(single || open[sch] !== false) && list.map((tb) => (
                  <button key={`${tb.schema}.${tb.name}`} className={`dbs-table ${sel?.schema === tb.schema && sel.name === tb.name ? 'on' : ''}`} onClick={() => setSel(tb)} onDoubleClick={() => onOpen(tb)}>
                    {tb.type === 'view' ? <Eye size={14} /> : <Table2 size={14} />}<span className="nm">{tb.name}</span>{tb.rows !== undefined && <span className="muted">≈{fmtNum(tb.rows)}</span>}
                  </button>))}
              </div>))}
        </div>
      </aside>}>
      <section className="dbs-detail">
        {!sel ? <p className="muted db-note">{t('db.schema.pick')}</p> : (<>
          <div className="row gap-s wrap">
            <h3 className="mono res-m0">{sel.schema !== 'main' && schema?.engine !== 'mysql' ? `${sel.schema}.` : ''}{sel.name}</h3>
            <span className="muted small">{sel.type === 'view' ? t('db.schema.view') : t('db.schema.table')}{sel.rows !== undefined ? ` · ${t('db.rows.est', { count: fmtNum(sel.rows) })}` : ''}</span>
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
    </MasterDetail>
  );
}
