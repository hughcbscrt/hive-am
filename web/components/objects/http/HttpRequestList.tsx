import { ChevronDown, ChevronRight, File, KeyRound, ListChecks, Plus, RefreshCw } from 'lucide-react';
import { useI18n } from '@/lib/i18n/index';
import type { HttpScan } from '@/lib/types';
import { SearchInput } from '@/components/ui';
import { methodTone, tone } from './httpUi';
import type { HttpWs } from './useHttpWorkspace';

/** The aside of the requests pane: environment, search, and the .http files with their requests and last result. */
export function HttpRequestList({ ws, scan, onOpenVars }: { ws: HttpWs; scan: HttpScan; onOpenVars: () => void }) {
  const { t } = useI18n();
  const { env, setEnv, q, setQ, file, setFile, sel, setSel, open, setOpen, results, busy, setTab, setCreating, load, loadSession, files, summary, runFile } = ws;
  return (
    <aside className="hw-list">
      <div className="hw-env">
        <label className="row gap-s small grow"><span className="muted">{t('http.env')}</span>
          <select className="select hw-envsel" value={env} onChange={(e) => setEnv(e.target.value)}>
            <option value="">{t('http.noEnv')}</option>{scan.environments.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
        <button className="btn ghost icon sm" onClick={() => setCreating(true)} aria-label={t('hw2.new.title')} title={t('hw2.new.title')}><Plus size={15} /></button>
        <button className="btn ghost icon sm" onClick={() => { load(); void loadSession(); }} aria-label={t('http.rescan')} title={t('http.rescan')}><RefreshCw size={15} /></button>
      </div>
      {scan.envFiles.length === 0 && scan.environments.length === 0 && <p className="muted small hw-hint">{t('hw.noEnvFile')} <button className="btn sm" onClick={onOpenVars}>{t('hw.editVars')}</button></p>}
      <div className="gx-filter"><SearchInput value={q} onChange={setQ} placeholder={t('http.search')} label={t('http.search')} /></div>
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
                  <button key={r.id} className={`hr-req hr-req-sub ${sel?.id === r.id ? 'sel' : ''}`} onClick={() => { setFile(f.relFile); setSel(r); setTab('body'); }}>
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
    </aside>
  );
}
