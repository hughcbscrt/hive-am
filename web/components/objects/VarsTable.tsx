'use client';
import { useMemo, useState } from 'react';
import { Check, Eye, EyeOff, Pencil, Search, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n/index';
import type { VarInfo, VarSource } from '@/lib/types';
import { NO_VALUE } from '@/lib/meta';

export const SOURCE_TONE: Record<VarSource, string> = { session: 'sess', file: 'file', envfile: 'env', hive: 'hive', response: 'resp', dynamic: 'dyn', missing: 'miss' };

/** "Session", "@ in the file", "Env file · dev"… for the place a value comes from. */
export function sourceLabel(t: (k: any, v?: Record<string, string>) => string, source: VarSource, from: string): string {
  const scope = from === '$shared' ? t('iv.shared') : from;
  return t(`iv.source.${source}`, { from: source === 'envfile' || source === 'hive' ? scope : from });
}

/**
 * The variables in play, each with the value it has right now and where that value comes from (what it hides, when something stronger
 * defines it too). A value can be set for the session from here, which wins over everything until it is forgotten. Secrets are masked;
 * the ones hive-am stores as secrets are not even sent to the interface.
 */
export function VarsTable({ vars, onSet, onForget, onRun, compact = false }: {
  vars: VarInfo[]; onSet?: (name: string, value: string) => void; onForget?: (name: string) => void; onRun?: (requestName: string) => void; compact?: boolean;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [peek, setPeek] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const shown = useMemo(() => vars.filter((v) => (!onlyMissing || v.source === 'missing') && (!q || v.name.toLowerCase().includes(q.toLowerCase()) || (v.value ?? '').toLowerCase().includes(q.toLowerCase()))), [vars, q, onlyMissing]);
  const missing = vars.filter((v) => v.source === 'missing').length;
  const start = (v: VarInfo) => { setEditing(v.name); setDraft(v.source === 'session' || !v.secret ? v.value ?? '' : ''); };
  const save = () => { if (editing) onSet?.(editing, draft); setEditing(null); };

  return (
    <div className="ivt">
      {!compact && (
        <div className="ivt-bar">
          <div className="search"><Search size={14} /><input className="input" placeholder={t('iv.filter')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('iv.filter')} /></div>
          {missing > 0 && <label className="row gap-s small"><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />{t('iv.onlyMissing')} · {missing}</label>}
        </div>
      )}
      {shown.length === 0 ? <p className="muted small" style={{ margin: 8 }}>{t('iv.empty')}</p> : (
        <table className="ivt-table">
          <thead><tr><th>{t('iv.col.name')}</th><th>{t('iv.col.value')}</th><th>{t('iv.col.source')}</th>{!compact && <th>{t('iv.col.used')}</th>}<th /></tr></thead>
          <tbody>
            {shown.map((v) => {
              const masked = v.secret && !peek[v.name];
              return (
                <tr key={v.name} className={`ivt-row ${v.source === 'missing' ? 'miss' : ''}`}>
                  <td><code className="mono ivt-name">{v.name.replace(/^\$/, '$')}</code></td>
                  <td className="ivt-val">
                    {editing === v.name ? (
                      <span className="row gap-s"><input className="input mono" autoFocus value={draft} placeholder={t('hw.session.value')} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(null); }} />
                        <button className="btn primary icon sm" onClick={save} aria-label={t('iv.save')}><Check size={14} /></button><button className="btn ghost icon sm" onClick={() => setEditing(null)} aria-label={t('hw2.cancel')}><X size={14} /></button></span>
                    ) : v.source === 'missing' ? <span className="muted">{NO_VALUE}</span>
                      : v.source === 'dynamic' ? <span className="muted small">{t('iv.generated')}</span>
                      : v.hidden ? <span className="muted small" title={t('iv.hidden')}>•••••• <i>({t('iv.hidden')})</i></span>
                      : <span className="mono ivt-text" title={masked ? undefined : v.value ?? ''}>{masked ? '••••••••' : v.value}</span>}
                  </td>
                  <td>
                    <span className={`ivt-src ${SOURCE_TONE[v.source]}`}>{sourceLabel(t, v.source, v.from)}</span>
                    {v.overridden.length > 0 && <div className="ivt-over">{v.overridden.map((o, i) => <div key={i} className="small"><b>{sourceLabel(t, o.source, o.from)}</b> {t('iv.alsoDefines')}{o.value !== null && <> <code className="mono">{o.value}</code></>} · {t('iv.winsOver', { who: sourceLabel(t, v.source, v.from) })}</div>)}</div>}
                    {v.source === 'missing' && v.hint?.startsWith('run:') && onRun && <button className="btn sm" style={{ marginTop: 4 }} onClick={() => onRun(v.hint!.slice(4))}>{t('iv.run', { name: v.hint.slice(4) })}</button>}
                  </td>
                  {!compact && <td className="muted small">{v.usedBy || ''}</td>}
                  <td className="ivt-act">
                    {v.secret && v.value !== null && !v.hidden && <button className="btn ghost icon sm" onClick={() => setPeek((p) => ({ ...p, [v.name]: !p[v.name] }))} aria-label={t('iv.reveal')} title={t('iv.reveal')}>{peek[v.name] ? <EyeOff size={14} /> : <Eye size={14} />}</button>}
                    {onSet && v.source !== 'dynamic' && v.source !== 'response' && !v.name.includes('.') && editing !== v.name && <button className="btn ghost icon sm" onClick={() => start(v)} aria-label={t('iv.override')} title={`${t('iv.override')}. ${t('iv.override.hint')}`}><Pencil size={14} /></button>}
                    {onForget && v.source === 'session' && <button className="btn ghost icon sm" onClick={() => onForget(v.name)} aria-label={t('iv.forget')} title={t('iv.forget')}><X size={14} /></button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
