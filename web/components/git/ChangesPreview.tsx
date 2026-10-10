'use client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { fmtDateTime } from '@/lib/format';
import { parseDiff } from '@/lib/git/diff';
import { IMAGE_RE } from '@/lib/git/kinds';
import type { Agent, GitCommitDetail, GitCommitFile, GitDiffResult } from '@/lib/types';
import { Segmented } from '@/components/ui';
import { CopyBtn } from '@/components/chat/ToolCall';
import { DiffView } from './DiffView';
import { StatusLetter } from './StatusLetter';

/** A picture of a file as it was at one point (read from git, not from the working folder). Hidden when it did not exist there. */
function PicAt({ agent, gitRef, path, label }: { agent: Agent; gitRef: string; path: string; label: string }) {
  const [ok, setOk] = useState(true);
  useEffect(() => { setOk(true); }, [gitRef, path]);
  if (!ok) return null;
  return (
    <figure className="gx-pic">
      <figcaption className="muted small">{label}</figcaption>
      <div className="gx-image"><img src={`/api/agents/${agent.id}/git/raw-at?ref=${encodeURIComponent(gitRef)}&path=${encodeURIComponent(path)}`} alt={path} onError={() => setOk(false)} /></div>
    </figure>
  );
}

/**
 * The files that changed between two points (one commit against its parent, or any two refs) and the diff of the one picked.
 * Pictures that changed are shown before and after instead of "binary file".
 */
export function ChangesPreview({ agent, detailUrl, diffUrl, header, focus, embedded = false, before, after, label }: {
  agent: Agent; detailUrl: string; diffUrl: (f: GitCommitFile) => string; header: (d: any) => ReactNode;
  /** A file to open first (when it is one of the changed ones). */
  focus?: string; embedded?: boolean;
  /** Where "before" and "after" are read from, for pictures. */
  before: string; after: string; label: string;
}) {
  const { t } = useI18n();
  const [d, setD] = useState<{ files: GitCommitFile[]; truncated?: boolean } | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<GitDiffResult | null>(null);
  const [layout, setLayout] = useState<'unified' | 'split'>('unified');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let dead = false; setD(null); setFile(null); setDiff(null); setErr(null);
    api.get<{ files: GitCommitFile[]; truncated?: boolean }>(detailUrl).then((x) => { if (dead) return; setD(x); setFile((focus && x.files.some((f) => f.path === focus) ? focus : x.files[0]?.path) ?? null); }).catch((e) => !dead && setErr(e instanceof Error ? e.message : t('git.loadError')));
    return () => { dead = true; };
  }, [agent.id, detailUrl, focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const f = d?.files.find((x) => x.path === file);
  useEffect(() => {
    if (!f) { setDiff(null); return; }
    let dead = false; setDiff(null);
    api.get<GitDiffResult>(diffUrl(f)).then((x) => !dead && setDiff(x)).catch((e) => !dead && setErr(e instanceof Error ? e.message : t('git.loadError')));
    return () => { dead = true; };
  }, [agent.id, detailUrl, f?.path, f?.oldPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = useMemo(() => (diff && f && diff.path === f.path ? parseDiff(diff.diff) : null), [diff, f]);
  if (err) return <section className="gx-preview"><p className="gx-note err">{err}</p></section>;
  if (!d) return <section className="gx-preview"><p className="gx-note">{t('git.loading')}</p></section>;
  const isPic = !!f && IMAGE_RE.test(f.path);
  return (
    <section className={`gx-preview gx-commitview ${embedded ? 'embedded' : ''}`} aria-label={label}>
      <header className="gx-chead">{header(d)}</header>
      {d.files.length === 0 ? <p className="gx-note">{t('git.cmp.nofiles')}</p> : (
        <div className="gx-cfilelist" role="listbox">
          {d.files.map((x) => (
            <button key={x.path} role="option" aria-selected={file === x.path} className={`gx-cfile ${file === x.path ? 'sel' : ''}`} onClick={() => setFile(x.path)} title={x.oldPath ? `${x.oldPath} → ${x.path}` : x.path}>
              <StatusLetter status={x.status} /><span className="mono nm">{x.path}</span>
              {(x.additions !== null || x.deletions !== null) && <span className="gx-counts sm"><i className="add">+{x.additions ?? 0}</i><i className="del">−{x.deletions ?? 0}</i></span>}
            </button>
          ))}
        </div>
      )}
      {f && (<>
        {!isPic && <div className="gx-ptools" style={{ padding: '6px 14px' }}><Segmented value={layout} onChange={setLayout} options={[{ id: 'unified', label: t('git.layout.unified') }, { id: 'split', label: t('git.layout.split') }]} /></div>}
        <div className="gx-body">
          {isPic ? (
            <div className="gx-picpair">
              {f.status !== 'added' && <PicAt agent={agent} gitRef={before} path={f.oldPath ?? f.path} label={t('git.img.before')} />}
              {f.status !== 'deleted' && <PicAt agent={agent} gitRef={after} path={f.path} label={t('git.img.after')} />}
            </div>
          ) : !parsed ? <p className="gx-note">{t('git.loading')}</p> : parsed.binary ? <p className="gx-note">{t('git.diff.binary')}</p> : parsed.hunks.length === 0 ? <p className="gx-note">{t('git.diff.empty')}</p>
            : (<>{diff?.truncated && <div className="gx-banner">{t('git.diff.truncated')}</div>}<DiffView parsed={parsed} layout={layout} path={f.path} /></>)}
        </div>
      </>)}
    </section>
  );
}

/** One commit against its first parent. `focus` opens that file first. */
export function CommitPreview({ agent, sha, embedded = false, focus }: { agent: Agent; sha: string; embedded?: boolean; focus?: string }) {
  const { t } = useI18n();
  return (
    <ChangesPreview agent={agent} detailUrl={`/agents/${agent.id}/git/commit?sha=${sha}`} embedded={embedded} focus={focus} before={`${sha}^`} after={sha} label={sha}
      diffUrl={(f) => `/agents/${agent.id}/git/commit-diff?sha=${sha}&path=${encodeURIComponent(f.path)}${f.oldPath ? `&old=${encodeURIComponent(f.oldPath)}` : ''}`}
      header={(d: GitCommitDetail) => {
        const [subject, ...rest] = d.message.split('\n');
        const body = rest.join('\n').trim();
        return (<>
          <h3>{subject}</h3>
          {body && <pre className="gx-cbody">{body}</pre>}
          <div className="muted small row gap-s wrap"><span className="mono">{d.sha.slice(0, 10)}</span><CopyBtn text={d.sha} label={t('git.info.copySha')} /><span>· {d.author} · {fmtDateTime(d.date)}</span>
            <span>· {t('git.hist.files', { count: d.files.length })}</span></div>
        </>);
      }} />
  );
}
