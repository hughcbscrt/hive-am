'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { Field } from '@/components/ui';

export interface AppTemplate { id: string; name: string; description: string; fields: { key: string; label: string; kind: 'text' | 'port' | 'secret'; default: string }[] }
let cache: AppTemplate[] | null = null;

/** The ready-made services (a database, a cache, a broker…) the server can write a compose file for. */
export function useTemplates() {
  const [list, setList] = useState<AppTemplate[] | null>(cache);
  useEffect(() => { if (!cache) api.get<AppTemplate[]>('/object-templates').then((l) => { cache = l; setList(l); }).catch(() => setList([])); }, []);
  return list;
}

/** Pick a template and fill its few values (ports, user, password); each one starts with a sensible value. */
export function TemplatePicker({ template, values, onPick, onValue }: { template: string; values: Record<string, string>; onPick: (t: AppTemplate) => void; onValue: (key: string, v: string) => void }) {
  const { t } = useI18n();
  const list = useTemplates();
  const cur = list?.find((x) => x.id === template);
  if (!list) return <p className="muted small" style={{ margin: 0 }}>{t('git.loading')}</p>;
  return (<>
    <div className="tpls">{list.map((x) => (
      <button key={x.id} type="button" className="tpl" aria-pressed={template === x.id} onClick={() => onPick(x)}><b>{x.name}</b><small>{x.description}</small></button>))}</div>
    {cur && cur.fields.map((f) => (
      <Field key={`${cur.id}-${f.key}`} label={f.label}>
        <input className={`input ${f.kind === 'text' && f.key !== 'version' ? '' : 'mono'}`} value={values[f.key] ?? ''} onChange={(e) => onValue(f.key, e.target.value)} placeholder={f.default} inputMode={f.kind === 'port' ? 'numeric' : undefined} />
      </Field>))}
    {cur && <p className="muted small" style={{ margin: 0 }}>{t('tpl.note')}</p>}
  </>);
}
