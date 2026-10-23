import { File, ListChecks } from 'lucide-react';
import { useI18n } from '@/lib/i18n/index';
import type { HttpFile } from '@/lib/types';
import { Segmented } from '@/components/ui';
import { VarsTable } from '../VarsTable';
import { HttpSource } from '../HttpSource';
import { FileMenu } from '../FileMenu';
import { methodTone, tone } from './httpUi';
import { WithVars } from './WithVars';
import type { HttpWs } from './useHttpWorkspace';
import { NO_VALUE } from '@/lib/meta';

/** A picked .http file: run it whole, and see its requests with the last result, its variables or its source. */
export function HttpFileView({ ws, picked }: { ws: HttpWs; picked: HttpFile }) {
  const { t } = useI18n();
  const { o, busy, runFile, setBatch, stopOnFail, setStopOnFail, fileInsp, fileTab, setFileTab, note, setVar, forget, runNamed, statusByIndex, load, refreshInsp, setSel, setTab, run, results, testsOf } = ws;
  return (
      <div className="hw-file-view">
        <div className="hw-fhead">
          <File size={20} className="muted" />
          <div className="grow res-minw0"><h3 className="mono" title={picked.relFile}>{picked.relFile}</h3>
            <p className="muted small res-m0">{t('hw.fileInfo', { count: picked.requests.length })}{fileInsp ? ` · ${t('hw2.vars.count', { count: fileInsp.vars.length })}` : ''}</p></div>
          <button className="btn primary sm" disabled={!!busy} onClick={() => void runFile(picked)}><ListChecks size={14} />{t('http.runFile')}</button>
          <FileMenu objectId={o.id} file={picked.relFile} onBatch={() => setBatch(true)} stopOnFail={stopOnFail} onStopOnFail={setStopOnFail} />
        </div>
        <Segmented value={fileTab} onChange={setFileTab} options={[{ id: 'requests', label: `${t('hw2.tab.requests')} · ${picked.requests.length}` }, { id: 'vars', label: `${t('hw2.tab.vars')}${fileInsp?.vars.length ? ` · ${fileInsp.vars.length}` : ''}` }, { id: 'source', label: t('hw2.tab.source') }]} />
        {note && <div className="gx-banner">{note}</div>}
        {fileTab === 'vars' ? (fileInsp ? <VarsTable vars={fileInsp.vars} onSet={setVar} onForget={(n) => void forget(n)} onRun={runNamed} /> : <p className="muted">{t('git.loading')}</p>)
        : fileTab === 'source' ? <div className="hw-src"><HttpSource objectId={o.id} file={picked} vars={fileInsp?.vars ?? []} status={statusByIndex(picked)} onSaved={() => { load(); refreshInsp(); }} onRun={(i) => { const r = picked.requests.find((x) => x.index === i); if (r) { setSel(r); setTab('body'); void run(r); } }} /></div>
        : (<table className="cm-table"><thead><tr><th /><th>{t('obj.f.name')}</th><th>{t('hw.fileTests')}</th><th>{t('hw.lastRun')}</th></tr></thead><tbody>
          {picked.requests.map((r) => { const x = results[r.id]; const ts = testsOf(x); return (
            <tr key={r.id} className="hw-trow" onClick={() => { setSel(r); setTab('body'); }}>
              <td><span className={`hr-m ${methodTone(r.method)}`}>{r.method}</span></td><td><b>{r.name}</b><div className="muted small mono hw-url"><WithVars text={r.url} /></div></td>
              <td>{ts.length ? <span className={`hr-st ${ts.every((y) => y.passed) ? 'ok' : 'err'}`}>{ts.filter((y) => y.passed).length}/{ts.length}</span> : <span className="muted small">{NO_VALUE}</span>}</td>
              <td>{x ? (x.run ? <span className={`hr-st ${tone(x)}`}><b>{x.run.status}</b> <span className="muted">{x.run.durationMs} ms</span></span> : <span className="hr-st err" title={x.error}>{t('obj.status.error')}</span>) : <span className="muted small">{t('hw.notRun')}</span>}</td></tr>); })}
        </tbody></table>)}
      </div>
  );
}
