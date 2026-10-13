'use client';
import { memo, useCallback, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, File, FileCode, FileImage, FileText, Folder, FolderOpen } from 'lucide-react';
import { useI18n } from '@/lib/i18n/index';
import type { Row, TreeNode } from '@/lib/git/gitTree';
import { IMAGE_RE } from '@/lib/git/kinds';
import { languageOf } from '@/lib/git/highlight';
import { StatusLetter } from './StatusLetter';

function FileIcon({ name }: { name: string }) {
  if (IMAGE_RE.test(name)) return <FileImage size={15} />;
  if (/\.(md|mdx|txt|rst)$/i.test(name)) return <FileText size={15} />;
  if (languageOf(name)) return <FileCode size={15} />;
  return <File size={15} />;
}

/**
 * The file tree (ARIA tree): one tab stop, Up/Down/Home/End move between rows, Right opens a folder or enters it, Left closes it or goes to the parent.
 * Memoized: it only re-renders when the rows, the selection or the open folders change, not for the explorer's other state.
 */
export const FileTree = memo(function FileTree({ rows, expanded, forceOpen, sel, onToggle, onSelect, label }: {
  rows: Row[]; expanded: Set<string>; /** A filter is on: every folder shown is open. */ forceOpen: boolean; sel: string | null;
  onToggle: (node: TreeNode) => void; onSelect: (path: string) => void; label: string;
}) {
  const { t } = useI18n();
  const list = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const keyOf = (n: TreeNode) => `${n.ignored ? 'i:' : ''}${n.path}`;
  // The one row in the tab order: the one last focused, else the selected file, else the first.
  const stop = rows.some((r) => keyOf(r.node) === focused) ? focused : rows.find((r) => r.node.path === sel && !r.node.ignored)?.node.path ?? (rows[0] ? keyOf(rows[0].node) : null);

  const onKey = useCallback((e: React.KeyboardEvent) => {
    const btns = [...(list.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => { e.preventDefault(); btns[Math.max(0, Math.min(btns.length - 1, n))]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(btns.length - 1);
    else if (i >= 0 && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      const el = btns[i]; const isDir = el.dataset.dir === '1'; const open = el.getAttribute('aria-expanded') === 'true';
      if (e.key === 'ArrowRight') { if (isDir && !open) { e.preventDefault(); el.click(); } else if (isDir && open) go(i + 1); }
      else if (isDir && open) { e.preventDefault(); el.click(); }
      else { const level = Number(el.getAttribute('aria-level')); for (let p = i - 1; p >= 0; p--) if (Number(btns[p].getAttribute('aria-level')) < level) { go(p); break; } }
    }
  }, []);

  return (
    <div className="gx-tree-rows" ref={list} onKeyDown={onKey} role="tree" aria-label={label}>
      {rows.map(({ node, depth }) => {
        const isDir = node.type === 'dir'; const open = isDir && (forceOpen || expanded.has(node.path));
        const c = node.change; const k = keyOf(node);
        return (
          <button key={k} data-row data-dir={isDir ? '1' : '0'} data-path={node.path} type="button" role="treeitem" aria-level={depth + 1} aria-expanded={isDir ? !!open : undefined} aria-selected={!isDir && sel === node.path}
            tabIndex={stop === k ? 0 : -1} onFocus={() => setFocused(k)}
            className={`gx-row ${isDir ? 'dir' : 'file'} ${node.ignored ? 'ignored' : ''} ${c ? `changed st-${c.status}` : ''} ${!isDir && sel === node.path ? 'sel' : ''} ${isDir && node.changed ? 'has-changes' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }} title={node.ignored ? `${node.path}: ${t('git.ignored.hint')}` : node.path}
            onClick={() => (isDir ? onToggle(node) : onSelect(node.path))}>
            <span className="chev">{isDir ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}</span>
            <span className="ico">{isDir ? (open ? <FolderOpen size={15} /> : <Folder size={15} />) : <FileIcon name={node.name} />}</span>
            <span className="nm">{node.name}</span>
            {isDir && node.changed > 0 && <span className="dirdot" title={t('git.dirChanged', { count: node.changed })}>{node.changed}</span>}
            {c && (<span className="meta">
              {(c.additions !== null || c.deletions !== null) && <span className="gx-counts sm"><i className="add">+{c.additions ?? 0}</i><i className="del">−{c.deletions ?? 0}</i></span>}
              <StatusLetter status={c.status} titled />
            </span>)}
          </button>
        );
      })}
    </div>
  );
});
