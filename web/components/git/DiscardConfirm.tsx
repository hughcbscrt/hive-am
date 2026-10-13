'use client';
import { useI18n } from '@/lib/i18n/index';
import type { GitChangeStatus } from '@/lib/types';
import { ConfirmDialog } from '@/components/ui';

/* ------------------------------------------------------------------ discard */

export interface DiscardSummary { restore: number; add: number; del: number }
export interface DiscardFile { path: string; status: GitChangeStatus; oldPath?: string; add: number; del: number }

/**
 * Asked before deleting new files (they are in no commit, so there is nothing to go back to) and, always, before
 * "discard all". For "discard all" it spells out what happens to each kind of file and how many lines are lost.
 */
export function DiscardConfirm({ files, all, summary, file, onConfirm, onClose }: { files: string[]; all: boolean; summary?: DiscardSummary; file?: DiscardFile; onConfirm: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const list = (
    <ul className="gx-dlist">
      {files.slice(0, 8).map((f) => <li key={f} className="mono">{f}</li>)}
      {files.length > 8 && <li className="muted">{t('hover.more', { count: files.length - 8 })}</li>}
    </ul>
  );
  if (!all && file && !files.length) {      // one tracked file: it goes back to the last commit
    const lines = file.add || file.del ? ` (+${file.add} −${file.del})` : '';
    return (
      <ConfirmDialog danger title={t('git.discard.file.title')} confirmLabel={t('git.discard.file.go')} onConfirm={onConfirm} onClose={onClose}>
        <p className="gx-file-eff mono">{file.path}</p>
        <p className="confirm-body">{file.status === 'deleted' ? t('git.discard.file.deleted') : file.status === 'renamed' ? t('git.discard.file.renamed', { from: file.oldPath ?? '' }) : t('git.discard.file.modified', { lines })}</p>
        <p className="gx-lost">{t('git.discard.all.warn')}</p>
      </ConfirmDialog>
    );
  }
  if (!all) {
    return (
      <ConfirmDialog danger title={t('git.discard.confirm.title')} body={t('git.discard.confirm.body', { count: files.length })} confirmLabel={t('git.discard.confirm.go')} onConfirm={onConfirm} onClose={onClose}>
        {list}
      </ConfirmDialog>
    );
  }
  return (
    <ConfirmDialog danger title={t('git.discard.all.title')} confirmLabel={t('git.discard.all.go')} onConfirm={onConfirm} onClose={onClose}>
      <ul className="gx-effects">
        {summary && summary.restore > 0 && <li>{t('git.discard.all.restore', { count: summary.restore })}</li>}
        {files.length > 0 && <li className="bad"><b>{t('git.discard.all.delete', { count: files.length })}</b>{list}</li>}
      </ul>
      {summary && <p className="muted small confirm-body">{t('git.discard.all.lines', { add: summary.add, del: summary.del })}</p>}
      <p className="gx-lost">{t('git.discard.all.warn')}</p>
    </ConfirmDialog>
  );
}
