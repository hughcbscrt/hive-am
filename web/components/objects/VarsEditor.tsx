'use client';
import { useState } from 'react';
import { Check, Eye, EyeOff, Info, Lock, Plus, Trash2, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n/index';
import type { HttpVariable } from '@/lib/types';
import { Suggest } from './Suggest';

export type Vars = Record<string, Record<string, HttpVariable>>;
const ALL = '$shared';      // what the files call it; to the person it is "All environments"
type Status = 'here' | 'all' | 'envfile' | 'atfile' | 'handler' | 'missing';

/**
 * The variables of an HTTP object, for when there is no env file (or it lacks something). "All environments" holds the values that apply
 * whichever environment is picked; each environment holds its own. The editor says how that works, lists the variables the requests use
 * (and which ones still have no value) and suggests those names when you add one. A secret is hidden once saved and replaced only when a
 * new value is typed. What an env file, or an @name line in a .http file, defines wins over these values.
 */
export function VarsEditor({ value, onChange, fileEnvs = [], fileVars = {}, used = [], fileDefined = [], setBy = {} }: {
  value: Vars; onChange: (v: Vars) => void; fileEnvs?: string[]; fileVars?: Record<string, string[]>;
  used?: { name: string; count: number }[]; fileDefined?: string[]; setBy?: Record<string, string[]>;
}) {
  const { t } = useI18n();
  const names = [ALL, ...[...new Set([...Object.keys(value), ...fileEnvs])].filter((k) => k !== ALL).sort()];
  // Opens on the first environment that has variables of its own (All environments otherwise).
  const [env, setEnv] = useState(() => names.find((n) => n !== ALL && Object.keys(value[n] ?? {}).length > 0) ?? names[0]);
  const [adding, setAdding] = useState('');
  const [peek, setPeek] = useState<Record<string, boolean>>({});
  const [help, setHelp] = useState(true);
  const cur = value[env] ?? {};
  const fromFile = new Set([...(env !== ALL ? fileVars[ALL] ?? [] : []), ...(fileVars[env] ?? [])]);

  const statusOf = (name: string): Status =>
    name in cur ? 'here' : env !== ALL && name in (value[ALL] ?? {}) ? 'all'
    : (fileVars[env] ?? []).includes(name) || (fileVars[ALL] ?? []).includes(name) ? 'envfile'
    : fileDefined.includes(name) ? 'atfile' : setBy[name] ? 'handler' : 'missing';
  const suggestions = used.filter((u) => !(u.name in cur)).map((u) => ({ value: u.name, hint: t('vars.used.count', { count: u.count }) }));

  const setVar = (name: string, patch: Partial<HttpVariable>, rename?: string) => {
    // Renaming keeps the row where it is, and the input keeps the focus (rows are keyed by position, not by name).
    if (rename !== undefined && rename !== name && rename in cur) return;
    const entries = Object.entries(cur).map(([k, v]) => (k === name ? ([rename ?? k, { ...v, ...patch }] as const) : ([k, v] as const)));
    onChange({ ...value, [env]: Object.fromEntries(entries) });
  };
  const del = (name: string) => { const e = { ...cur }; delete e[name]; onChange({ ...value, [env]: e }); };
  const addVar = (name?: string) => { let n = name ?? 'name', i = 1; while (n in cur) n = `${name ?? 'name'}${++i}`; onChange({ ...value, [env]: { ...cur, [n]: { value: '' } } }); };
  const addEnv = () => { const n = adding.trim(); if (!/^[\w.$-]{1,60}$/.test(n) || n in value || n === ALL) return; onChange({ ...value, [n]: {} }); setEnv(n); setAdding(''); };
  const delEnv = () => { const v = { ...value }; delete v[env]; onChange(v); setEnv(ALL); };

  return (
    <div className="vars">
      <button type="button" className="vars-how-btn" aria-expanded={help} onClick={() => setHelp((h) => !h)}><Info size={14} />{t('vars.how.title')}</button>
      {help && <div className="vars-how"><p>{t('vars.how.1')}</p><p>{t('vars.how.2')}</p><p className="muted small">{t('vars.note')}</p></div>}

      <div className="vars-envs" role="tablist">
        {names.map((n) => (
          <button key={n} type="button" role="tab" aria-selected={env === n} className={`vars-env ${env === n ? 'on' : ''}`} onClick={() => setEnv(n)} title={n === ALL ? t('vars.all.hint') : undefined}>
            {n === ALL ? t('vars.all') : n}{fileEnvs.includes(n) && <i className="vars-file" title={t('vars.fromFile')}>·</i>}
          </button>
        ))}
        <span className="vars-add"><input className="input" placeholder={t('vars.newEnv')} value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEnv(); } }} aria-label={t('vars.newEnv')} />
          <button type="button" className="btn ghost icon sm" onClick={addEnv} disabled={!adding.trim()} aria-label={t('vars.newEnv')}><Plus size={14} /></button></span>
      </div>
      <p className="muted small vars-scope">{env === ALL ? t('vars.scope.all') : t('vars.scope.env', { env })}</p>

      <div className="vars-table">
        {Object.keys(cur).length === 0 && <p className="muted small" style={{ margin: '4px 2px' }}>{t('vars.empty')}</p>}
        {Object.entries(cur).map(([name, v], idx) => {
          const key = `${env}/${idx}`, hidden = v.secret && !peek[key];
          return (
            <div key={`${env}:${idx}`} className="vars-row">
              <Suggest value={name} onChange={(x) => setVar(name, {}, x.trim())} options={suggestions} mono placeholder={t('vars.name')} ariaLabel={t('vars.name')} />
              <input className="input mono" type={hidden ? 'password' : 'text'} value={v.value} onChange={(e) => setVar(name, { value: e.target.value })} aria-label={t('vars.value')}
                placeholder={v.secret && v.set && !v.value ? t('vars.saved') : t('vars.value')} autoComplete="off" />
              <button type="button" className={`btn ghost icon sm ${v.secret ? 'on' : ''}`} aria-pressed={!!v.secret} onClick={() => setVar(name, { secret: !v.secret })} aria-label={t('vars.secret')} title={t('vars.secret.hint')}><Lock size={14} /></button>
              {v.secret ? <button type="button" className="btn ghost icon sm" onClick={() => setPeek((p) => ({ ...p, [key]: !p[key] }))} aria-label={t('vars.show')} title={t('vars.show')}>{peek[key] ? <EyeOff size={14} /> : <Eye size={14} />}</button> : <span />}
              <button type="button" className="btn ghost icon sm" onClick={() => del(name)} aria-label={t('common.delete')}><Trash2 size={14} /></button>
              {fromFile.has(name) && <span className="vars-note">{t('vars.overridden')}</span>}
            </div>
          );
        })}
      </div>
      <div className="row gap-s">
        <button type="button" className="btn sm" onClick={() => addVar()}><Plus size={14} />{t('vars.add')}</button>
        {env !== ALL && !fileEnvs.includes(env) && <button type="button" className="btn ghost sm" onClick={delEnv}><X size={14} />{t('vars.delEnv')}</button>}
      </div>

    </div>
  );
}
