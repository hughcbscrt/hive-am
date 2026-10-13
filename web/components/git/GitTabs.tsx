'use client';
import { Archive, FolderTree, GitCompareArrows, History, Tag } from 'lucide-react';
import { useI18n } from '@/lib/i18n/index';

export type GitMode = 'files' | 'history' | 'tags' | 'compare' | 'stashes';
export const GIT_MODES: readonly GitMode[] = ['files', 'history', 'tags', 'compare', 'stashes'];
const ICONS = { files: FolderTree, history: History, tags: Tag, compare: GitCompareArrows, stashes: Archive } as const;
export const gitTabId = (m: GitMode) => `gx-tab-${m}`;
export const GIT_PANEL_ID = 'gx-side-panel';

/**
 * The explorer's side tabs. Icons only, the selected one also shows its name, so it stays a local component instead of `Tabs` (which has no icon-only
 * mode); the ARIA is the same: roving tab stop, arrows/Home/End select, and the tabs point at the panel below. Alt+1..5 are handled by the explorer.
 */
export function GitTabs({ mode, onChange, stashCount, label }: { mode: GitMode; onChange: (m: GitMode) => void; stashCount: number; label: string }) {
  const { t } = useI18n();
  const name = (m: GitMode) => `${t(`git.tab.${m}`)}${m === 'stashes' && stashCount ? ` · ${stashCount}` : ''}`;
  const key = (e: React.KeyboardEvent) => {
    const i = GIT_MODES.indexOf(mode); let n: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % GIT_MODES.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + GIT_MODES.length) % GIT_MODES.length;
    else if (e.key === 'Home') n = 0; else if (e.key === 'End') n = GIT_MODES.length - 1;
    if (n === null) return;
    e.preventDefault(); onChange(GIT_MODES[n]); requestAnimationFrame(() => document.getElementById(gitTabId(GIT_MODES[n!]))?.focus());
  };
  return (
    <div className="gx-tabs" role="tablist" aria-label={label} onKeyDown={key}>
      {GIT_MODES.map((id, n) => {
        const Icon = ICONS[id];
        return <button key={id} id={gitTabId(id)} type="button" role="tab" aria-selected={mode === id} aria-controls={GIT_PANEL_ID} tabIndex={mode === id ? 0 : -1} aria-label={name(id)} title={`${name(id)} (Alt+${n + 1})`} className={`gx-tab ${mode === id ? 'on' : ''}`} onClick={() => onChange(id)}><Icon size={15} />{mode === id && <span>{name(id)}</span>}</button>;
      })}
    </div>
  );
}
