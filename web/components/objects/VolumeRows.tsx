'use client';
import { Plus, Trash2 } from 'lucide-react';
import { CheckRow, PathPicker } from '@/components/ui';
import { useI18n } from '@/lib/i18n/index';
import { emptyRow, isIncomplete, isNewVolume, isReadOnly, parseVolumes, volumesText, withReadOnly, type VolumeRow } from '@/lib/dockerVolumes';
import type { DockerVolume } from '@/lib/useDocker';
import { Suggest } from './Suggest';
import type { useDockerMake } from './DockerMake';

/**
 * The volumes of a container as rows: where it comes from (a volume of this machine, picked or typed, or a folder), where it goes inside
 * and read-only. It edits the same text the resource always saved (`value`, one `source:target[:options]` per line). `volumes` is null when
 * Docker did not answer: then no row says its volume is missing. A new name can be created on the spot, and a volume hive-am created
 * that nothing uses can be deleted from the suggestions (`make`).
 */
export function VolumeRows({ value, onChange, volumes, make }: { value: string; onChange: (v: string) => void; volumes: DockerVolume[] | null; make: ReturnType<typeof useDockerMake> }) {
  const { t } = useI18n();
  const rows = parseVolumes(value);
  const put = (i: number, r: VolumeRow) => onChange(volumesText(rows.map((x, j) => (j === i ? r : x))));
  // Anonymous volumes have a random name nobody picks on purpose.
  const options = (volumes ?? []).filter((v) => !v.anonymous).map((v) => ({ value: v.name, hint: [t('dk.inUse', { count: v.inUse }), v.managed ? t('dk.managed') : ''].filter(Boolean).join(' · '), action: make.removeAction('volume', v) }));
  return (
    <div className="vrows">
      {rows.map((r, i) => (
        <div key={i} className="vrow">
          {r.raw !== undefined
            ? <input className="input mono vrow-raw" value={r.raw} onChange={(e) => put(i, { ...r, raw: e.target.value })} aria-label={t('obj.f.volumes')} />
            : (<>
              <div className="vrow-src"><Suggest value={r.source} onChange={(v) => put(i, { ...r, source: v })} mono placeholder={t('dk.vol.source')} ariaLabel={t('dk.vol.source')} options={options} /></div>
              {/* Keyed by the row and its source, so an open folder list closes when the row goes away or changes; it opens at the folder already chosen. */}
              <div className="vrow-pick"><PathPicker key={`${i}:${rows.length}:${r.source}`} bare value={r.source.startsWith('/') ? r.source : ''} buttonLabel={t('dk.vol.folder')} onChange={(v) => put(i, { ...r, source: v })} /></div>
              <input className="input mono" value={r.target} placeholder="/data" onChange={(e) => put(i, { ...r, target: e.target.value })} aria-label={t('dk.vol.target')} title={t('dk.vol.target')} />
              <CheckRow compact checked={isReadOnly(r)} onChange={(v) => put(i, withReadOnly(r, v))} label={t('dk.vol.ro')} />
            </>)}
          <button type="button" className="btn ghost icon sm" onClick={() => onChange(volumesText(rows.filter((_, j) => j !== i)))} aria-label={t('common.delete')} title={t('common.delete')}><Trash2 size={14} /></button>
          {isIncomplete(r) ? <p className="vrow-note small err">{t('dk.vol.incomplete')}</p>
            : r.raw === undefined && isNewVolume(r.source, volumes) && <p className="vrow-note muted small">{t('dk.vol.new', { name: r.source })}{make.createButton('volume', r.source, volumes, t('dk.make.now'))}</p>}
        </div>
      ))}
      <div><button type="button" className="btn sm" onClick={() => onChange(volumesText([...rows, emptyRow()]))}><Plus size={14} />{t('dk.vol.add')}</button></div>
    </div>
  );
}
