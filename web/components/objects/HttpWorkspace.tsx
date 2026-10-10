'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, File, ListChecks, Play, RefreshCw, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { fmtBytes } from '@/lib/format';
import type { HttpConfig, HttpFile, HttpRequestItem, HttpRun, HttpScan, ObjectView } from '@/lib/types';
import { Segmented } from '@/components/ui';
import { CopyBtn } from '@/components/chat/ToolCall';

interface Result { run?: HttpRun; error?: string; at: number }
const methodTone = (m: string) => (m === 'GET' ? 'get' : m === 'POST' ? 'post' : m === 'DELETE' ? 'del' : m === 'PUT' || m === 'PATCH' ? 'put' : 'other');
const statusTone = (s: number) => (s >= 200 && s < 300 ? 'ok' : s >= 300 && s < 400 ? 'warn' : 'err');

function WithVars({ text }: { text: string }) {
  return <>{text.split(/(\{\{[^}]+\}\})/g).map((p, i) => (p.startsWith('{{') ? <span key={i} className="hr-var">{p}</span> : p))}</>;
}
function prettyBody(run: HttpRun): string {
  if (/json/i.test(run.contentType) || /^\s*[[{]/.test(run.body)) { try { return JSON.stringify(JSON.parse(run.body), null, 2); } catch { /* not complete JSON */ } }
  return run.body;
}

/**
 * The requests of an HTTP object as a screen: the .http files at the left (pick the one you want to try, or run it whole), its requests
 * under it, and the request and its answer on the right. The environment comes from the env files and from the object's own variables.
 */
export function HttpWorkspace({ object: o, onOpenVars }: { object: ObjectView; onOpenVars: () => void }) {
  const { t } = useI18n();
  const [scan, setScan] = useState<HttpScan | null>(null);
  const [err, setErr] = useState('');
  const [env, setEnv] = useState((o.config as HttpConfig).env ?? '');
  const [q, setQ] = useState('');
  const [file, setFile] = useState<string | null>(null);              // the file picked
  const [sel, setSel] = useState<HttpRequestItem | null>(null);       // the request picked
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, Result>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [tab, setTab] = useState<'body' | 'headers' | 'request'>('body');
  const fileOf = useRef(new Map<string, string>());

  const load = useCallback(() => {
    setErr('');
    api.get<HttpScan>(`/objects/${o.id}/http`).then((s) => {
      setScan(s); fileOf.current = new Map(s.files.flatMap((f) => f.requests.map((r) => [r.id, f.relFile] as const)));
      setFile((cur) => cur && s.files.some((f) => f.relFile === cur) ? cur : s.files[0]?.relFile ?? null);
      setOpen((cur) => (cur.size ? cur : new Set(s.files.slice(0, 1).map((f) => f.relFile))));
      setSel((cur) => cur && fileOf.current.has(cur.id) ? cur : null);
      const def = (o.config as HttpConfig).env ?? '';
      setEnv((e) => (e && s.environments.includes(e) ? e : def && s.environments.includes(def) ? def : s.environments[0] ?? ''));
    }).catch((e) => setErr(e instanceof Error ? e.message : t('git.loadError')));
  }, [o.id, o.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!sel) { setMissing([]); return; }
    let dead = false;
    api.get<{ missing: string[] }>(`/objects/${o.id}/http/describe?file=${encodeURIComponent(fileOf.current.get(sel.id) ?? '')}&index=${sel.index}${env ? `&env=${encodeURIComponent(env)}` : ''}`).then((r) => !dead && setMissing(r.missing)).catch(() => !dead && setMissing([]));
    return () => { dead = true; };
  }, [o.id, o.updated_at, sel?.id, env]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = useCallback(async (r: HttpRequestItem) => {
    const f = fileOf.current.get(r.id); if (!f) return;
    setBusy(r.id);
    try {
      const res = await api.post<HttpRun>(`/objects/${o.id}/http/run`, { file: f, index: r.index, env: env || undefined });
      setResults((x) => ({ ...x, [r.id]: { run: res, at: Date.now() } }));
    } catch (e) { setResults((x) => ({ ...x, [r.id]: { error: e instanceof Error ? e.message : 'error', at: Date.now() } })); }
    finally { setBusy(null); }
  }, [o.id, env]);
  const runFile = async (f: HttpFile) => { for (const r of f.requests) await run(r); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && sel && !busy) { e.preventDefault(); void run(sel); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [sel, busy, run]);

  const files = useMemo(() => (scan?.files ?? []).map((f) => ({ ...f, requests: f.requests.filter((r) => !q || `${r.name} ${r.url} ${r.method}`.toLowerCase().includes(q.toLowerCase()) || f.relFile.toLowerCase().includes(q.toLowerCase())) })).filter((f) => f.requests.length), [scan, q]);
  const picked = scan?.files.find((f) => f.relFile === file) ?? null;
  const res = sel ? results[sel.id] : undefined;
  const summary = (f: HttpFile) => { const done = f.requests.filter((r) => results[r.id]); return done.length ? `${done.filter((r) => results[r.id].run && statusTone(results[r.id].run!.status) === 'ok').length}/${f.requests.length}` : null; };

  if (err) return <p className="gx-note err" style={{ padding: 20 }}>{err}</p>;
  if (!scan) return <p className="gx-note">{t('git.loading')}</p>;
  return (
    <div className="hw">
      <aside className="hw-list">
        <div className="hw-env">
          <label className="row gap-s small grow"><span className="muted">{t('http.env')}</span>
            <select className="select" style={{ width: 'auto', padding: '4px 10px', flex: 1 }} value={env} onChange={(e) => setEnv(e.target.value)}>
              <option value="">{t('http.noEnv')}</option>{scan.environments.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          <button className="btn ghost icon sm" onClick={load} aria-label={t('http.rescan')} title={t('http.rescan')}><RefreshCw size={15} /></button>
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
                  const x = results[r.id];
                  return (
                    <button key={r.id} className={`hr-req ${sel?.id === r.id ? 'sel' : ''}`} style={{ paddingLeft: 30 }} onClick={() => { setFile(f.relFile); setSel(r); setTab('body'); }}>
                      <span className={`hr-m ${methodTone(r.method)}`}>{r.method}</span><span className="nm">{r.name}</span>
                      {busy === r.id ? <span className="muted small">…</span> : x ? <i className={`hr-dot ${x.run ? statusTone(x.run.status) : 'err'}`} title={x.run ? String(x.run.status) : x.error} /> : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
          {scan.truncated && <p className="gx-note">{t('http.truncatedFiles')}</p>}
        </div>
      </aside>
      <section className="hr-detail">
        {sel ? (<>
          <div className="hr-reqhead">
            <span className={`hr-m ${methodTone(sel.method)}`}>{sel.method}</span>
            <code className="hr-url grow"><WithVars text={sel.url} /></code>
            <button className="btn primary sm" disabled={!!busy || missing.length > 0} onClick={() => void run(sel)} title="Ctrl+Enter"><Play size={14} />{busy === sel.id ? t('http.running') : t('http.run')}</button>
          </div>
          {missing.length > 0 && <div className="gx-banner row gap-s"><AlertTriangle size={15} /><span className="grow">{t('http.missing', { names: missing.map((m) => `{{${m}}}`).join(', ') })}. {t('http.missing.hint')}</span><button className="btn sm" onClick={onOpenVars}>{t('hw.editVars')}</button></div>}
          <div className="row gap-s" style={{ padding: '8px 16px' }}>
            <Segmented value={tab} onChange={setTab} options={[{ id: 'body', label: t('http.body') }, { id: 'headers', label: `${t('http.headers')}${res?.run ? ` · ${res.run.headers.length}` : ''}` }, { id: 'request', label: t('http.request') }]} />
            <span className="grow" />
            {res?.run && <span className="row gap-s small"><b className={`hr-st ${statusTone(res.run.status)}`}>{res.run.status} {res.run.statusText}</b><span className="muted">{t('http.time', { ms: res.run.durationMs })} · {fmtBytes(res.run.size)}</span></span>}
          </div>
          <div className="hr-out">
            {tab === 'request' ? (
              <div className="hr-pre">
                {(res?.run?.request.headers ?? sel.headers).map((h, i) => <div key={i}><b>{h.name}</b>: {res?.run ? h.value : <WithVars text={h.value} />}</div>)}
                {(res?.run?.request.body ?? sel.body) !== undefined && <><div className="eyebrow" style={{ margin: '12px 0 4px' }}>{t('http.requestBody')}</div><pre><WithVars text={res?.run?.request.body ?? sel.body ?? ''} /></pre></>}
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
              <button className="btn primary sm" disabled={!!busy} onClick={() => void runFile(picked)}><ListChecks size={14} />{t('http.runFile')}</button></div>
            <p className="muted small" style={{ margin: 0 }}>{t('hw.fileInfo', { count: picked.requests.length })} · {Object.keys(picked.fileVariables).length ? `@${Object.keys(picked.fileVariables).join(', @')}` : ''}</p>
            <table className="cm-table"><thead><tr><th /><th>{t('obj.f.name')}</th><th>{t('hw.lastRun')}</th></tr></thead><tbody>
              {picked.requests.map((r) => { const x = results[r.id]; return (
                <tr key={r.id} className="hw-trow" onClick={() => { setSel(r); setTab('body'); }}>
                  <td><span className={`hr-m ${methodTone(r.method)}`}>{r.method}</span></td><td><b>{r.name}</b><div className="muted small mono hw-url"><WithVars text={r.url} /></div></td>
                  <td>{x ? (x.run ? <span className={`hr-st ${statusTone(x.run.status)}`}><b>{x.run.status}</b> <span className="muted">{x.run.durationMs} ms</span></span> : <span className="hr-st err" title={x.error}>error</span>) : <span className="muted small">{t('hw.notRun')}</span>}</td></tr>); })}
            </tbody></table>
          </div>
        ) : <div className="gx-empty"><p>{t('hw.pickFile')}</p></div>}
      </section>
    </div>
  );
}
