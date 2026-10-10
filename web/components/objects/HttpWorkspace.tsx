'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, File, KeyRound, ListChecks, Play, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { fmtBytes } from '@/lib/format';
import type { HttpConfig, HttpFile, HttpRequestItem, HttpRun, HttpScan, HttpSessionView, ObjectView } from '@/lib/types';
import { Segmented } from '@/components/ui';
import { CopyBtn } from '@/components/chat/ToolCall';

interface Result { run?: HttpRun; error?: string; at: number }
const methodTone = (m: string) => (m === 'GET' ? 'get' : m === 'POST' ? 'post' : m === 'DELETE' ? 'del' : m === 'PUT' || m === 'PATCH' ? 'put' : 'other');
const statusTone = (s: number) => (s >= 200 && s < 300 ? 'ok' : s >= 300 && s < 400 ? 'warn' : 'err');
const testsFailed = (r?: Result) => !!r?.run && (r.run.tests.some((x) => !x.passed) || !!r.run.scriptError);
/** How a result looks in a list: red when it failed (an error, a 4xx/5xx, a test or a handler), green when it went well. */
const tone = (r?: Result): 'ok' | 'warn' | 'err' | '' => (!r ? '' : !r.run ? 'err' : testsFailed(r) ? 'err' : statusTone(r.run.status));

function WithVars({ text }: { text: string }) {
  return <>{text.split(/(\{\{[^}]+\}\})/g).map((p, i) => (p.startsWith('{{') ? <span key={i} className="hr-var">{p}</span> : p))}</>;
}
function prettyBody(run: HttpRun): string {
  if (/json/i.test(run.contentType) || /^\s*[[{]/.test(run.body)) { try { return JSON.stringify(JSON.parse(run.body), null, 2); } catch { /* not complete JSON */ } }
  return run.body;
}

/**
 * The requests of an HTTP object as a screen: the .http files at the left (pick the one you want to try, or run it whole), its requests
 * under it, the session (the values the response handlers keep), and the request with its answer, tests and console on the right.
 */
export function HttpWorkspace({ object: o, onOpenVars }: { object: ObjectView; onOpenVars: () => void }) {
  const { t } = useI18n();
  const [scan, setScan] = useState<HttpScan | null>(null);
  const [err, setErr] = useState('');
  const [env, setEnv] = useState((o.config as HttpConfig).env ?? '');
  const [q, setQ] = useState('');
  const [file, setFile] = useState<string | null>(null);
  const [sel, setSel] = useState<HttpRequestItem | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, Result>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [needsRun, setNeedsRun] = useState<string[]>([]);
  const [tab, setTab] = useState<'body' | 'headers' | 'tests' | 'request'>('body');
  const [session, setSession] = useState<HttpSessionView>({ globals: {}, responses: [] });
  const [stopOnFail, setStopOnFail] = useState(false);
  const [note, setNote] = useState('');
  const fileOf = useRef(new Map<string, string>());
  const byName = useRef(new Map<string, HttpRequestItem>());

  const loadSession = useCallback(() => api.get<HttpSessionView>(`/objects/${o.id}/http/session`).then(setSession).catch(() => undefined), [o.id]);
  const load = useCallback(() => {
    setErr('');
    api.get<HttpScan>(`/objects/${o.id}/http`).then((s) => {
      setScan(s); fileOf.current = new Map(s.files.flatMap((f) => f.requests.map((r) => [r.id, f.relFile] as const)));
      byName.current = new Map(s.files.flatMap((f) => f.requests.filter((r) => r.named).map((r) => [r.named!, r] as const)));
      setFile((cur) => cur && s.files.some((f) => f.relFile === cur) ? cur : s.files[0]?.relFile ?? null);
      setOpen((cur) => (cur.size ? cur : new Set(s.files.slice(0, 1).map((f) => f.relFile))));
      setSel((cur) => (cur && fileOf.current.has(cur.id) ? s.files.flatMap((f) => f.requests).find((r) => r.id === cur.id) ?? null : null));
      const def = (o.config as HttpConfig).env ?? '';
      setEnv((e) => (e && s.environments.includes(e) ? e : def && s.environments.includes(def) ? def : s.environments[0] ?? ''));
    }).catch((e) => setErr(e instanceof Error ? e.message : t('git.loadError')));
  }, [o.id, o.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); void loadSession(); }, [load, loadSession]);

  const describe = useCallback(() => {
    if (!sel) { setMissing([]); setNeedsRun([]); return; }
    api.get<{ missing: string[]; needsRun: string[] }>(`/objects/${o.id}/http/describe?file=${encodeURIComponent(fileOf.current.get(sel.id) ?? '')}&index=${sel.index}${env ? `&env=${encodeURIComponent(env)}` : ''}`).then((r) => { setMissing(r.missing); setNeedsRun(r.needsRun ?? []); }).catch(() => { setMissing([]); setNeedsRun([]); });
  }, [o.id, o.updated_at, sel?.id, env]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { describe(); }, [describe, session]);

  const run = useCallback(async (r: HttpRequestItem): Promise<Result> => {
    const f = fileOf.current.get(r.id); if (!f) return { error: '', at: Date.now() };
    setBusy(r.id);
    let out: Result;
    try { out = { run: await api.post<HttpRun>(`/objects/${o.id}/http/run`, { file: f, index: r.index, env: env || undefined }), at: Date.now() }; }
    catch (e) { out = { error: e instanceof Error ? e.message : 'error', at: Date.now() }; }
    setResults((x) => ({ ...x, [r.id]: out })); setBusy(null); void loadSession();
    return out;
  }, [o.id, env, loadSession]);
  const runFile = async (f: HttpFile) => {
    setNote('');
    for (const r of f.requests) {
      setSel(r);
      const out = await run(r);
      if (stopOnFail && tone(out) === 'err') { setNote(t('hw.stopped', { name: r.name })); break; }
    }
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && sel && !busy) { e.preventDefault(); void run(sel); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [sel, busy, run]);

  const files = useMemo(() => (scan?.files ?? []).map((f) => ({ ...f, requests: f.requests.filter((r) => !q || `${r.name} ${r.url} ${r.method}`.toLowerCase().includes(q.toLowerCase()) || f.relFile.toLowerCase().includes(q.toLowerCase())) })).filter((f) => f.requests.length), [scan, q]);
  const picked = scan?.files.find((f) => f.relFile === file) ?? null;
  const res = sel ? results[sel.id] : undefined;
  const summary = (f: HttpFile) => { const done = f.requests.filter((r) => results[r.id]); return done.length ? `${done.filter((r) => tone(results[r.id]) === 'ok').length}/${f.requests.length}` : null; };
  const testsOf = (r?: Result) => r?.run?.tests ?? [];

  const forget = (name?: string) => api.del<HttpSessionView>(`/objects/${o.id}/http/session${name ? `?name=${encodeURIComponent(name)}` : ''}`).then(setSession).catch(() => undefined);
  const [newName, setNewName] = useState(''); const [newValue, setNewValue] = useState(''); const [adding, setAdding] = useState(false);
  const setValue = () => { if (!newName.trim()) return; api.post<HttpSessionView>(`/objects/${o.id}/http/session`, { name: newName.trim(), value: newValue }).then((s) => { setSession(s); setNewName(''); setNewValue(''); setAdding(false); }).catch(() => undefined); };
  const [showSession, setShowSession] = useState(true);
  const kept = Object.entries(session.globals);

  if (err) return <p className="gx-note err" style={{ padding: 20 }}>{err}</p>;
  if (!scan) return <p className="gx-note">{t('git.loading')}</p>;
  return (
    <div className="hw">
      <aside className="hw-list">
        <div className="hw-env">
          <label className="row gap-s small grow"><span className="muted">{t('http.env')}</span>
            <select className="select" style={{ width: 'auto', padding: '4px 10px', flex: 1 }} value={env} onChange={(e) => setEnv(e.target.value)}>
              <option value="">{t('http.noEnv')}</option>{scan.environments.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          <button className="btn ghost icon sm" onClick={() => { load(); void loadSession(); }} aria-label={t('http.rescan')} title={t('http.rescan')}><RefreshCw size={15} /></button>
        </div>
        {scan.envFiles.length === 0 && scan.environments.length === 0 && <p className="muted small hw-hint">{t('hw.noEnvFile')} <button className="btn sm" onClick={onOpenVars}>{t('hw.editVars')}</button></p>}
        <div className="gx-filter"><div className="search"><Search size={14} /><input className="input" placeholder={t('http.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('http.search')} /></div></div>
        <div className="hr-reqs">
          {files.length === 0 && <p className="gx-note">{scan.files.length ? t('ow.noMatch', { query: q }) : t('http.empty')}</p>}
          {files.map((f) => {
            const isOpen = open.has(f.relFile) || !!q;
            return (
              <div key={f.relFile}>
                <div className={`hw-file ${file === f.relFile && !sel ? 'sel' : ''}`}>
                  <button className="hw-fbtn" onClick={() => { setFile(f.relFile); setSel(null); setOpen((s) => { const n = new Set(s); if (n.has(f.relFile)) n.delete(f.relFile); else n.add(f.relFile); return n; }); }}>
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<File size={14} className="muted" /><span className="mono nm" title={f.relFile}>{f.relFile}</span>
                    <span className="muted small">{summary(f) ?? f.requests.length}</span></button>
                  <button className="btn ghost icon sm" disabled={!!busy} onClick={() => void runFile(f)} aria-label={t('http.runFile')} title={t('http.runFile')}><ListChecks size={15} /></button>
                </div>
                {isOpen && f.requests.map((r) => {
                  const x = results[r.id], tn = tone(x);
                  return (
                    <button key={r.id} className={`hr-req ${sel?.id === r.id ? 'sel' : ''}`} style={{ paddingLeft: 30 }} onClick={() => { setFile(f.relFile); setSel(r); setTab('body'); }}>
                      <span className={`hr-m ${methodTone(r.method)}`}>{r.method}</span><span className="nm">{r.name}</span>
                      {r.script && <KeyRound size={12} className="muted" aria-label={t('hw.script')} />}
                      {busy === r.id ? <span className="muted small">…</span> : tn ? <i className={`hr-dot ${tn}`} title={x?.run ? `${x.run.status}${x.run.tests.length ? ` · ${t('hw.tests.count', { ok: x.run.tests.filter((y) => y.passed).length, total: x.run.tests.length })}` : ''}` : x?.error} /> : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
          {scan.truncated && <p className="gx-note">{t('http.truncatedFiles')}</p>}
        </div>
        <div className="hw-session">
          <button className="hw-session-head" onClick={() => setShowSession((s) => !s)} aria-expanded={showSession}>
            {showSession ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<b>{t('hw.session')}</b><span className="muted small">{kept.length || ''}</span></button>
          {showSession && (<div className="hw-session-body">
            {kept.length === 0 && !adding && <p className="muted small" style={{ margin: 0 }}>{t('hw.session.empty')}</p>}
            {kept.map(([k, v]) => (
              <div key={k} className="hw-kv"><code className="mono" title={k}>{k}</code><span className="mono val" title={v}>{v}</span>
                <button className="btn ghost icon sm" onClick={() => void forget(k)} aria-label={t('hw.session.forget')} title={t('hw.session.forget')}><X size={13} /></button></div>))}
            {session.responses.length > 0 && <p className="muted small" style={{ margin: '6px 0 0' }}>{t('hw.session.answers')}: {session.responses.map((r) => `${r.name} (${r.status})`).join(', ')}</p>}
            {adding ? (
              <div className="hw-kv-add"><input className="input mono" placeholder={t('hw.session.name')} value={newName} onChange={(e) => setNewName(e.target.value)} aria-label={t('hw.session.name')} />
                <input className="input mono" placeholder={t('hw.session.value')} value={newValue} onChange={(e) => setNewValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setValue(); }} aria-label={t('hw.session.value')} />
                <button className="btn primary icon sm" onClick={setValue} aria-label={t('hw.session.add')}><Check size={14} /></button><button className="btn ghost icon sm" onClick={() => setAdding(false)} aria-label={t('common.cancel')}><X size={14} /></button></div>
            ) : (
              <div className="row gap-s" style={{ marginTop: 6 }}><button className="btn sm" onClick={() => setAdding(true)}><Plus size={13} />{t('hw.session.add')}</button>
                {(kept.length > 0 || session.responses.length > 0) && <button className="btn ghost sm" onClick={() => void forget()}><Trash2 size={13} />{t('hw.session.clear')}</button>}</div>)}
            <p className="muted small" style={{ margin: '6px 0 0' }}>{t('hw.session.hint')}</p>
          </div>)}
        </div>
      </aside>
      <section className="hr-detail">
        {sel ? (<>
          <div className="hr-reqhead">
            <span className={`hr-m ${methodTone(sel.method)}`}>{sel.method}</span>
            <code className="hr-url grow"><WithVars text={sel.url} /></code>
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
          <div className="row gap-s" style={{ padding: '8px 16px' }}>
            <Segmented value={tab} onChange={setTab} options={[{ id: 'body', label: t('http.body') }, { id: 'headers', label: `${t('http.headers')}${res?.run ? ` · ${res.run.headers.length}` : ''}` }, { id: 'tests', label: `${t('hw.tests')}${testsOf(res).length ? ` · ${testsOf(res).filter((x) => x.passed).length}/${testsOf(res).length}` : ''}` }, { id: 'request', label: t('http.request') }]} />
            <span className="grow" />
            {res?.run && <span className="row gap-s small">{res.run.set.length > 0 && <span className="chip" title={res.run.set.join(', ')}>{t('hw.kept', { names: res.run.set.join(', ') })}</span>}<b className={`hr-st ${statusTone(res.run.status)}`}>{res.run.status} {res.run.statusText}</b><span className="muted">{t('http.time', { ms: res.run.durationMs })} · {fmtBytes(res.run.size)}</span></span>}
          </div>
          {res?.run?.scriptError && <div className="gx-banner err">{t('hw.script.error', { error: res.run.scriptError })}</div>}
          {res?.run?.scriptFile && <div className="gx-banner">{t('hw.script.file', { file: res.run.scriptFile })}</div>}
          <div className="hr-out">
            {tab === 'request' ? (
              <div className="hr-pre">
                {(res?.run?.request.headers ?? sel.headers).map((h, i) => <div key={i}><b>{h.name}</b>: {res?.run ? h.value : <WithVars text={h.value} />}</div>)}
                {(res?.run?.request.body ?? sel.body) !== undefined && <><div className="eyebrow" style={{ margin: '12px 0 4px' }}>{t('http.requestBody')}</div><pre><WithVars text={res?.run?.request.body ?? sel.body ?? ''} /></pre></>}
                {sel.script && <><div className="eyebrow" style={{ margin: '12px 0 4px' }}>{t('hw.script')}</div><p className="muted small" style={{ margin: '0 0 6px' }}>{t('hw.script.hint')}</p><pre>{sel.script.trim()}</pre></>}
              </div>
            ) : tab === 'tests' ? (
              <div className="hr-pre">
                {!res?.run ? <p className="muted">{t('http.noResponse')}</p> : testsOf(res).length === 0 && res.run.logs.length === 0 ? <p className="muted">{t('hw.tests.none')}</p> : (<>
                  {testsOf(res).map((x, i) => <div key={i} className={`hw-test ${x.passed ? 'ok' : 'err'}`}>{x.passed ? <Check size={14} /> : <X size={14} />}<b>{x.name}</b>{x.message && <span className="muted"> — {x.message}</span>}</div>)}
                  {res.run.logs.length > 0 && <><div className="eyebrow" style={{ margin: '12px 0 4px' }}>{t('hw.console')}</div><pre>{res.run.logs.join('\n')}</pre></>}</>)}
              </div>
            ) : !res ? <p className="gx-note">{t('http.noResponse')}</p> : res.error ? <div className="gx-banner err" style={{ margin: 16, whiteSpace: 'pre-wrap' }}>{res.error}</div> : tab === 'headers' ? (
              <div className="hr-pre">{res.run!.headers.map((h, i) => <div key={i}><b>{h.name}</b>: {h.value}</div>)}</div>
            ) : (
              <div className="hr-pre">
                {res.run!.truncated && <div className="gx-banner">{t('http.truncated')}</div>}
                {res.run!.binary ? <p className="muted">{t('http.binary', { type: res.run!.contentType || '?', size: fmtBytes(res.run!.size) })}</p>
                  : res.run!.body ? <><div style={{ textAlign: 'right' }}><CopyBtn text={res.run!.body} /></div><pre>{prettyBody(res.run!)}</pre></> : <p className="muted">{t('http.emptyBody')}</p>}
              </div>
            )}
          </div>
        </>) : picked ? (
          <div className="hw-file-view">
            <div className="row gap-s"><File size={18} className="muted" /><h3 className="mono grow" style={{ fontSize: 15, overflowWrap: 'anywhere' }}>{picked.relFile}</h3>
              <label className="row gap-s small"><input type="checkbox" checked={stopOnFail} onChange={(e) => setStopOnFail(e.target.checked)} />{t('hw.stopOnFail')}</label>
              <button className="btn primary sm" disabled={!!busy} onClick={() => void runFile(picked)}><ListChecks size={14} />{t('http.runFile')}</button></div>
            <p className="muted small" style={{ margin: 0 }}>{t('hw.fileInfo', { count: picked.requests.length })}{Object.keys(picked.fileVariables).length ? ` · @${Object.keys(picked.fileVariables).join(', @')}` : ''}</p>
            {note && <div className="gx-banner">{note}</div>}
            <table className="cm-table"><thead><tr><th /><th>{t('obj.f.name')}</th><th>{t('hw.fileTests')}</th><th>{t('hw.lastRun')}</th></tr></thead><tbody>
              {picked.requests.map((r) => { const x = results[r.id]; const ts = testsOf(x); return (
                <tr key={r.id} className="hw-trow" onClick={() => { setSel(r); setTab('body'); }}>
                  <td><span className={`hr-m ${methodTone(r.method)}`}>{r.method}</span></td><td><b>{r.name}</b><div className="muted small mono hw-url"><WithVars text={r.url} /></div></td>
                  <td>{ts.length ? <span className={`hr-st ${ts.every((y) => y.passed) ? 'ok' : 'err'}`}>{ts.filter((y) => y.passed).length}/{ts.length}</span> : <span className="muted small">—</span>}</td>
                  <td>{x ? (x.run ? <span className={`hr-st ${tone(x)}`}><b>{x.run.status}</b> <span className="muted">{x.run.durationMs} ms</span></span> : <span className="hr-st err" title={x.error}>error</span>) : <span className="muted small">{t('hw.notRun')}</span>}</td></tr>); })}
            </tbody></table>
          </div>
        ) : <div className="gx-empty"><p>{t('hw.pickFile')}</p></div>}
      </section>
    </div>
  );
}
