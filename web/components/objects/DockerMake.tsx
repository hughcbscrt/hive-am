'use client';
import { useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { canCreate, canRemove, type MadeKind } from '@/lib/dockerLists';
import { useI18n } from '@/lib/i18n/index';
import { ConfirmDialog, useToast } from '@/components/ui';

/**
 * Creating and deleting the networks and volumes of the Docker form, each with its own button and a toast with the result. Only what
 * hive-am created and no container uses offers delete, after a confirmation; the server checks both again before removing. `reload` reads
 * Docker's lists again afterwards. Render `dialog` once.
 */
export function useDockerMake(reload: () => void) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [removing, setRemoving] = useState<{ kind: MadeKind; name: string } | null>(null);
  const create = async (kind: MadeKind, name: string) => {
    setBusy(`${kind}:${name}`);
    try {
      const r = await api.post<{ name: string; created: boolean }>(`/docker/${kind}s`, { name });
      toast(t(r.created ? `dk.make.created.${kind}` : `dk.make.existed.${kind}`, { name: r.name }));
      reload();
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'err'); } finally { setBusy(''); }
  };
  /** A button that creates `name` when Docker does not have it (nothing while it does, or while Docker is not answering). */
  const createButton = (kind: MadeKind, name: string, list: { name: string }[] | null, label: string) => {
    if (!canCreate(kind, name, list)) return null;
    const on = busy === `${kind}:${name.trim()}`;
    return <button type="button" className="btn sm" disabled={!!busy} aria-busy={on} onClick={() => void create(kind, name.trim())}>{on ? <Loader2 size={14} className="spin" aria-hidden /> : <Plus size={14} />}{label}</button>;
  };
  /** The delete button of a suggestion, only on what can be removed. */
  const removeAction = (kind: MadeKind, x: { name: string; managed: boolean; inUse: number; builtin?: boolean; anonymous?: boolean }) =>
    canRemove(x) ? { label: t(`dk.make.remove.${kind}`, { name: x.name }), icon: <Trash2 size={13} />, onClick: () => setRemoving({ kind, name: x.name }) } : undefined;
  const dialog = removing && (
    <ConfirmDialog title={t(`dk.make.removeTitle.${removing.kind}`, { name: removing.name })} body={t(`dk.make.removeBody.${removing.kind}`)} confirmLabel={t('common.delete')} danger
      onConfirm={async () => { await api.del(`/docker/${removing.kind}s/${encodeURIComponent(removing.name)}`); toast(t(`dk.make.removed.${removing.kind}`, { name: removing.name })); reload(); }}
      onClose={() => setRemoving(null)} />
  );
  return { createButton, removeAction, dialog };
}
