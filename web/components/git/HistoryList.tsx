'use client';
import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { ago } from '@/lib/meta';
import type { Agent, GitCommitInfo, GitRefs } from '@/lib/types';
import { RefPicker } from './RefPicker';

/* ------------------------------------------------------------------ history */

export function HistoryList({ agent, head, sel, onSelect, refs, path, onClearPath }: {
  agent: Agent; head: string | undefined; sel: string | null; onSelect: (sha: string) => void;
  refs: GitRefs | null;
  /** Only the commits that touched this file. */
  path?: string | null; onClearPath?: () => void;
}) {
  const { t } = useI18n();
  const [commits, setCommits] = useState<GitCommitInfo[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [by, setBy] = useState<'message' | 'author' | 'content'>('message');
  const [branch, setBranch] = useState('');           // '' = the current branch, 'all', or a branch / tag / commit
  const [text, setText] = useState('');               // what is searched: `q` after a short pause, so typing does not run git on every key
  useEffect(() => { const id = setTimeout(() => setText(q.trim()), 350); return () => clearTimeout(id); }, [q]);
  const filtered = !!(text || path || branch);

  const load = async (skip: number) => {
    setBusy(true);
    try {
      const qs = `skip=${skip}${text ? `&q=${encodeURIComponent(text)}&by=${by}` : ''}${path ? `&path=${encodeURIComponent(path)}` : ''}${branch ? `&ref=${encodeURIComponent(branch)}` : ''}`;
      const r = await api.get<{ commits: GitCommitInfo[]; hasMore: boolean }>(`/agents/${agent.id}/git/log?${qs}`);
      setCommits((c) => (skip === 0 ? r.commits : [...(c ?? []), ...r.commits])); setMore(r.hasMore); setErr('');
      return r.commits;
    } catch (e) { setErr(e instanceof Error ? e.message : 'error'); return null; } finally { setBusy(false); }
  };
  // Reload from the top whenever HEAD moves (new commit, pull, branch switch) or a filter changes. A new filter also moves the
  // selection to the first result, so the right side never keeps showing a commit that is not in the list.
  const lastFilter = useRef('');
  useEffect(() => {
    const key = `${text}|${by}|${path ?? ''}|${branch}`, changed = key !== lastFilter.current; lastFilter.current = key;
    void load(0).then((r) => { if (r && r.length && (changed ? true : !sel)) onSelect(r[0].sha); });
  }, [agent.id, head, text, by, path, branch]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="gx-hfilter">
        <div className="search"><Search size={14} /><input className="input" placeholder={t('git.hist.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('git.hist.search')} title={by === 'content' ? t('git.hist.by.hint') : undefined} /></div>
        <div className="row gap-s">
          <select className="input" value={by} onChange={(e) => setBy(e.target.value as typeof by)} aria-label={t('git.hist.search')} title={t('git.hist.by.hint')}>
            <option value="message">{t('git.hist.by.message')}</option><option value="author">{t('git.hist.by.author')}</option><option value="content">{t('git.hist.by.content')}</option>
          </select>
          <RefPicker refs={refs} value={branch} onChange={setBranch} extra={[{ value: '', label: t('git.hist.branchCurrent') }, { value: 'all', label: t('git.hist.branchAll') }]} />
        </div>
        {path && <div className="gx-chip soft gx-pathchip"><span className="mono nm" title={path}>{t('git.hist.file', { path })}</span><button className="btn ghost icon sm" onClick={onClearPath} aria-label={t('git.hist.clearFile')} title={t('git.hist.clearFile')}><X size={13} /></button></div>}
      </div>
      {err ? <p className="gx-note err">{err}</p> : !commits ? <p className="gx-note">{t('git.loading')}</p> : !commits.length ? <p className="gx-note">{filtered ? t('git.hist.noMatch') : t('git.hist.empty')}</p> : (
        <div className="gx-hist" role="listbox" aria-label={t('git.tab.history')}>
          {commits.map((c) => (
            <button key={c.sha} role="option" aria-selected={sel === c.sha} className={`gx-commit ${sel === c.sha ? 'sel' : ''}`} onClick={() => onSelect(c.sha)}>
              <span className="subj">{c.subject || '—'}</span>
              <span className="meta"><span className="mono sha">{c.short}</span> · {c.author} · {ago(Date.parse(c.date))}</span>
              {(c.refs.length > 0 || c.merge) && <span className="refs">{c.merge && <i className="ref">{t('git.hist.merge')}</i>}{c.refs.slice(0, 3).map((r) => <i key={r} className="ref">{r}</i>)}</span>}
            </button>
          ))}
          {more && <button className="btn sm gx-more" disabled={busy} onClick={() => void load(commits.length)}>{busy ? t('git.loading') : t('git.hist.more')}</button>}
        </div>
      )}
    </>
  );
}
