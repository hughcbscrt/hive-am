'use client';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { fmtBytes } from '@/lib/format';
import { IMAGE_RE, MARKDOWN_RE } from '@/lib/git/kinds';
import type { Agent, GitFileResult } from '@/lib/types';
import { Segmented } from '@/components/ui';
import { CopyBtn } from '@/components/chat/ToolCall';
import { FileView } from './GitExplorer';

/** A file as it was at a branch, tag or commit: highlighted text, Markdown preview, or the picture. Read-only; nothing is checked out. */
export function RefFile({ agent, gitRef, path, toolbar = true }: { agent: Agent; gitRef: string; path: string; toolbar?: boolean }) {
  const { t } = useI18n();
  const [file, setFile] = useState<GitFileResult | null>(null);
  const [err, setErr] = useState('');
  const [md, setMd] = useState<'preview' | 'source'>('preview');
  const pic = IMAGE_RE.test(path), isMd = MARKDOWN_RE.test(path);

  useEffect(() => {
    let dead = false; setFile(null); setErr(''); setMd('preview');
    if (pic) return;
    api.get<GitFileResult>(`/agents/${agent.id}/git/ref-file?ref=${encodeURIComponent(gitRef)}&path=${encodeURIComponent(path)}`)
      .then((r) => !dead && setFile(r)).catch((e) => !dead && setErr(e instanceof Error && /not found/i.test(e.message) ? t('git.file.missingAt', { ref: gitRef }) : e instanceof Error ? e.message : t('git.loadError')));
    return () => { dead = true; };
  }, [agent.id, gitRef, path]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {toolbar && (
        <div className="gx-ptools" style={{ padding: '6px 14px' }}>
          <span className="mono small grow" title={path} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{path}</span>
          {file && <span className="muted small">{fmtBytes(file.size)}</span>}
          {isMd && file && !file.binary && <Segmented value={md} onChange={setMd} options={[{ id: 'preview', label: t('git.view.preview') }, { id: 'source', label: t('git.view.source') }]} />}
          <CopyBtn text={path} label={t('git.copyPath')} />
        </div>
      )}
      <div className="gx-body">
        {err ? <p className="gx-note">{err}</p>
          : pic ? <div className="gx-image"><img src={`/api/agents/${agent.id}/git/raw-at?ref=${encodeURIComponent(gitRef)}&path=${encodeURIComponent(path)}`} alt={path} onError={() => setErr(t('git.file.missingAt', { ref: gitRef }))} /></div>
          : !file ? <p className="gx-note">{t('git.loading')}</p>
          : file.binary ? <p className="gx-note">{t('git.file.binary')}</p>
          : isMd && md === 'preview' ? <div className="gx-md md">{file.truncated && <div className="gx-banner">{t('git.diff.truncated')}</div>}<ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (p) => <a {...p} target="_blank" rel="noreferrer" /> }}>{file.content}</ReactMarkdown></div>
          : <FileView f={file} agent={agent} blame={false} onOpenCommit={() => undefined} marks={null} allNew={false} />}
      </div>
    </>
  );
}
