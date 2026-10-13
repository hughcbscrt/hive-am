'use client';
import { useState } from 'react';
import { ArrowDown, ArrowUp, CloudDownload, GitCommitHorizontal, Loader2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { useToast } from '@/components/ui';
import type { Agent } from '@/lib/types';

/* ------------------------------------------------------------------ running actions */

export interface Notice { title: string; text: string; diverged: boolean }

/** Runs a git action, toasts the result, shows failures (git's own text) in a banner, then refreshes. */
export function useGitActions(agent: Agent, refresh: () => Promise<unknown> | unknown) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const run = async (key: string, doneMsg: string, path: string, body: object = {}): Promise<boolean> => {
    setBusy(key); setNotice(null);
    try {
      const r = await api.post<{ output: string; pending?: string | null; kept?: string[] }>(`/agents/${agent.id}/git/${path}`, body);
      const first = (r.output ?? '').split('\n').filter(Boolean).pop() ?? '';
      // Conflicts while bringing changes back are not a failure: they are resolved in the explorer.
      const extra = [r.pending === 'conflicts' ? t('git.pending.conflicts') : '', r.kept?.length ? t('git.sw.kept', { count: r.kept.length, names: r.kept.slice(0, 3).join(', ') }) : ''].filter(Boolean).join(', ');
      toast(extra ? `${doneMsg}: ${extra}` : first && first.length < 90 ? `${doneMsg}: ${first}` : doneMsg);
      await refresh();
      return true;
    } catch (e) {
      const text = e instanceof Error ? e.message : 'error';
      setNotice({ title: t('git.notice.failed', { action: doneMsg }), text, diverged: /fast-forward|divergent/i.test(text) });
      await refresh();
      return false;
    } finally { setBusy(null); }
  };
  return { busy, notice, setNotice, run };
}
export type GitActions = ReturnType<typeof useGitActions>;

export function NoticeBanner({ a }: { a: GitActions }) {
  const { t } = useI18n();
  const n = a.notice; if (!n) return null;
  return (
    <div className="gx-notice err" role="alert">
      <div className="row"><b className="grow">{n.title}</b><button className="btn ghost icon sm" onClick={() => a.setNotice(null)} aria-label={t('common.close')}><X size={14} /></button></div>
      <pre>{n.text}</pre>
      {n.diverged && <div className="row gap-s wrap"><span className="small muted">{t('git.notice.diverged')}</span>
        <button className="btn sm" disabled={!!a.busy} onClick={() => void a.run('pull', t('git.done.pull'), 'pull', { mode: 'merge' })}>{t('git.pull.merge')}</button>
        <button className="btn sm" disabled={!!a.busy} onClick={() => void a.run('pull', t('git.done.pull'), 'pull', { mode: 'rebase' })}>{t('git.pull.rebase')}</button></div>}
    </div>
  );
}

/* ------------------------------------------------------------------ action buttons */

export function ActionButtons({ a, ahead, behind, detached, changeCount, onCommit }: { a: GitActions; ahead: number; behind: number; detached: boolean; changeCount: number; onCommit: () => void }) {
  const { t } = useI18n();
  const off = !!a.busy;
  return (
    <div className="gx-acts" role="group" aria-label={t('git.act.group')}>
      <button className="btn sm" disabled={off} title={`${t('git.act.fetch')}: ${t('git.act.fetch.hint')}`} aria-label={t('git.act.fetch')} onClick={() => void a.run('fetch', t('git.done.fetch'), 'fetch')}>
        {a.busy === 'fetch' ? <Loader2 size={14} className="spin" /> : <CloudDownload size={14} />}</button>
      <button className="btn sm" disabled={off} title={`${t('git.act.pull')}: ${t('git.act.pull.hint')}`} aria-label={t('git.act.pull')} onClick={() => void a.run('pull', t('git.done.pull'), 'pull')}>
        {a.busy === 'pull' ? <Loader2 size={14} className="spin" /> : <ArrowDown size={14} />}{behind > 0 && <span className="ct">{behind}</span>}</button>
      <button className="btn sm" disabled={off || detached} title={`${t('git.act.push')}: ${t('git.act.push.hint')}`} aria-label={t('git.act.push')} onClick={() => void a.run('push', t('git.done.push'), 'push')}>
        {a.busy === 'push' ? <Loader2 size={14} className="spin" /> : <ArrowUp size={14} />}{ahead > 0 && <span className="ct">{ahead}</span>}</button>
      <button className="btn sm primary" disabled={off || changeCount === 0} title={changeCount === 0 ? t('git.commit.nothing') : undefined} onClick={onCommit}>
        {a.busy === 'commit' ? <Loader2 size={14} className="spin" /> : <GitCommitHorizontal size={14} />}{t('git.act.commit')}{changeCount > 0 && <span className="ct">{changeCount}</span>}</button>
    </div>
  );
}
