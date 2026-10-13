import { AlertTriangle, Play } from 'lucide-react';
import { useI18n } from '@/lib/i18n/index';
import { fmtBytes } from '@/lib/format';
import type { HttpScan } from '@/lib/types';
import { Segmented } from '@/components/ui';
import { CopyAs } from '../CopyAs';
import { methodTone, statusTone } from './httpUi';
import { WithVars } from './WithVars';
import { HttpResponseTabs } from './HttpResponseTabs';
import type { HttpWs } from './useHttpWorkspace';

/** The picked request: its header with Run, the banners (refs, missing variables, notes), the tab bar and the active tab. */
export function HttpResponseView({ ws, scan, onOpenVars }: { ws: HttpWs; scan: HttpScan; onOpenVars: () => void }) {
  const { t } = useI18n();
  const { o, env, sel, setSel, busy, missing, needsRun, tab, setTab, insp, note, fileOf, byName, run, res, testsOf } = ws;
  if (!sel) return null;
  return (<>
    <div className="hr-reqhead">
      <span className={`hr-m ${methodTone(sel.method)}`}>{sel.method}</span>
      <code className="hr-url grow"><WithVars text={sel.url} /></code>
      <CopyAs objectId={o.id} file={fileOf.current.get(sel.id) ?? ''} index={sel.index} env={env} />
      <button className="btn primary sm" disabled={!!busy || missing.length > 0} onClick={() => void run(sel)} title="Ctrl+Enter"><Play size={14} />{busy === sel.id ? t('http.running') : t('http.run')}</button>
    </div>
    {sel.refs.length > 0 && <div className="gx-banner">{t('hw.uses', { names: sel.refs.map((n) => `“${n}”`).join(', ') })}</div>}
    {missing.length > 0 && (
      <div className="gx-banner row gap-s wrap">
        <AlertTriangle size={15} />
        <span className="grow">{t('http.missing', { names: missing.map((m) => `{{${m}}}`).join(', ') })}{needsRun.length ? '' : `. ${t('http.missing.hint')}`}</span>
        {needsRun.map((n) => byName.current.get(n) && <button key={n} className="btn sm" disabled={!!busy} onClick={() => { const r = byName.current.get(n)!; setSel(r); void run(r); }}>{t('hw.needsRun', { name: n })}</button>)}
        {!needsRun.length && <button className="btn sm" onClick={onOpenVars}>{t('hw.editVars')}</button>}
      </div>
    )}
    {note && <div className="gx-banner">{note}</div>}
    <div className="row gap-s hw-bar">
      <Segmented value={tab} onChange={setTab} options={[{ id: 'body', label: t('http.body') }, { id: 'headers', label: `${t('http.headers')}${res?.run ? ` · ${res.run.headers.length}` : ''}` }, { id: 'tests', label: `${t('hw.tests')}${testsOf(res).length ? ` · ${testsOf(res).filter((x) => x.passed).length}/${testsOf(res).length}` : ''}` }, { id: 'request', label: t('http.request') }, { id: 'vars', label: `${t('hw2.tab.vars')}${insp?.vars.length ? ` · ${insp.vars.length}` : ''}` }, { id: 'auth', label: t('hw2.tab.auth') }]} />
      <span className="grow" />
      {res?.run && <span className="row gap-s small">{res.run.set.length > 0 && <span className="chip" title={res.run.set.join(', ')}>{t('hw.kept', { names: res.run.set.join(', ') })}</span>}<b className={`hr-st ${statusTone(res.run.status)}`}>{res.run.status} {res.run.statusText}</b><span className="muted">{t('http.time', { ms: res.run.durationMs })} · {fmtBytes(res.run.size)}</span></span>}
    </div>
    {res?.run?.scriptError && <div className="gx-banner err">{t('hw.script.error', { error: res.run.scriptError })}</div>}
    {res?.run?.scriptFile && <div className="gx-banner">{t('hw.script.file', { file: res.run.scriptFile })}</div>}
    <div className="hr-out">
      <HttpResponseTabs ws={ws} scan={scan} sel={sel} />
    </div>
  </>);
}
