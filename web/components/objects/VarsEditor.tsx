'use client';
import { useState } from 'react';
import { Eye, EyeOff, Lock, Plus, Trash2, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n/index';
import type { HttpVariable } from '@/lib/types';

export type Vars = Record<string, Record<string, HttpVariable>>;
const SHARED = '$shared';

/**
 * Environments and their variables for an HTTP object, for when there is no http-client.env.json (or it lacks something). A secret is
 * hidden once saved: it shows as "saved" and is only replaced when a new value is typed. What an env file defines wins over these values.
 */
export function VarsEditor({ value, onChange, fileEnvs = [], fileVars = {} }: { value: Vars; onChange: (v: Vars) => void; fileEnvs?: string[]; fileVars?: Record<string, string[]> }) {
  const { t } = useI18n();
  const names = [SHARED, ...[...new Set([...Object.keys(value), ...fileEnvs])].filter((k) => k !== SHARED).sort()];
  // Opens on the first environment that has variables of its own (Shared otherwise).
  const [env, setEnv] = useState(() => names.find((n) => n !== SHARED && Object.keys(value[n] ?? {}).length > 0) ?? names[0]);
  const [adding, setAdding] = useState('');
  const [peek, setPeek] = useState<Record<string, boolean>>({});
  const cur = value[env] ?? {};
  const fromFile = new Set([...(fileVars[SHARED] ?? []).filter(() => env !== SHARED), ...(fileVars[env] ?? [])]);

  const setVar = (name: string, patch: Partial<HttpVariable>, rename?: string) => {
    // Renaming keeps the row where it is (and the input keeps the focus: rows are keyed by position, not by name).
    if (rename !== undefined && rename !== name && rename in cur) return;
    const entries = Object.entries(cur).map(([k, v]) => (k === name ? ([rename ?? k, { ...v, ...patch }] as const) : ([k, v] as const)));
    onChange({ ...value, [env]: Object.fromEntries(entries) });
  };
  const del = (name: string) => { const e = { ...cur }; delete e[name]; onChange({ ...value, [env]: e }); };
  const addVar = () => { let n = 'name', i = 1; while (n in cur) n = `name${++i}`; onChange({ ...value, [env]: { ...cur, [n]: { value: '' } } }); };
  const addEnv = () => { const n = adding.trim(); if (!/^[\w.$-]{1,60}$/.test(n) || n in value) return; onChange({ ...value, [n]: {} }); setEnv(n); setAdding(''); };
  const delEnv = () => { const v = { ...value }; delete v[env]; onChange(v); setEnv(SHARED); };

  return (
    <div className="vars">
      <div className="vars-envs" role="tablist">
        {names.map((n) => (
          <button key={n} type="button" role="tab" aria-selected={env === n} className={`vars-env ${env === n ? 'on' : ''}`} onClick={() => setEnv(n)} title={n === SHARED ? t('vars.shared.hint') : undefined}>
            {n === SHARED ? t('vars.shared') : n}{fileEnvs.includes(n) && <i className="vars-file" title={t('vars.fromFile')}>·</i>}
          </button>
        ))}
        <span className="vars-add"><input className="input" placeholder={t('vars.newEnv')} value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEnv(); } }} aria-label={t('vars.newEnv')} />
          <button type="button" className="btn ghost icon sm" onClick={addEnv} disabled={!adding.trim()} aria-label={t('vars.newEnv')}><Plus size={14} /></button></span>
      </div>
      <div className="vars-table">
        {Object.keys(cur).length === 0 && <p className="muted small" style={{ margin: '8px 2px' }}>{t('vars.empty')}</p>}
        {Object.entries(cur).map(([name, v], idx) => {
          const key = `${env}/${idx}`, hidden = v.secret && !peek[key];
          return (
            <div key={`${env}:${idx}`} className="vars-row">
              <input className="input mono" value={name} onChange={(e) => setVar(name, {}, e.target.value.trim())} aria-label={t('vars.name')} placeholder={t('vars.name')} />
              <input className="input mono" type={hidden ? 'password' : 'text'} value={v.value} onChange={(e) => setVar(name, { value: e.target.value })} aria-label={t('vars.value')}
                placeholder={v.secret && v.set && !v.value ? t('vars.saved') : t('vars.value')} autoComplete="off" />
              <button type="button" className={`btn ghost icon sm ${v.secret ? 'on' : ''}`} aria-pressed={!!v.secret} onClick={() => setVar(name, { secret: !v.secret })} aria-label={t('vars.secret')} title={t('vars.secret.hint')}><Lock size={14} /></button>
              {v.secret && <button type="button" className="btn ghost icon sm" onClick={() => setPeek((p) => ({ ...p, [key]: !p[key] }))} aria-label={t('vars.show')} title={t('vars.show')}>{peek[key] ? <EyeOff size={14} /> : <Eye size={14} />}</button>}
              <button type="button" className="btn ghost icon sm" onClick={() => del(name)} aria-label={t('common.delete')}><Trash2 size={14} /></button>
              {fromFile.has(name) && <span className="vars-note">{t('vars.overridden')}</span>}
            </div>
          );
        })}
      </div>
      <div className="row gap-s">
        <button type="button" className="btn sm" onClick={addVar}><Plus size={14} />{t('vars.add')}</button>
        {env !== SHARED && !fileEnvs.includes(env) && <button type="button" className="btn ghost sm" onClick={delEnv}><X size={14} />{t('vars.delEnv')}</button>}
      </div>
      <p className="muted small" style={{ margin: 0 }}>{t('vars.note')}</p>
    </div>
  );
}
