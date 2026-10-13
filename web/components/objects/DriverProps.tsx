'use client';
import { Plus, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n/index';
import { useDriverProps } from '@/lib/useDriverProps';
import type { DbEngine, DriverProp, DriverPropGroup } from '@/lib/types';

const GROUPS: DriverPropGroup[] = ['session', 'network', 'ssl', 'advanced'];

/** The value control of a property, for its kind. */
function ValueInput({ def, value, onChange }: { def: DriverProp; value: string; onChange: (v: string) => void }) {
  if (def.type === 'boolean') return <select className="select" value={value} onChange={(e) => onChange(e.target.value)} aria-label={def.name}><option value="true">true</option><option value="false">false</option></select>;
  if (def.type === 'choice') return <select className="select" value={value} onChange={(e) => onChange(e.target.value)} aria-label={def.name}>{!value && <option value="" />}{def.choices!.map((c) => <option key={c} value={c}>{c}</option>)}</select>;
  return <input className="input mono" type={def.type === 'number' ? 'number' : 'text'} min={def.min} max={def.max} value={value} placeholder={def.placeholder} autoComplete="off" onChange={(e) => onChange(e.target.value)} aria-label={def.name} />;
}

/**
 * The properties of the driver of a database engine, the way DBeaver lists them but only those the Node driver takes, so every
 * one has an effect on the connection. A row per property that is set; the rest are added from the list.
 */
export function DriverProps({ engine, value, onChange, groups = GROUPS, exclude = [], quiet = false }: {
  engine: DbEngine; value: Record<string, string>; onChange: (v: Record<string, string>) => void; groups?: DriverPropGroup[]; exclude?: string[]; quiet?: boolean;
}) {
  const { t, locale } = useI18n();
  const cat = useDriverProps();
  if (!cat) return <p className="muted small" style={{ margin: 0 }}>{t('dp.loading')}</p>;
  const defs = cat[engine].filter((d) => groups.includes(d.group) && !exclude.includes(d.name));
  const set = defs.filter((d) => d.name in value);
  const free = defs.filter((d) => !(d.name in value));
  const first = (d: DriverProp) => (d.type === 'boolean' ? 'true' : d.type === 'choice' ? d.choices![0] : '');
  return (
    <div className="dprops">
      {set.length === 0 && !quiet && <p className="muted small" style={{ margin: 0 }}>{t('dp.none')}</p>}
      {set.map((d) => (
        <div key={d.name} className="dprop">
          <div className="dprop-row">
            <code className="dprop-name">{d.name}</code>
            <div className="dprop-val"><ValueInput def={d} value={value[d.name]} onChange={(v) => onChange({ ...value, [d.name]: v })} /></div>
            <button type="button" className="btn ghost icon sm" onClick={() => { const { [d.name]: _, ...rest } = value; onChange(rest); }} aria-label={t('dp.remove', { name: d.name })} title={t('dp.remove', { name: d.name })}><X size={14} /></button>
          </div>
          <p className="muted small dprop-desc">{locale === 'es' ? d.es : d.desc}</p>
        </div>
      ))}
      {free.length > 0 && (
        <div className="dprop-add">
          <Plus size={14} className="muted" />
          <select className="select" value="" aria-label={t('dp.add')} onChange={(e) => { const d = defs.find((x) => x.name === e.target.value); if (d) onChange({ ...value, [d.name]: first(d) }); }}>
            <option value="">{t('dp.add')}</option>
            {GROUPS.filter((g) => free.some((d) => d.group === g)).map((g) => (
              <optgroup key={g} label={t(`dp.group.${g}`)}>{free.filter((d) => d.group === g).map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}</optgroup>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
