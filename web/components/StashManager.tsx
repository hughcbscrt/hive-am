'use client';
import { useEffect, useMemo, useState } from 'react';
import { ArchiveRestore, PackagePlus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { parseDiff } from '@/lib/diff';
import { ago } from '@/lib/meta';
import type { Agent, GitCommitDetail, GitDiffResult, StashDetail, StashItem } from '@/lib/types';
import { Modal } from './ui';
import { DiffView } from './DiffView';
import { StatusLetter } from './StatusLetter';
import type { GitActions } from './GitActions';

/** Left pane of the Stashes tab. */
export function StashList({ stashes, sel, onSelect, onSave, canSave }: { stashes: StashItem[] | null; sel: string | null; onSelect: (sha: string) => void; onSave: () => void; canSave: boolean }) {
  const { t } = useI18n();
  return (
    <div className="gx-stashes">
      <div className="gx-stash-head"><button className="btn sm" disabled={!canSave} title={canSave ? undefined : t('git.stash.nothing')} onClick={onSave}><PackagePlus size={14} />{t('git.stash.save')}</button></div>
      {!stashes ? <p className="gx-note">{t('git.loading')}</p> : stashes.length === 0 ? <p className="gx-note">{t('git.stash.empty')}</p> : (
        <div className="gx-hist" role="listbox" aria-label={t('git.tab.stashes')}>
          {stashes.map((s) => (
            <button key={s.sha} role="option" aria-selected={sel === s.sha} className={`gx-commit ${sel === s.sha ? 'sel' : ''}`} onClick={() => onSelect(s.sha)}>
              <span className="subj">{s.message || '—'}</span>
              <span className="meta">{s.branch && <>{s.branch} · </>}{ago(Date.parse(s.date))}</span>
              {s.smart && <span className="refs"><i className="ref">{t('git.stash.smart')}</i></span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SaveStashDialog({ a, onClose }: { a: GitActions; onClose: () => void }) {
  const { t } = useI18n();
  const [msg, setMsg] = useState('');
  const go = async () => { onClose(); await a.run('stash', t('git.stash.saved'), 'stash-save', { message: msg }); };
  return (
    <Modal title={t('git.stash.save')} onClose={onClose}>
      <p className="muted" style={{ margin: 0 }}>{t('git.stash.save.body')}</p>
      <input className="input" autoFocus value={msg} maxLength={200} placeholder={t('git.stash.save.placeholder')} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void go(); }} aria-label={t('git.stash.save.placeholder')} />
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={!!a.busy} onClick={() => void go()}>{t('git.stash.save')}</button></div>
    </Modal>
  );
}

/** Right pane: what a stash holds, with Apply, Apply and delete, and Delete. */
export function StashPreview({ agent, stash, a }: { agent: Agent; stash: StashItem; a: GitActions }) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<StashDetail | null>(null);
  const [commit, setCommit] = useState<GitCommitDetail | null>(null);
  const [file, setFile] = useState<{ path: string; untracked: boolean; oldPath?: string } | null>(null);
  const [diff, setDiff] = useState<GitDiffResult | null>(null);
  const [confirmDrop, setConfirmDrop] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let dead = false; setDetail(null); setCommit(null); setFile(null); setDiff(null); setErr(null);
    Promise.all([api.get<StashDetail>(`/agents/${agent.id}/git/stash?sha=${stash.sha}`), api.get<GitCommitDetail>(`/agents/${agent.id}/git/commit?sha=${stash.sha}`)])
      .then(([d, c]) => { if (dead) return; setDetail(d); setCommit(c); const first = c.files[0]; setFile(first ? { path: first.path, untracked: false, oldPath: first.oldPath } : d.untracked[0] ? { path: d.untracked[0], untracked: true } : null); })
      .catch((e) => !dead && setErr(e instanceof Error ? e.message : t('git.loadError')));
    return () => { dead = true; };
  }, [agent.id, stash.sha]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!file || !detail) { setDiff(null); return; }
    const sha = file.untracked ? detail.untrackedSha : stash.sha; if (!sha) return;
    let dead = false; setDiff(null);
    api.get<GitDiffResult>(`/agents/${agent.id}/git/commit-diff?sha=${sha}&path=${encodeURIComponent(file.path)}${file.oldPath ? `&old=${encodeURIComponent(file.oldPath)}` : ''}`).then((x) => !dead && setDiff(x)).catch((e) => !dead && setErr(e instanceof Error ? e.message : t('git.loadError')));
    return () => { dead = true; };
  }, [agent.id, stash.sha, detail, file?.path, file?.untracked]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = useMemo(() => (diff ? parseDiff(diff.diff) : null), [diff]);
  const busy = !!a.busy;
  const apply = (pop: boolean) => void a.run('stash', pop ? t('git.stash.popped') : t('git.stash.applied'), 'stash-apply', { sha: stash.sha, pop });
  const count = (commit?.files.length ?? 0) + (detail?.untracked.length ?? 0);

  return (
    <section className="gx-preview gx-commitview" aria-label={stash.message}>
      <header className="gx-chead">
        <h3>{stash.message || '—'}</h3>
        <div className="muted small row gap-s wrap"><span>{stash.branch && `${stash.branch} · `}{ago(Date.parse(stash.date))}</span>{detail && <span>· {t('git.hist.files', { count })}</span>}</div>
        <div className="row gap-s wrap">
          <button className="btn sm" disabled={busy} title={t('git.stash.apply.hint')} onClick={() => apply(false)}><ArchiveRestore size={14} />{t('git.stash.apply')}</button>
          <button className="btn sm primary" disabled={busy} title={t('git.stash.pop.hint')} onClick={() => apply(true)}>{t('git.stash.pop')}</button>
          <button className="btn sm danger" disabled={busy} onClick={() => setConfirmDrop(true)}><Trash2 size={14} />{t('git.stash.drop')}</button>
        </div>
      </header>
      {err ? <p className="gx-note err">{err}</p> : !commit || !detail ? <p className="gx-note">{t('git.loading')}</p> : count === 0 ? <p className="gx-note">{t('git.hist.noFiles')}</p> : (
        <div className="gx-cfilelist" role="listbox">
          {commit.files.map((x) => (
            <button key={`t-${x.path}`} role="option" aria-selected={file?.path === x.path && !file.untracked} className={`gx-cfile ${file?.path === x.path && !file.untracked ? 'sel' : ''}`} onClick={() => setFile({ path: x.path, untracked: false, oldPath: x.oldPath })}>
              <StatusLetter status={x.status} /><span className="mono nm">{x.path}</span>
              {(x.additions !== null || x.deletions !== null) && <span className="gx-counts sm"><i className="add">+{x.additions ?? 0}</i><i className="del">−{x.deletions ?? 0}</i></span>}
            </button>
          ))}
          {detail.untracked.map((p) => (
            <button key={`u-${p}`} role="option" aria-selected={file?.path === p && file.untracked} className={`gx-cfile ${file?.path === p && file.untracked ? 'sel' : ''}`} onClick={() => setFile({ path: p, untracked: true })}>
              <StatusLetter status="untracked" /><span className="mono nm">{p}</span>
            </button>
          ))}
        </div>
      )}
      {file && <div className="gx-body">{!parsed ? <p className="gx-note">{t('git.loading')}</p> : parsed.binary ? <p className="gx-note">{t('git.diff.binary')}</p> : parsed.hunks.length === 0 ? <p className="gx-note">{t('git.diff.empty')}</p> : <DiffView parsed={parsed} layout="unified" path={file.path} cutOff={!!diff?.truncated} />}</div>}
      {confirmDrop && (
        <Modal title={t('git.stash.drop.title')} onClose={() => setConfirmDrop(false)}>
          <p className="muted" style={{ margin: 0 }}>{t('git.stash.drop.body', { name: stash.message || '—' })}</p>
          <p className="gx-lost">{t('git.discard.all.warn')}</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={() => setConfirmDrop(false)}>{t('common.cancel')}</button>
            <button className="btn danger" disabled={busy} onClick={() => { setConfirmDrop(false); void a.run('stash', t('git.stash.dropped'), 'stash-drop', { sha: stash.sha }); }}>{t('git.stash.drop')}</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
