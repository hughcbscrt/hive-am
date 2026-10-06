'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronDown, CloudDownload, GitBranch, GitCommitHorizontal, GitMerge, Loader2, Plus, Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ago } from '@/lib/meta';
import { useDismiss } from '@/lib/useDismiss';
import { StatusLetter } from './StatusLetter';
import type { Agent, GitBranches, GitChange, GitCommitInfo } from '@/lib/types';
import { Modal, useToast } from './ui';

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
      const r = await api.post<{ output: string }>(`/agents/${agent.id}/git/${path}`, body);
      const first = (r.output ?? '').split('\n').filter(Boolean).pop() ?? '';
      toast(first && first.length < 90 ? `${doneMsg} — ${first}` : doneMsg);
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
      <button className="btn sm" disabled={off} title={t('git.act.fetch.hint')} onClick={() => void a.run('fetch', t('git.done.fetch'), 'fetch')}>
        {a.busy === 'fetch' ? <Loader2 size={14} className="spin" /> : <CloudDownload size={14} />}{t('git.act.fetch')}</button>
      <button className="btn sm" disabled={off} title={t('git.act.pull.hint')} onClick={() => void a.run('pull', t('git.done.pull'), 'pull')}>
        {a.busy === 'pull' ? <Loader2 size={14} className="spin" /> : <ArrowDown size={14} />}{t('git.act.pull')}{behind > 0 && <span className="ct">{behind}</span>}</button>
      <button className="btn sm" disabled={off || detached} title={t('git.act.push.hint')} onClick={() => void a.run('push', t('git.done.push'), 'push')}>
        {a.busy === 'push' ? <Loader2 size={14} className="spin" /> : <ArrowUp size={14} />}{t('git.act.push')}{ahead > 0 && <span className="ct">{ahead}</span>}</button>
      <button className="btn sm primary" disabled={off || changeCount === 0} title={changeCount === 0 ? t('git.commit.nothing') : undefined} onClick={onCommit}>
        {a.busy === 'commit' ? <Loader2 size={14} className="spin" /> : <GitCommitHorizontal size={14} />}{t('git.act.commit')}{changeCount > 0 && <span className="ct">{changeCount}</span>}</button>
    </div>
  );
}

/* ------------------------------------------------------------------ branches */

export function BranchMenu({ agent, a, current }: { agent: Agent; a: GitActions; current: string | null }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<GitBranches | null>(null);
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [merge, setMerge] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useDismiss(open, box, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    setErr(''); setMerge(null);
    api.get<GitBranches>(`/agents/${agent.id}/git/branches`).then(setData).catch((e) => setErr(e instanceof Error ? e.message : 'error'));
  }, [open, agent.id]);

  const local = useMemo(() => (data?.local ?? []).filter((b) => b.name.toLowerCase().includes(q.toLowerCase())), [data, q]);
  const remote = useMemo(() => {
    const have = new Set((data?.local ?? []).map((b) => b.name));
    return (data?.remote ?? []).filter((b) => !have.has(b.name.split('/').slice(1).join('/')) && b.name.toLowerCase().includes(q.toLowerCase()));
  }, [data, q]);

  // The menu closes either way: on failure the reason (and the way out, e.g. abort merge) is in the banner below the bar.
  const go = async (key: string, msg: string, path: string, body: object) => { setOpen(false); await a.run(key, msg, path, body); };
  const valid = /^[\w./-]+$/.test(name) && !name.startsWith('-') && !name.endsWith('/') && !name.includes('..');

  return (
    <div className="gx-brmenu" ref={box}>
      <button type="button" className="btn sm" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}><GitBranch size={14} />{t('git.act.branches')}<ChevronDown size={13} /></button>
      {open && (
        <div className="gx-pop" role="menu">
          <div className="search"><Search size={14} /><input className="input" autoFocus placeholder={t('git.br.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('git.br.search')} /></div>
          <div className="gx-newbr">
            <input className="input mono" placeholder={t('git.br.newPlaceholder')} value={name} onChange={(e) => setName(e.target.value.trim())} aria-label={t('git.br.new', { branch: current ?? '' })}
              onKeyDown={(e) => { if (e.key === 'Enter' && valid) void go('switch', t('git.done.switch', { branch: name }), 'switch', { branch: name, create: true }); }} />
            <button className="btn sm" disabled={!valid || !!a.busy} title={t('git.br.new', { branch: current ?? '…' })} onClick={() => void go('switch', t('git.done.switch', { branch: name }), 'switch', { branch: name, create: true })}><Plus size={14} />{t('git.br.create')}</button>
          </div>
          {err && <p className="gx-note err">{err}</p>}
          <div className="gx-brlist">
            {local.length > 0 && <div className="gx-brhead">{t('git.br.local')}</div>}
            {local.map((b) => (
              <div key={b.name} className={`gx-br ${b.name === current ? 'cur' : ''}`}>
                <button className="grow" disabled={b.name === current || !!a.busy} onClick={() => void go('switch', t('git.done.switch', { branch: b.name }), 'switch', { branch: b.name })} title={t('git.br.switchTo', { branch: b.name })}>
                  <span className="nm">{b.name === current && <Check size={13} />}{b.name}</span><span className="sub">{b.subject} · {ago(Date.parse(b.date))}</span>
                </button>
                {b.name !== current && <button className="btn ghost icon sm" disabled={!!a.busy} onClick={() => setMerge(b.name)} aria-label={t('git.br.merge', { branch: current ?? '' })} title={t('git.br.merge', { branch: current ?? '' })}><GitMerge size={14} /></button>}
              </div>
            ))}
            {remote.length > 0 && <div className="gx-brhead">{t('git.br.remote')}</div>}
            {remote.map((b) => (
              <div key={b.name} className="gx-br">
                <button className="grow" disabled={!!a.busy} onClick={() => { const short = b.name.split('/').slice(1).join('/'); void go('switch', t('git.done.switch', { branch: short }), 'switch', { branch: short }); }} title={t('git.br.switchTo', { branch: b.name })}>
                  <span className="nm">{b.name}</span><span className="sub">{b.subject} · {ago(Date.parse(b.date))}</span>
                </button>
                <button className="btn ghost icon sm" disabled={!!a.busy} onClick={() => setMerge(b.name)} aria-label={t('git.br.merge', { branch: current ?? '' })} title={t('git.br.merge', { branch: current ?? '' })}><GitMerge size={14} /></button>
              </div>
            ))}
            {data && !local.length && !remote.length && <p className="gx-note">{t('git.br.none')}</p>}
          </div>
          {merge && (
            <div className="gx-mergeask">
              <span>{t('git.br.mergeAsk', { from: merge, into: current ?? '' })}</span>
              <div className="row gap-s"><button className="btn ghost sm" onClick={() => setMerge(null)}>{t('common.cancel')}</button>
                <button className="btn primary sm" disabled={!!a.busy} onClick={() => void go('merge', t('git.done.merge', { branch: merge }), 'merge', { branch: merge })}>{t('git.br.mergeGo')}</button></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn" disabled={!can} onClick={() => void commit(false)}>{a.busy === 'commit' ? t('git.commit.committing') : t('git.commit.go')}</button>
        <button className="btn primary" disabled={!can} onClick={() => void commit(true)}>{t('git.commit.goPush')}</button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ history */

export function HistoryList({ agent, head, sel, onSelect }: { agent: Agent; head: string | undefined; sel: string | null; onSelect: (sha: string) => void }) {
  const { t } = useI18n();
  const [commits, setCommits] = useState<GitCommitInfo[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = async (skip: number) => {
    setBusy(true);
    try {
      const r = await api.get<{ commits: GitCommitInfo[]; hasMore: boolean }>(`/agents/${agent.id}/git/log?skip=${skip}`);
      setCommits((c) => (skip === 0 ? r.commits : [...(c ?? []), ...r.commits])); setMore(r.hasMore); setErr('');
    } catch (e) { setErr(e instanceof Error ? e.message : 'error'); } finally { setBusy(false); }
  };
  // Reload from the top whenever HEAD moves (new commit, pull, branch switch).
  useEffect(() => { void load(0); }, [agent.id, head]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!sel && commits?.length) onSelect(commits[0].sha); }, [commits]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <p className="gx-note err">{err}</p>;
  if (!commits) return <p className="gx-note">{t('git.loading')}</p>;
  if (!commits.length) return <p className="gx-note">{t('git.hist.empty')}</p>;
  return (
    <div className="gx-hist" role="listbox" aria-label={t('git.tab.history')}>
      {commits.map((c) => (
        <button key={c.sha} role="option" aria-selected={sel === c.sha} className={`gx-commit ${sel === c.sha ? 'sel' : ''}`} onClick={() => onSelect(c.sha)}>
          <span className="subj">{c.subject || '—'}</span>
          <span className="meta"><span className="mono sha">{c.short}</span> · {c.author} · {ago(Date.parse(c.date))}</span>
          {(c.refs.length > 0 || c.merge) && <span className="refs">{c.merge && <i className="ref">{t('git.hist.merge')}</i>}{c.refs.slice(0, 3).map((r) => <i key={r} className="ref">{r}</i>)}</span>}
        </button>
      ))}
      {more && <button className="btn sm" style={{ margin: 10 }} disabled={busy} onClick={() => void load(commits.length)}>{busy ? t('git.loading') : t('git.hist.more')}</button>}
    </div>
  );
}

/* ------------------------------------------------------------------ discard */

/** Asked only when discarding would delete files for good (new files are not in any commit, so there is nothing to go back to). */
export function DiscardConfirm({ files, all, busy, onConfirm, onClose }: { files: string[]; all: boolean; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Modal title={t('git.discard.confirm.title')} onClose={onClose}>
      <p className="muted" style={{ margin: 0 }}>{t('git.discard.confirm.body', { count: files.length })}</p>
      <ul className="gx-dlist">
        {files.slice(0, 8).map((f) => <li key={f} className="mono">{f}</li>)}
        {files.length > 8 && <li className="muted">{t('hover.more', { count: files.length - 8 })}</li>}
      </ul>
      {all && <p className="muted small" style={{ margin: 0 }}>{t('git.discard.confirm.rest')}</p>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn danger" disabled={busy} onClick={onConfirm}>{t('git.discard.confirm.go')}</button>
      </div>
    </Modal>
  );
}
