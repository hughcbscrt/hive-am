'use client';
import { useEffect, useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { useI18n } from '@/lib/i18n/index';
import type { DbResult } from '@/lib/types';
import { useToast } from '@/components/ui';
import { toCsv, toJson } from './dbSql';

const SHOWN_STEP = 500;

export function Results({ result }: { result: DbResult }) {
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
