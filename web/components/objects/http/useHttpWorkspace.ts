import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { useHive } from '@/lib/store';
import type { HttpConfig, HttpFile, HttpHistoryEntry, HttpInspection, HttpRequestItem, HttpRun, HttpScan, HttpSessionView, ObjectView } from '@/lib/types';
import { DEFAULT_ENV, tone, type Result } from './httpUi';

/** The state, callbacks and effects of the HTTP screen; the components next to it only draw what this returns. */
export function useHttpWorkspace(o: ObjectView) {
  const { t } = useI18n();
  const { refresh } = useHive();
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
  const [tab, setTab] = useState<'body' | 'headers' | 'tests' | 'request' | 'vars' | 'auth'>('body');
  const [fileTab, setFileTab] = useState<'requests' | 'vars' | 'source'>('requests');
  const [bodyView, setBodyView] = useState<'tree' | 'text'>('tree');
  const [bodyFilter, setBodyFilter] = useState('');
  const [insp, setInsp] = useState<HttpInspection | null>(null);
  const [fileInsp, setFileInsp] = useState<HttpInspection | null>(null);
  const [openAns, setOpenAns] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [batch, setBatch] = useState(false);
  const [hist, setHist] = useState<HttpHistoryEntry[]>([]);
  const [histSel, setHistSel] = useState<number | null>(null);
  const [cmp, setCmp] = useState<number | 'prev' | null>(null);
  const loadHistory = useCallback(() => api.get<HttpHistoryEntry[]>(`/objects/${o.id}/http/history`).then(setHist).catch(() => undefined), [o.id]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);
  const [session, setSession] = useState<HttpSessionView>({ globals: {}, responses: [] });
  const [stopOnFail, setStopOnFail] = useState(false);
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState<'history' | 'session' | null>(null);
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

  const inspect = useCallback((f?: string, index?: number): Promise<HttpInspection> =>
    api.get<HttpInspection>(`/objects/${o.id}/http/variables?${[f ? `file=${encodeURIComponent(f)}` : '', index !== undefined ? `index=${index}` : '', env ? `env=${encodeURIComponent(env)}` : ''].filter(Boolean).join('&')}`), [o.id, env]);
  const refreshInsp = useCallback(() => {
    if (sel) void inspect(fileOf.current.get(sel.id), sel.index).then(setInsp).catch(() => setInsp(null)); else setInsp(null);
    if (file) void inspect(file).then(setFileInsp).catch(() => setFileInsp(null));
  }, [inspect, sel?.id, file]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { refreshInsp(); }, [refreshInsp, session, o.updated_at]);

  const run = useCallback(async (r: HttpRequestItem): Promise<Result> => {
    const f = fileOf.current.get(r.id); if (!f) return { error: '', at: Date.now() };
    setBusy(r.id);
    let out: Result;
    try { out = { run: await api.post<HttpRun>(`/objects/${o.id}/http/run`, { file: f, index: r.index, env: env || undefined }), at: Date.now() }; }
    catch (e) { out = { error: e instanceof Error ? e.message : 'error', at: Date.now() }; }
    setResults((x) => ({ ...x, [r.id]: out })); setBusy(null); void loadHistory(); void loadSession();
    return out;
  }, [o.id, env, loadSession, loadHistory]);
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
  const setValue = () => {
    const name = newName.trim(); if (!name) return;
    const cfg = o.config as HttpConfig, vars = { ...(cfg.variables ?? {}) };
    vars[DEFAULT_ENV] = { ...(vars[DEFAULT_ENV] ?? {}), [name]: { value: newValue } };
    api.patch(`/objects/${o.id}`, { config: { folder: cfg.folder, env: cfg.env, variables: vars } })
      .then(() => { setNewName(''); setNewValue(''); setAdding(false); setEnv(DEFAULT_ENV); return refresh(['objects']); }).catch(() => undefined);
  };
  const kept = Object.entries(session.globals);
  const setVar = (name: string, value: string) => api.post<HttpSessionView>(`/objects/${o.id}/http/session`, { name, value }).then(setSession).catch(() => undefined);
  const runNamed = (n: string) => { const r = byName.current.get(n); if (r) { setFile(fileOf.current.get(r.id) ?? file); setSel(r); setTab('body'); void run(r); } };
  const statusByIndex = (f: HttpFile) => Object.fromEntries(f.requests.map((r) => [r.index, tone(results[r.id])])) as Record<number, 'ok' | 'warn' | 'err' | ''>;
  return {
    o, scan, err, env, setEnv, q, setQ, file, setFile, sel, setSel, open, setOpen, results, busy, missing, needsRun,
    tab, setTab, fileTab, setFileTab, bodyView, setBodyView, bodyFilter, setBodyFilter, insp, fileInsp,
    creating, setCreating, batch, setBatch, hist, setHist, histSel, setHistSel, cmp, setCmp, loadHistory, loadSession,
    session, setSession, stopOnFail, setStopOnFail, note, confirm, setConfirm, fileOf, byName, load, run, runFile, refreshInsp,
    files, picked, res, summary, testsOf, forget, newName, setNewName, newValue, setNewValue, adding, setAdding, setValue,
    kept, setVar, runNamed, statusByIndex,
  };
}

export type HttpWs = ReturnType<typeof useHttpWorkspace>;
