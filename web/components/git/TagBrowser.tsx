'use client';
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, File, Folder, FolderOpen, Search, Tag } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { fmtBytes, fmtDateTime } from '@/lib/format';
import { ago } from '@/lib/meta';
import { buildTree, flatten } from '@/lib/git/gitTree';
import type { Agent, GitFileResult, GitTagInfo } from '@/lib/types';
import { Segmented } from '@/components/ui';
import { CopyBtn } from '@/components/chat/ToolCall';
import { CommitPreview, FileView } from './GitExplorer';

/** Browsing tags is read-only: the working folder is never touched, everything is read from the tag's own commit. */

export function TagList({ agent, sel, onSelect, onLoaded }: { agent: Agent; sel: string | null; onSelect: (tag: GitTagInfo) => void; onLoaded?: (tags: GitTagInfo[]) => void }) {
  const { t } = useI18n();
  const [tags, setTags] = useState<GitTagInfo[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    let dead = false; setTags(null); setErr('');
    api.get<{ tags: GitTagInfo[]; truncated: boolean }>(`/agents/${agent.id}/git/tags`).then((r) => { if (dead) return; setTags(r.tags); setTruncated(r.truncated); onLoaded?.(r.tags); }).catch((e) => !dead && setErr(e instanceof Error ? e.message : 'error'));
    return () => { dead = true; };
  }, [agent.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => (tags ?? []).filter((x) => !q || `${x.name} ${x.subject}`.toLowerCase().includes(q.toLowerCase())), [tags, q]);

  if (err) return <p className="gx-note err">{err}</p>;
  if (!tags) return <p className="gx-note">{t('git.loading')}</p>;
  if (!tags.length) return <p className="gx-note">{t('git.tags.empty')}</p>;
  return (
    <>
      <div className="gx-filter"><div className="search"><Search size={14} /><input className="input" placeholder={t('git.tags.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('git.tags.search')} /></div></div>
      <div className="gx-hist" role="listbox" aria-label={t('git.tab.tags')}>
        {shown.map((x) => (
          <button key={x.name} role="option" aria-selected={sel === x.name} className={`gx-commit ${sel === x.name ? 'sel' : ''}`} onClick={() => onSelect(x)}>
            <span className="subj"><Tag size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />{x.name}</span>
            <span className="meta">{x.subject || '—'}</span>
            <span className="meta"><span className="mono sha">{x.sha.slice(0, 8)}</span> · {ago(Date.parse(x.date))}</span>
          </button>
        ))}
        {!shown.length && <p className="gx-note">{t('git.noMatch', { query: q })}</p>}
        {truncated && <p className="gx-note">{t('git.tags.truncated', { count: tags.length })}</p>}
      </div>
    </>
  );
}

const MARKDOWN = /\.(md|markdown|mdx)$/i;

/** One tag: the files as they were at that tag, and what the tag's commit changed. */
export function TagView({ agent, tag }: { agent: Agent; tag: GitTagInfo }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'files' | 'changes'>('files');
  const [files, setFiles] = useState<string[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [file, setFile] = useState<GitFileResult | null>(null);
  const [err, setErr] = useState('');
  const [md, setMd] = useState<'preview' | 'source'>('preview');

  useEffect(() => { setTab('files'); setSel(null); setFile(null); setQuery(''); setExpanded(new Set()); }, [tag.name]);
  useEffect(() => {
    let dead = false; setFiles(null); setErr('');
    api.get<{ files: string[]; truncated: boolean }>(`/agents/${agent.id}/git/tag-tree?tag=${encodeURIComponent(tag.name)}`)
      .then((r) => { if (dead) return; setFiles(r.files); setTruncated(r.truncated); setExpanded(new Set(r.files.length <= 40 ? r.files.flatMap((p) => p.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))) : [])); })
      .catch((e) => !dead && setErr(e instanceof Error ? e.message : t('git.loadError')));
    return () => { dead = true; };
  }, [agent.id, tag.name]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!sel) { setFile(null); return; }
    let dead = false; setFile(null); setMd('preview');
    api.get<GitFileResult>(`/agents/${agent.id}/git/tag-file?tag=${encodeURIComponent(tag.name)}&path=${encodeURIComponent(sel)}`).then((r) => !dead && setFile(r)).catch((e) => !dead && setErr(e instanceof Error ? e.message : t('git.loadError')));
    return () => { dead = true; };
  }, [agent.id, tag.name, sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const root = useMemo(() => (files ? buildTree(files, []) : null), [files]);
  const rows = useMemo(() => (root ? flatten(root, expanded, { query, onlyChanged: false }).slice(0, 3000) : []), [root, expanded, query]);
  const toggle = (p: string) => setExpanded((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const isMd = !!sel && MARKDOWN.test(sel);

  return (
    <section className="gx-preview gx-tagview" aria-label={tag.name}>
      <header className="gx-chead">
        <h3><Tag size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />{tag.name}</h3>
        {tag.subject && <div>{tag.subject}</div>}
        <div className="muted small row gap-s wrap"><span className="gx-chip soft">{tag.annotated ? t('git.tags.annotated') : t('git.tags.lightweight')}</span><span className="mono">{tag.sha.slice(0, 10)}</span><CopyBtn text={tag.sha} label={t('git.info.copySha')} /><span>· {fmtDateTime(tag.date)}</span>{files && <span>· {t('git.tags.nfiles', { count: files.length })}</span>}</div>
        <div style={{ marginTop: 8 }}><Segmented value={tab} onChange={setTab} options={[{ id: 'files', label: t('git.tags.files') }, { id: 'changes', label: t('git.tags.changes') }]} /></div>
      </header>
      {tab === 'changes' ? <CommitPreview key={tag.sha} agent={agent} sha={tag.sha} embedded /> : err ? <p className="gx-note err">{err}</p> : !root ? <p className="gx-note">{t('git.loading')}</p> : (
        <div className="gx-tagfiles">
          <div className="gx-tagtree">
            <div className="gx-filter"><div className="search"><Search size={14} /><input className="input" placeholder={t('git.filterPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('git.filterPlaceholder')} /></div></div>
            <div className="gx-list" role="tree">
              {rows.length === 0 ? <p className="gx-note">{query ? t('git.noMatch', { query }) : t('git.noFiles')}</p> : rows.map(({ node, depth }) => {
                const isDir = node.type === 'dir'; const open = isDir && (!!query || expanded.has(node.path));
                return (
                  <button key={node.path} type="button" role="treeitem" aria-level={depth + 1} aria-expanded={isDir ? open : undefined} aria-selected={!isDir && sel === node.path}
                    className={`gx-row ${isDir ? 'dir' : 'file'} ${!isDir && sel === node.path ? 'sel' : ''}`} style={{ paddingLeft: 8 + depth * 14 }} title={node.path} onClick={() => (isDir ? toggle(node.path) : setSel(node.path))}>
                    <span className="chev">{isDir ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}</span>
                    <span className="ico">{isDir ? (open ? <FolderOpen size={15} /> : <Folder size={15} />) : <File size={15} />}</span>
                    <span className="nm">{node.name}</span>
                  </button>
                );
              })}
              {truncated && <p className="gx-note">{t('git.treeTruncated', { count: files?.length ?? 0 })}</p>}
            </div>
          </div>
          <div className="gx-tagfile">
            {!sel ? <div className="gx-empty"><p>{t('git.tags.pick')}</p></div> : !file ? <p className="gx-note">{t('git.loading')}</p> : (
              <>
                <div className="gx-ptools" style={{ padding: '6px 14px' }}>
                  <span className="mono small grow" title={sel} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{sel}</span><span className="muted small">{fmtBytes(file.size)}</span>
                  {isMd && !file.binary && <Segmented value={md} onChange={setMd} options={[{ id: 'preview', label: t('git.view.preview') }, { id: 'source', label: t('git.view.source') }]} />}
                  <CopyBtn text={sel} label={t('git.copyPath')} />
                </div>
                <div className="gx-body">
                  {file.binary ? <p className="gx-note">{t('git.file.binary')}</p>
                    : isMd && md === 'preview' ? <div className="gx-md md">{file.truncated && <div className="gx-banner">{t('git.diff.truncated')}</div>}<ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (p) => <a {...p} target="_blank" rel="noreferrer" /> }}>{file.content}</ReactMarkdown></div>
                    : <FileView f={file} agent={agent} blame={false} onOpenCommit={() => undefined} marks={null} allNew={false} />}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
