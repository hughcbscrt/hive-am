'use client';
import { ArrowLeftRight } from 'lucide-react';
import { useI18n } from '@/lib/i18n/index';
import { ago } from '@/lib/meta';
import type { Agent, GitCompare, GitRefs } from '@/lib/types';
import { RefPicker } from './RefPicker';
import { ChangesPreview } from './ChangesPreview';

export interface CompareSel { base: string; head: string }

/** Left column: the two points to compare. */
export function CompareList({ refs, sel, onChange }: { refs: GitRefs | null; sel: CompareSel; onChange: (s: CompareSel) => void }) {
  const { t } = useI18n();
  return (
    <div className="gx-cmpside">
      <label className="label">{t('git.cmp.base')}</label>
      <RefPicker refs={refs} value={sel.base} onChange={(base) => onChange({ ...sel, base })} />
      <div className="row" style={{ justifyContent: 'center' }}><button className="btn ghost icon sm" onClick={() => onChange({ base: sel.head, head: sel.base })} disabled={!sel.base && !sel.head} aria-label={t('git.cmp.swap')} title={t('git.cmp.swap')}><ArrowLeftRight size={15} style={{ transform: 'rotate(90deg)' }} /></button></div>
      <label className="label">{t('git.cmp.head')}</label>
      <RefPicker refs={refs} value={sel.head} onChange={(head) => onChange({ ...sel, head })} />
      {(!sel.base || !sel.head) && <p className="muted small">{t('git.cmp.pick')}</p>}
    </div>
  );
}

/** Right column: what changed going from the first point to the second. */
export function CompareView({ agent, sel }: { agent: Agent; sel: CompareSel }) {
  const { t } = useI18n();
  const ready = !!sel.base && !!sel.head;

  if (!ready) return <div className="gx-preview"><div className="gx-empty"><p>{t('git.cmp.pick')}</p></div></div>;
  const q = `base=${encodeURIComponent(sel.base)}&head=${encodeURIComponent(sel.head)}`;
  return (
    <ChangesPreview agent={agent} detailUrl={`/agents/${agent.id}/git/compare?${q}`} before={sel.base} after={sel.head} label={`${sel.base} → ${sel.head}`}
      diffUrl={(f) => `/agents/${agent.id}/git/compare-diff?${q}&path=${encodeURIComponent(f.path)}${f.oldPath ? `&old=${encodeURIComponent(f.oldPath)}` : ''}`}
      header={(d: GitCompare) => (<>
        <h3><span className="mono">{sel.base}</span> → <span className="mono">{sel.head}</span></h3>
        {d.base.sha === d.head.sha ? <p className="muted small" style={{ margin: 0 }}>{t('git.cmp.same')}</p> : (
          <div className="muted small row gap-s wrap"><span>{t('git.cmp.summary', { ahead: d.ahead, behind: d.behind })}</span><span>· {t('git.hist.files', { count: d.files.length })}</span></div>
        )}
        {d.commits.length > 0 && (
          <details className="gx-cmpcommits">
            <summary>{t('git.cmp.commits', { count: d.ahead })}</summary>
            <ul>{d.commits.map((c) => <li key={c.sha}><span className="mono sha">{c.short}</span> {c.subject} <span className="muted">· {c.author} · {ago(Date.parse(c.date))}</span></li>)}</ul>
            {d.commitsTruncated && <p className="muted small">{t('git.cmp.more', { count: d.commits.length })}</p>}
          </details>
        )}
      </>)} />
  );
}
