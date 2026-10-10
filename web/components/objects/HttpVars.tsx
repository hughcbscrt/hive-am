'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { useHive } from '@/lib/store';
import type { HttpConfig, HttpScan, ObjectView } from '@/lib/types';
import { useToast } from '@/components/ui';
import { VarsEditor, type Vars } from './VarsEditor';

/** The variables of an HTTP object on their own tab: environments of hive-am, next to the ones the env files bring. */
export function HttpVars({ object: o }: { object: ObjectView }) {
  const { t } = useI18n();
  const { refresh } = useHive();
  const toast = useToast();
  const cfg = o.config as HttpConfig;
  const base = useMemo(() => (cfg.variables ?? {}) as Vars, [o.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  const [vars, setVars] = useState<Vars>(base);
  const [scan, setScan] = useState<HttpScan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { api.get<HttpScan>(`/objects/${o.id}/http`).then(setScan).catch(() => undefined); }, [o.id, o.updated_at]);
  const dirty = JSON.stringify(vars) !== JSON.stringify(base);

  const save = async () => {
    setBusy(true); setErr('');
    try {
      await api.patch(`/objects/${o.id}`, { config: { folder: cfg.folder, env: cfg.env, variables: Object.keys(vars).length ? vars : undefined } });
      await refresh(['objects']); toast(t('obj.saved'));
    } catch (e) { setErr(e instanceof Error ? e.message : t('edit.saveFailed')); } finally { setBusy(false); }
  };
  return (
    <div className="oc">
      <div className="oc-form">
        <p className="muted" style={{ marginTop: 0 }}>{t('vars.hint')}</p>
        <VarsEditor value={vars} onChange={setVars} fileEnvs={scan ? Object.keys(scan.fileVars).filter((e) => e !== '$shared') : []} fileVars={scan?.fileVars} />
        {err && <p className="gx-note err">{err}</p>}
      </div>
      <div className="savebar oc-bar">
        <span className="muted small grow">{dirty ? t('ow.cfg.dirty') : t('ow.cfg.saved')}</span>
        <button className="btn ghost" disabled={!dirty || busy} onClick={() => setVars(base)}>{t('ow.cfg.discard')}</button>
        <button className="btn primary" disabled={!dirty || busy} onClick={() => void save()}>{t('ow.cfg.save')}</button>
      </div>
    </div>
  );
}
