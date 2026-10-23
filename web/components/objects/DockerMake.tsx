'use client';
import { useState } from 'react';
import { ChevronRight, Hammer, Loader2, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { canCreate, canRemove, imageNameFor, type MadeKind } from '@/lib/dockerLists';
import { useI18n } from '@/lib/i18n/index';
import { ConfirmDialog, Field, FolderPicker, PathPicker, useToast } from '@/components/ui';

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

/**
 * "Build from a Dockerfile": the file, the build folder (its own folder by default) and the image name. Building runs `docker build` on
 * this machine, which can take minutes; when it ends the image is picked (`onBuilt`). A failure shows the last lines of the output.
 */
export function DockerBuild({ onBuilt }: { onBuilt: (tag: string) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [file, setFile] = useState('');
  const [context, setContext] = useState('');
  // Until it is typed, the image name follows the Dockerfile's folder.
  const [typed, setTyped] = useState<string | null>(null);
  const tag = typed ?? imageNameFor(file);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const build = async () => {
    setBusy(true); setFailed('');
    try {
      const r = await api.post<{ tag: string }>('/docker/images/build', { dockerfile: file.trim(), context: context.trim() || undefined, tag: tag.trim() });
      toast(t('dk.build.done', { name: r.tag })); onBuilt(r.tag);
    } catch (e) { setFailed(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <details className="fold of-fold dk-build">
      <summary>{t('dk.build.title')}<ChevronRight size={15} className="chev" aria-hidden /></summary>
      <div className="dk-build-body">
        <p className="muted small res-m0">{t('dk.build.hint')}</p>
        <PathPicker mode="file" exts={['dockerfile', 'containerfile']} value={file} label={t('dk.build.file')} hint={t('dk.build.file.hint')} placeholder="/home/you/app/Dockerfile"
          onChange={setFile} />
        <FolderPicker value={context} onChange={setContext} label={t('dk.build.context')} hint={t('dk.build.context.hint')} placeholder={file.includes('/') ? file.slice(0, file.lastIndexOf('/')) || '/' : undefined} />
        <Field label={t('dk.build.tag')} hint={t('dk.build.tag.hint')}><input className="input mono" value={tag} onChange={(e) => setTyped(e.target.value)} placeholder="my-app:1.0" spellCheck={false} /></Field>
        <div className="dk-build-go">
          <button type="button" className="btn primary sm" disabled={busy || !file.trim() || !tag.trim()} aria-busy={busy} onClick={() => void build()}>{busy ? <Loader2 size={14} className="spin" aria-hidden /> : <Hammer size={14} />}{t('dk.build.go')}</button>
          {busy && <span className="muted small">{t('dk.build.running')}</span>}
        </div>
        {failed && <pre className="dk-build-out" role="alert">{failed}</pre>}
      </div>
    </details>
  );
}
