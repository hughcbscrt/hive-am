import { Check, Trash2, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n/index';
import { fmtBytes, fmtDateTime, fmtTime } from '@/lib/format';
import type { HttpHistoryEntry, HttpScan } from '@/lib/types';
import { MasterDetail } from '../MasterDetail';
import { JsonTree } from '../JsonTree';
import { RunDiff } from '../RunDiff';
import { methodTone, parseJson, prettyBody, statusTone } from './httpUi';
import { HttpConfirmDialog, HttpSessionBlock } from './HttpSessionBlock';
import type { HttpWs } from './useHttpWorkspace';

/** The runs made so far (newest first), the one picked with its tests and body, and the diff against another run. */
export function HttpHistoryPane({ ws, scan, onGoRequests }: { ws: HttpWs; scan: HttpScan; onGoRequests?: () => void }) {
  const { t } = useI18n();
  const { hist, histSel, setHistSel, cmp, setCmp, setConfirm, setFile, setSel, setTab } = ws;
  const cur = hist.find((h) => h.n === histSel) ?? null;
  const cj = cur?.run ? parseJson(cur.run.body) : undefined;
  const reqOf = (h: HttpHistoryEntry) => scan.files.find((f) => f.relFile === h.file)?.requests[h.index];
  const prev = cur ? hist.find((h) => h.n < cur.n && h.file === cur.file && h.index === cur.index && h.run) : undefined;
  const other = cmp === 'prev' ? prev : typeof cmp === 'number' ? hist.find((h) => h.n === cmp) : undefined;
  const toneOf = (h: HttpHistoryEntry) => (!h.run ? 'err' : h.run.tests.some((x) => !x.passed) || h.run.scriptError ? 'err' : statusTone(h.run.status));
  return (
    <MasterDetail list={
      <aside className="hw-list">
        <div className="hw-env"><b className="grow">{t('hw2.history')}</b>{hist.length > 0 && <button className="btn ghost sm" onClick={() => setConfirm('history')}><Trash2 size={13} />{t('hw2.history.clear')}</button>}</div>
        <div className="hr-reqs">
          {hist.length === 0 && <p className="gx-note">{t('hw2.history.empty')}</p>}
          {hist.map((h) => (
            <button key={h.n} className={`hr-req ${histSel === h.n ? 'sel' : ''}`} onClick={() => { setHistSel(h.n); setCmp(null); }}>
              <span className={`hr-m ${methodTone(h.method || 'GET')}`}>{h.method || '?'}</span><span className="nm">{h.name}</span>
              <span className="muted small">{fmtDateTime(h.at)}</span>
              <i className={`hr-dot ${toneOf(h)}`} title={h.run ? String(h.run.status) : h.error} />
            </button>))}
        </div>
      </aside>}>
      <section className="hr-detail hw-scroll">
        {cur && (<div className="hr-pre">
          <div className="row gap-s wrap res-mb"><span className={`hr-m ${methodTone(cur.method || 'GET')}`}>{cur.method}</span><code className="mono grow hw-wrap">{cur.run?.request.url ?? cur.name}</code>
            {cur.run && <><b className={`hr-st ${statusTone(cur.run.status)}`}>{cur.run.status} {cur.run.statusText}</b><span className="muted small">{t('http.time', { ms: cur.run.durationMs })} · {fmtBytes(cur.run.size)}</span></>}
            {reqOf(cur) && <button className="btn sm" onClick={() => { setFile(cur.file); setSel(reqOf(cur)!); setTab('body'); onGoRequests?.(); }}>{t('hw2.history.open')}</button>}</div>
          <div className="row gap-s wrap small res-mb"><span className="muted">{cur.file}{cur.env ? ` · ${cur.env}` : ''}</span><span className="grow" />
            <select className="select hw-cmp" value={String(cmp ?? '')} onChange={(e) => setCmp(e.target.value === '' ? null : e.target.value === 'prev' ? 'prev' : Number(e.target.value))} aria-label={t('hw2.diff.with')}>
              <option value="">{t('hw2.diff.with')}</option>
              <option value="prev" disabled={!prev}>{t('hw2.diff.prev')}</option>
              {hist.filter((h) => h.n !== cur.n && h.run).map((h) => <option key={h.n} value={h.n}>{h.name} · {fmtTime(h.at)} · {h.run!.status}</option>)}
            </select></div>
          {cmp === 'prev' && !prev && <p className="muted small">{t('hw2.diff.noPrev')}</p>}
          {other && cur.run && other.run ? (other.at <= cur.at ? <RunDiff before={other} after={cur} /> : <RunDiff before={cur} after={other} />) : (<>
            {cur.error && <div className="gx-banner err hw-pre">{cur.error}</div>}
            {cur.run && cur.run.tests.map((x, i) => <div key={i} className={`hw-test ${x.passed ? 'ok' : 'err'}`}>{x.passed ? <Check size={14} /> : <X size={14} />}<b>{x.name}</b>{x.message && <span className="muted">: {x.message}</span>}</div>)}
            {cur.run && !cur.run.binary && cur.run.body && (cj !== undefined ? <JsonTree value={cj} refBase={reqOf(cur)?.named ? `${reqOf(cur)!.named}.response.body` : undefined} /> : <pre>{prettyBody(cur.run)}</pre>)}</>)}
        </div>)}
        <HttpSessionBlock ws={ws} />
      </section>
      <HttpConfirmDialog ws={ws} />
    </MasterDetail>
  );
}
