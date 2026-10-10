'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ListChecks, Play, RefreshCw, Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { fmtBytes } from '@/lib/format';
import type { HttpConfig, HttpRequestItem, HttpRun, HttpScan, ObjectView } from '@/lib/types';
import { Segmented } from '@/components/ui';
import { CopyBtn } from '@/components/chat/ToolCall';

interface Result { run?: HttpRun; error?: string; at: number }
const methodTone = (m: string) => (m === 'GET' ? 'get' : m === 'POST' ? 'post' : m === 'DELETE' ? 'del' : m === 'PUT' || m === 'PATCH' ? 'put' : 'other');
const statusTone = (s: number) => (s >= 200 && s < 300 ? 'ok' : s >= 300 && s < 400 ? 'warn' : 'err');

/** `{{name}}` of a request shown apart, so what comes from an environment stands out. */
function WithVars({ text }: { text: string }) {
  const parts = text.split(/(\{\{[^}]+\}\})/g);
  return <>{parts.map((p, i) => (p.startsWith('{{') ? <span key={i} className="hr-var">{p}</span> : p))}</>;
}

function prettyBody(run: HttpRun): string {
  if (/json/i.test(run.contentType) || /^\s*[[{]/.test(run.body)) { try { return JSON.stringify(JSON.parse(run.body), null, 2); } catch { /* not complete JSON */ } }
  return run.body;
}

/** The runner of an HTTP object: the requests of its .http files on the left, the selected one and its answer on the right. */
export function HttpRunner({ object: o, onClose }: { object: ObjectView; onClose: () => void }) {
  const { t } = useI18n();
  const [scan, setScan] = useState<HttpScan | null>(null);
  const [err, setErr] = useState('');
  const [env, setEnv] = useState((o.config as HttpConfig).env ?? '');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<HttpRequestItem | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [tab, setTab] = useState<'body' | 'headers' | 'request'>('body');
  const fileOf = useRef(new Map<string, string>());       // request id → file

  const load = useCallback(() => {
    setErr('');
    api.get<HttpScan>(`/objects/${o.id}/http`).then((s) => {
      setScan(s); fileOf.current = new Map(s.files.flatMap((f) => f.requests.map((r) => [r.id, f.relFile] as const)));
      setSel((cur) => cur && s.files.some((f) => f.requests.some((r) => r.id === cur.id)) ? cur : s.files[0]?.requests[0] ?? null);
      setEnv((e) => e || (s.environments.includes((o.config as HttpConfig).env ?? '') ? (o.config as HttpConfig).env ?? '' : ''));
    }).catch((e) => setErr(e instanceof Error ? e.message : t('git.loadError')));
  }, [o.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

  // Which values the selected request still lacks in the chosen environment.
  useEffect(() => {
    if (!sel) { setMissing([]); return; }
    let dead = false;
    api.get<{ missing: string[] }>(`/objects/${o.id}/http/describe?file=${encodeURIComponent(fileOf.current.get(sel.id) ?? '')}&index=${sel.index}${env ? `&env=${encodeURIComponent(env)}` : ''}`).then((r) => !dead && setMissing(r.missing)).catch(() => !dead && setMissing([]));
    return () => { dead = true; };
  }, [o.id, sel?.id, env]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = useCallback(async (r: HttpRequestItem) => {
    const file = fileOf.current.get(r.id); if (!file) return;
    setBusy(r.id);
    try {
      const res = await api.post<HttpRun>(`/objects/${o.id}/http/run`, { file, index: r.index, env: env || undefined });
      setResults((x) => ({ ...x, [r.id]: { run: res, at: Date.now() } }));
    } catch (e) { setResults((x) => ({ ...x, [r.id]: { error: e instanceof Error ? e.message : 'error', at: Date.now() } })); }
    finally { setBusy(null); }
  }, [o.id, env]);
  const runFile = async (file: string) => { const f = scan?.files.find((x) => x.relFile === file); if (!f) return; for (const r of f.requests) { setSel(r); await run(r); } };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && sel && !busy) { e.preventDefault(); void run(sel); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [sel, busy, run]);

  const files = useMemo(() => (scan?.files ?? []).map((f) => ({ ...f, requests: f.requests.filter((r) => !q || `${r.name} ${r.url} ${r.method}`.toLowerCase().includes(q.toLowerCase())) })).filter((f) => f.requests.length), [scan, q]);
  const res = sel ? results[sel.id] : undefined;
  const fileSummary = (rel: string) => { const f = scan?.files.find((x) => x.relFile === rel); const done = f?.requests.filter((r) => results[r.id]) ?? []; if (!f || done.length < 2) return null; return t('http.fileResults', { ok: done.filter((r) => results[r.id].run && results[r.id].run!.status < 300 && results[r.id].run!.status >= 200).length, total: done.length }); };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="hr" role="dialog" aria-modal aria-label={t('http.title')}>
        <header className="hr-head">
          <b style={{ fontFamily: 'var(--font-display)', fontSize: 18 }}>{o.name}</b>
          <span className="muted small mono grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(o.config as HttpConfig).folder}</span>
          <label className="row gap-s small"><span className="muted">{t('http.env')}</span>
            <select className="select" style={{ width: 'auto', padding: '4px 10px' }} value={env} onChange={(e) => setEnv(e.target.value)}>
              <option value="">{t('http.noEnv')}</option>{(scan?.environments ?? []).map((e) => <option key={e} value={e}>{e}</option>)}
            </select></label>
          <button className="btn ghost icon sm" onClick={load} aria-label={t('http.rescan')} title={t('http.rescan')}><RefreshCw size={15} /></button>
          <button className="btn ghost icon sm" onClick={onClose} aria-label={t('common.close')}><X size={16} /></button>
        </header>
        {err ? <p className="gx-note err" style={{ padding: 20 }}>{err}</p> : !scan ? <p className="gx-note">{t('git.loading')}</p> : !scan.files.length ? <p className="gx-note" style={{ padding: 20 }}>{t('http.empty')}</p> : (
          <div className="hr-main">
            <aside className="hr-list">
              <div className="gx-filter"><div className="search"><Search size={14} /><input className="input" placeholder={t('http.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('http.search')} /></div></div>
              <div className="hr-reqs">
                {files.map((f) => (
                  <div key={f.relFile}>
                    <div className="hr-file"><span className="mono nm" title={f.relFile}>{f.relFile}</span>
                      <button className="btn ghost icon sm" disabled={!!busy} onClick={() => void runFile(f.relFile)} aria-label={t('http.runFile')} title={t('http.runFile')}><ListChecks size={15} /></button></div>
                    {fileSummary(f.relFile) && <div className="muted small" style={{ padding: '0 12px 4px' }}>{fileSummary(f.relFile)}</div>}
                    {f.requests.map((r) => {
                      const x = results[r.id];
                      return (
                        <button key={r.id} className={`hr-req ${sel?.id === r.id ? 'sel' : ''}`} onClick={() => { setSel(r); setTab('body'); }}>
                          <span className={`hr-m ${methodTone(r.method)}`}>{r.method}</span><span className="nm">{r.name}</span>
                          {busy === r.id ? <span className="muted small">…</span> : x ? <i className={`hr-dot ${x.run ? statusTone(x.run.status) : 'err'}`} title={x.run ? String(x.run.status) : x.error} /> : null}
                        </button>
                      );
                    })}
                  </div>
                ))}
                {scan.truncated && <p className="gx-note">{t('http.truncatedFiles')}</p>}
              </div>
            </aside>
            <section className="hr-detail">
              {!sel ? <div className="gx-empty"><p>{t('http.pick')}</p></div> : (<>
                <div className="hr-reqhead">
                  <span className={`hr-m ${methodTone(sel.method)}`}>{sel.method}</span>
                  <code className="hr-url grow"><WithVars text={sel.url} /></code>
                  <button className="btn primary sm" disabled={!!busy || missing.length > 0} onClick={() => void run(sel)} title="Ctrl+Enter"><Play size={14} />{busy === sel.id ? t('http.running') : t('http.run')}</button>
                </div>
                {missing.length > 0 && <div className="gx-banner row gap-s"><AlertTriangle size={15} /><span>{t('http.missing', { names: missing.map((m) => `{{${m}}}`).join(', ') })}. {t('http.missing.hint')}</span></div>}
                <div className="row gap-s" style={{ padding: '8px 16px' }}>
                  <Segmented value={tab} onChange={setTab} options={[{ id: 'body', label: t('http.body') }, { id: 'headers', label: `${t('http.headers')}${res?.run ? ` · ${res.run.headers.length}` : ''}` }, { id: 'request', label: t('http.request') }]} />
                  <span className="grow" />
                  {res?.run && (<span className="row gap-s small"><b className={`hr-st ${statusTone(res.run.status)}`}>{res.run.status} {res.run.statusText}</b><span className="muted">{t('http.time', { ms: res.run.durationMs })} · {fmtBytes(res.run.size)}</span></span>)}
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
              </>)}
            </section>
          </div>
        )}
      </div>
    </>
  );
}
