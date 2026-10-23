'use client';
import { Plus, Trash2 } from 'lucide-react';
import { CheckRow, PathPicker } from '@/components/ui';
import { useI18n } from '@/lib/i18n/index';
import { emptyRow, isFolder, isReadOnly, parseVolumes, volumesText, withReadOnly, type VolumeRow } from '@/lib/dockerVolumes';
import type { DockerVolume } from '@/lib/useDocker';
import { Suggest } from './Suggest';

/**
 * The volumes of a container as rows: where it comes from (a volume of this machine, picked or typed, or a folder), where it goes inside
 * and read-only. It edits the same text the resource always saved (`value`, one `source:target[:options]` per line).
 */
export function VolumeRows({ value, onChange, volumes }: { value: string; onChange: (v: string) => void; volumes: DockerVolume[] | null }) {
  const { t } = useI18n();
  const rows = parseVolumes(value);
  const put = (i: number, r: VolumeRow) => onChange(volumesText(rows.map((x, j) => (j === i ? r : x))));
  const known = new Set((volumes ?? []).map((v) => v.name));
  // Anonymous volumes have a random name nobody picks on purpose.
  const options = (volumes ?? []).filter((v) => !v.anonymous).map((v) => ({ value: v.name, hint: [t('dk.inUse', { count: v.inUse }), v.managed ? t('dk.managed') : ''].filter(Boolean).join(' · ') }));
  return (
    <div className="vrows">
      {rows.map((r, i) => (
        <div key={i} className="vrow">
          {r.raw !== undefined
            ? <input className="input mono vrow-raw" value={r.raw} onChange={(e) => put(i, { ...r, raw: e.target.value })} aria-label={t('obj.f.volumes')} />
            : (<>
              <div className="vrow-src"><Suggest value={r.source} onChange={(v) => put(i, { ...r, source: v })} mono placeholder={t('dk.vol.source')} ariaLabel={t('dk.vol.source')} options={options} /></div>
              <div className="vrow-pick"><PathPicker bare value="" buttonLabel={t('dk.vol.folder')} onChange={(v) => put(i, { ...r, source: v })} /></div>
              <input className="input mono" value={r.target} placeholder="/data" onChange={(e) => put(i, { ...r, target: e.target.value })} aria-label={t('dk.vol.target')} title={t('dk.vol.target')} />
              <CheckRow compact checked={isReadOnly(r)} onChange={(v) => put(i, withReadOnly(r, v))} label={t('dk.vol.ro')} />
            </>)}
          <button type="button" className="btn ghost icon sm" onClick={() => onChange(volumesText(rows.filter((_, j) => j !== i)))} aria-label={t('common.delete')} title={t('common.delete')}><Trash2 size={14} /></button>
          {r.raw === undefined && r.source && !isFolder(r.source) && volumes && !known.has(r.source) && <p className="vrow-note muted small">{t('dk.vol.new', { name: r.source })}</p>}
        </div>
      ))}
      <div><button type="button" className="btn sm" onClick={() => onChange(volumesText([...rows, emptyRow()]))}><Plus size={14} />{t('dk.vol.add')}</button></div>
    </div>
  );
}
