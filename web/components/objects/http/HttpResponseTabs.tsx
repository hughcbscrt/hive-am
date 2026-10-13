import { Check, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n/index';
import { fmtBytes } from '@/lib/format';
import type { HttpRequestItem, HttpScan } from '@/lib/types';
import { SearchInput, Segmented } from '@/components/ui';
import { CopyBtn } from '@/components/chat/ToolCall';
import { jsonPath } from '@/lib/jsonPath';
import { JsonTree } from '../JsonTree';
import { VarsTable } from '../VarsTable';
import { AssertEditor } from '../AssertEditor';
import { AuthForm } from '../AuthForm';
import { parseJson, prettyBody } from './httpUi';
import { WithVars } from './WithVars';
import type { HttpWs } from './useHttpWorkspace';

/** The content of the active tab of the picked request: body, headers, tests, request, variables or auth. */
export function HttpResponseTabs({ ws, scan, sel }: { ws: HttpWs; scan: HttpScan; sel: HttpRequestItem }) {
  const { t } = useI18n();
  const { o, tab, insp, res, fileOf, load, forget, setVar, runNamed, testsOf, bodyView, setBodyView, bodyFilter, setBodyFilter } = ws;
  return (
      tab === 'auth' ? (
        <AuthForm objectId={o.id} file={fileOf.current.get(sel.id) ?? ''} lines={(scan.files.find((f) => f.relFile === fileOf.current.get(sel.id))?.requests ?? [sel]).map((r) => r.line).reduce<number[]>((a, l) => (l === sel.line ? [l, ...a] : [...a, l]), [])} onSaved={load} />
      ) : tab === 'vars' ? (
        <div className="hr-pre">{insp ? <VarsTable vars={insp.vars} onSet={setVar} onForget={(n) => void forget(n)} onRun={runNamed} /> : <p className="muted">{t('git.loading')}</p>}</div>
      ) : tab === 'request' ? (
        <div className="hr-pre">
          {!res?.run && insp?.preview ? (<>
            <div className="row gap-s small res-mb"><b>{t('hw2.resolved')}</b>{insp.preview.unresolved.length > 0 && <span className="chip warn">{t('hw2.unresolved', { count: insp.preview.unresolved.length })}</span>}</div>
            <div className="mono"><b>{insp.preview.method}</b> <WithVars text={insp.preview.url} /></div>
            {insp.preview.headers.map((h, i) => <div key={i}><b>{h.name}</b>: <WithVars text={h.value} /></div>)}
            {insp.preview.body !== undefined && <><div className="eyebrow hw-eb">{t('http.requestBody')}</div><pre><WithVars text={insp.preview.body} /></pre></>}
          </>) : null}
          {res?.run && <div className="muted small res-mb">{t('hw2.resolved')}</div>}
          {res?.run && <div className="mono"><b>{res.run.request.method}</b> {res.run.request.url}</div>}
          {res?.run && (res.run.request.headers).map((h, i) => <div key={i}><b>{h.name}</b>: {h.value}</div>)}
          {res?.run ? null : !insp?.preview && (sel.headers).map((h, i) => <div key={i}><b>{h.name}</b>: {res?.run ? h.value : <WithVars text={h.value} />}</div>)}
          {res?.run && res.run.request.body !== undefined && <><div className="eyebrow hw-eb">{t('http.requestBody')}</div><pre><WithVars text={res?.run?.request.body ?? sel.body ?? ''} /></pre></>}
          {sel.script && <><div className="eyebrow hw-eb">{t('hw.script')}</div><p className="muted small hw-hint2">{t('hw.script.hint')}</p><pre>{sel.script.trim()}</pre></>}
        </div>
      ) : tab === 'tests' ? (
        <div className="hr-form">
          <AssertEditor objectId={o.id} file={fileOf.current.get(sel.id) ?? ''} line={sel.line} onSaved={load} />
          <div className="eyebrow hw-eb2">{t('hw.tests')}</div><div className="hr-pre res-p0">
          {!res?.run ? <p className="muted">{t('http.noResponse')}</p> : testsOf(res).length === 0 && res.run.logs.length === 0 ? <p className="muted">{t('hw.tests.none')}</p> : (<>
            {testsOf(res).map((x, i) => <div key={i} className={`hw-test ${x.passed ? 'ok' : 'err'}`}>{x.passed ? <Check size={14} /> : <X size={14} />}<b>{x.name}</b>{x.message && <span className="muted">: {x.message}</span>}</div>)}
            {res.run.logs.length > 0 && <><div className="eyebrow hw-eb">{t('hw.console')}</div><pre>{res.run.logs.join('\n')}</pre></>}</>)}
          </div>
        </div>
      ) : !res ? <p className="gx-note">{t('http.noResponse')}</p> : res.error ? <div className="gx-banner err hw-pre hw-m16">{res.error}</div> : tab === 'headers' ? (
        <div className="hr-pre">{res.run!.headers.map((h, i) => <div key={i}><b>{h.name}</b>: {h.value}</div>)}</div>
      ) : (
        <div className="hr-pre">
          {res.run!.truncated && <div className="gx-banner">{t('http.truncated')}</div>}
          {res.run!.binary ? <p className="muted">{t('http.binary', { type: res.run!.contentType || '?', size: fmtBytes(res.run!.size) })}</p>
            : res.run!.body ? (() => {
              const j = parseJson(res.run!.body), q = bodyFilter.trim(), isPath = q.startsWith('$');
              let found: unknown[] | null = null, perr = '';
              if (isPath && j !== undefined) { try { found = jsonPath(j, q); } catch (e) { perr = e instanceof Error ? e.message : 'error'; } }
              const text = prettyBody(res.run!);
              const lines = q && !isPath ? text.split('\n').map((l, n) => ({ l, n: n + 1 })).filter((x) => x.l.toLowerCase().includes(q.toLowerCase())) : null;
              return (<>
                <div className="row gap-s">
                  <SearchInput className="grow" value={bodyFilter} onChange={setBodyFilter} placeholder={t('hw2.filter.placeholder')} label={t('hw2.filter')} />
                  {j !== undefined && <Segmented value={bodyView} onChange={setBodyView} options={[{ id: 'tree', label: t('hw2.tree') }, { id: 'text', label: t('hw2.text') }]} />}<CopyBtn text={found ? JSON.stringify(found.length === 1 ? found[0] : found, null, 2) : res.run!.body} /></div>
                {perr && <p className="gx-note err hw-my6">{perr}</p>}
                {isPath && j === undefined && <p className="muted small">{t('hw2.noJson')}</p>}
                {found ? (found.length === 0 ? <p className="muted small">{t('hw2.filter.none')}</p> : (<><p className="muted small hw-my6">{t('hw2.filter.count', { count: found.length })}</p>{bodyView === 'tree' ? <JsonTree value={found.length === 1 ? found[0] : found} /> : <pre>{JSON.stringify(found.length === 1 ? found[0] : found, null, 2)}</pre>}</>))
                  : lines ? (lines.length === 0 ? <p className="muted small">{t('hw2.filter.none')}</p> : <pre>{lines.map((x) => `${String(x.n).padStart(4)}  ${x.l}`).join('\n')}</pre>)
                  : j !== undefined && bodyView === 'tree' ? <>{!sel.named && <p className="muted small">{t('hw2.copyRef.need')}</p>}<JsonTree value={j} refBase={sel.named ? `${sel.named}.response.body` : undefined} /></> : <pre>{text}</pre>}</>); })() : <p className="muted">{t('http.emptyBody')}</p>}
        </div>
      )
  );
}
