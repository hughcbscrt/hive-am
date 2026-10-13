'use client';
import { useRef, useState } from 'react';
import { Play, Square, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { parseRows } from '@/lib/dataRows';
import type { HttpFile, HttpRun } from '@/lib/types';
import { CheckRow, Modal } from '@/components/ui';
import { HelpPopover } from '@/components/HelpPopover';

interface Cell { status?: number; ok: boolean; tests: string; error?: string }
const MAX_ROWS = 200;

/**
 * Runs a whole file once per row of data: each row's values (the columns) are set for the session, the requests run in order, and
 * the table shows how every request went in every row. The values are forgotten at the end.
 */
export function BatchRun({ objectId, file, env, onClose, onDone }: { objectId: string; file: HttpFile; env: string; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [stopOnFail, setStopOnFail] = useState(false);
  const [err, setErr] = useState('');
  const [results, setResults] = useState<Cell[][]>([]);
  const [running, setRunning] = useState(false);
  const stop = useRef(false);
  let parsed: ReturnType<typeof parseRows> | null = null; let perr = '';
  if (text.trim()) { try { parsed = parseRows(text); if (parsed.rows.length > MAX_ROWS) { perr = t('hw2.batch.tooMany', { max: MAX_ROWS }); parsed = null; } } catch (e) { perr = e instanceof Error ? e.message : 'error'; } }

  const load = (f?: File) => { if (!f) return; void f.text().then(setText); };
  const start = async () => {
    if (!parsed) return;
    setErr(''); setResults([]); setRunning(true); stop.current = false;
    const cols = parsed.columns; const all: Cell[][] = [];
    try {
      for (const row of parsed.rows) {
        if (stop.current) break;
        for (const c of cols) await api.post(`/objects/${objectId}/http/session`, { name: c, value: row[c] });
        const cells: Cell[] = []; let failed = false;
        for (const r of file.requests) {
          if (stop.current || (failed && stopOnFail)) { cells.push({ ok: false, tests: '', error: t('hw2.batch.skipped') }); continue; }
          try {
            const run = await api.post<HttpRun>(`/objects/${objectId}/http/run`, { file: file.relFile, index: r.index, env: env || undefined });
            const bad = run.tests.filter((x) => !x.passed).length + (run.scriptError ? 1 : 0);
            const ok = run.status < 400 && bad === 0; if (!ok) failed = true;
            cells.push({ status: run.status, ok, tests: run.tests.length ? `${run.tests.length - run.tests.filter((x) => !x.passed).length}/${run.tests.length}` : '' });
          } catch (e) { failed = true; cells.push({ ok: false, tests: '', error: e instanceof Error ? e.message : 'error' }); }
        }
        all.push(cells); setResults([...all]);
      }
    } catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
    finally {
      for (const c of cols) await api.del(`/objects/${objectId}/http/session?name=${encodeURIComponent(c)}`).catch(() => undefined);
      setRunning(false); onDone();
    }
  };
  const passed = results.filter((r) => r.every((c) => c.ok)).length;

  return (
    <Modal title={t('hw2.batch.title', { file: file.relFile })} onClose={() => { stop.current = true; onClose(); }}>
      <div className="stack">
        <div className="field">
          <div className="row gap-s"><label className="label" htmlFor="batch-data">{t('hw2.batch.data')}</label><HelpPopover size="sm" label={t('common.help')} title={t('hw2.help.how')}>{t('hw2.batch.hint')}</HelpPopover></div>
          <textarea id="batch-data" className="input mono" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={'user,passwd\nana,s3cret\nluis,otra'} spellCheck={false} disabled={running} />
          <span className="muted small">{t('hw2.batch.format')}</span>
        </div>
        <div className="row gap-s wrap">
          <label className="btn sm"><Upload size={14} />{t('hw2.batch.file')}<input type="file" accept=".csv,.json,.txt,text/csv,application/json" hidden onChange={(e) => load(e.target.files?.[0])} /></label>
          <CheckRow checked={stopOnFail} onChange={setStopOnFail} label={t('hw2.batch.stopRow')} />
          <span className="grow" />
          {parsed && <span className="muted small">{t('hw2.batch.rows', { rows: parsed.rows.length, cols: parsed.columns.join(', ') })}</span>}
          {running ? <button className="btn" onClick={() => { stop.current = true; }}><Square size={14} />{t('hw2.batch.stop')}</button> : <button className="btn primary" disabled={!parsed || !parsed.rows.length} onClick={() => void start()}><Play size={14} />{t('hw2.batch.run')}</button>}
        </div>
        {perr && <p className="gx-note err" style={{ margin: 0 }}>{perr}</p>}
        {err && <p className="gx-note err" style={{ margin: 0 }}>{err}</p>}
        {results.length > 0 && parsed && (<>
          <p className="small" style={{ margin: 0 }}><b>{t('hw2.batch.summary', { ok: passed, total: results.length })}</b>{running ? ' …' : ''}</p>
          <div style={{ overflow: 'auto', maxHeight: 280 }}>
            <table className="cm-table"><thead><tr><th>#</th>{parsed.columns.slice(0, 2).map((c) => <th key={c}>{c}</th>)}{file.requests.map((r) => <th key={r.id} title={r.name}>{r.name.slice(0, 18)}</th>)}</tr></thead>
              <tbody>{results.map((cells, i) => (
                <tr key={i}><td>{i + 1}</td>{parsed!.columns.slice(0, 2).map((c) => <td key={c} className="mono small">{parsed!.rows[i][c]}</td>)}
                  {cells.map((c, n) => <td key={n} title={c.error ?? ''}><span className={`hr-st ${c.ok ? 'ok' : 'err'}`}>{c.error ? '—' : c.status}{c.tests ? ` · ${c.tests}` : ''}</span></td>)}</tr>))}</tbody></table>
          </div>
        </>)}
      </div>
    </Modal>
  );
}
