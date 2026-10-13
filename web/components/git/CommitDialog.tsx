'use client';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n/index';
import type { GitChange } from '@/lib/types';
import { Modal } from '@/components/ui';
import { StatusLetter } from './StatusLetter';
import type { GitActions } from './GitActions';

/* ------------------------------------------------------------------ commit dialog */

export function CommitDialog({ changes, a, onClose, initialMessage = '' }: { changes: GitChange[]; a: GitActions; onClose: () => void; initialMessage?: string }) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(changes.map((c) => c.path)));
  const [msg, setMsg] = useState(initialMessage);
  const toggle = (p: string) => setPicked((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const chosen = changes.filter((c) => picked.has(c.path));
  const paths = chosen.flatMap((c) => (c.oldPath ? [c.path, c.oldPath] : [c.path]));
  const can = !!msg.trim() && chosen.length > 0 && !a.busy;

  const commit = async (push: boolean) => {
    if (!(await a.run('commit', t('git.done.commit'), 'commit', { message: msg, paths }))) { onClose(); return; }
    onClose();
    if (push) await a.run('push', t('git.done.push'), 'push');
  };

  return (
    <Modal title={t('git.commit.title')} onClose={onClose}>
      <div className="gx-cfiles">
        <div className="row"><span className="small muted grow">{t('git.commit.selected', { n: chosen.length, total: changes.length })}</span>
          <button className="btn ghost sm" onClick={() => setPicked(new Set(changes.map((c) => c.path)))}>{t('git.commit.all')}</button>
          <button className="btn ghost sm" onClick={() => setPicked(new Set())}>{t('git.commit.none')}</button></div>
        <div className="gx-clist">
          {changes.map((c) => (
            <label key={c.path} className="gx-crow" title={c.path}>
              <input type="checkbox" checked={picked.has(c.path)} onChange={() => toggle(c.path)} />
              <StatusLetter status={c.status} />
              <span className="mono nm">{c.path}</span>
              {(c.additions !== null || c.deletions !== null) && <span className="gx-counts sm"><i className="add">+{c.additions ?? 0}</i><i className="del">−{c.deletions ?? 0}</i></span>}
            </label>
          ))}
        </div>
      </div>
      <div className="field"><label>{t('git.commit.message')}</label>
        <textarea className="textarea" rows={4} autoFocus value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t('git.commit.placeholder')}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && can) void commit(false); }} />
        <span className="hint">{t('git.commit.hint')}</span></div>
      <div className="row confirm-actions">
        <button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn" disabled={!can} onClick={() => void commit(false)}>{a.busy === 'commit' ? t('git.commit.committing') : t('git.commit.go')}</button>
        <button className="btn primary" disabled={!can} onClick={() => void commit(true)}>{t('git.commit.goPush')}</button>
      </div>
    </Modal>
  );
}
