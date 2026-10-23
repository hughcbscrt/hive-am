'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CopyPlus, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import type { DockerConfig } from '@/lib/types';
import { Banner, useToast } from '@/components/ui';
import { ObjectEditor } from './ObjectEditor';
import { draftFromDocker } from './ObjectForm';

interface Copy { name: string; colony_id: string | null; config: DockerConfig; skipped: string[] }

/**
 * "Create a managed copy" of an existing container: its `docker inspect` is read (only read: hive-am never changes a container it did not
 * create) into the form of a new container hive-am creates, to adjust and save. `open()` starts it; render `view` once.
 */
export function useManagedCopy(objectId: string) {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [copy, setCopy] = useState<Copy | null>(null);
  const open = async () => {
    setBusy(true);
    try { setCopy(await api.get<Copy>(`/objects/${objectId}/docker/managed-copy`)); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'err'); } finally { setBusy(false); }
  };
  const view = copy && (
    <ObjectEditor initial={draftFromDocker(copy.config, copy.name, copy.colony_id ?? undefined)} title={t('mc.title')} onClose={() => setCopy(null)}
      onSaved={(id) => router.push(`/resources/${id}?tab=config`)}
      notice={<Banner kind="info">
        <p className="res-m0">{t('mc.note')}</p>
        {copy.skipped.length > 0 && <><p className="res-mt6 res-m0">{t('mc.skipped')}</p><ul className="mc-skipped">{copy.skipped.map((x) => <li key={x} className="mono">{x}</li>)}</ul></>}
      </Banner>} />
  );
  return { open, busy, view };
}

/** The button in the settings of an existing container. */
export function ManagedCopyButton({ objectId }: { objectId: string }) {
  const { t } = useI18n();
  const { open, busy, view } = useManagedCopy(objectId);
  return (
    <div className="mc-row">
      <p className="muted small res-m0">{t('mc.hint')}</p>
      <button type="button" className="btn sm" disabled={busy} aria-busy={busy} onClick={() => void open()}>{busy ? <Loader2 size={14} className="spin" aria-hidden /> : <CopyPlus size={14} />}{t('mc.go')}</button>
      {view}
    </div>
  );
}
