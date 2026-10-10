'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, GitBranch, Search, Tag } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { useDismiss } from '@/lib/useDismiss';
import { ago } from '@/lib/meta';
import type { Agent, GitRefs, RefInfo } from '@/lib/types';

/** Every branch and tag of the agent's repository, loaded once (and again when `stamp` changes: a commit, a pull, a switch). */
export function useRefs(agent: Agent, stamp?: unknown): GitRefs | null {
  const [refs, setRefs] = useState<GitRefs | null>(null);
  useEffect(() => {
    let dead = false;
    api.get<GitRefs>(`/agents/${agent.id}/git/refs`).then((r) => !dead && setRefs(r)).catch(() => !dead && setRefs({ current: null, branches: [], remotes: [], tags: [] }));
    return () => { dead = true; };
  }, [agent.id, stamp]);
  return refs;
}

/**
 * A button that opens a list of branches, tags and remote branches, with a search box. Anything that looks like a commit
 * (7+ hex characters) or `HEAD~2` can be typed and used as it is. `extra` adds fixed entries on top (e.g. "All branches").
 */
export function RefPicker({ refs, value, onChange, label, extra, icon = true, compact = false }: {
  refs: GitRefs | null; value: string; onChange: (ref: string) => void; label?: string; icon?: boolean;
  /** A small icon button (the chosen name appears next to it when there is one). */
  compact?: boolean;
  extra?: { value: string; label: string }[];
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useDismiss(open, box, () => setOpen(false));
  useEffect(() => { if (open) setQ(''); }, [open]);

  const match = (r: RefInfo) => !q || `${r.name} ${r.subject}`.toLowerCase().includes(q.toLowerCase());
  const branches = useMemo(() => (refs?.branches ?? []).filter(match), [refs, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const remotes = useMemo(() => (refs?.remotes ?? []).filter(match), [refs, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const tags = useMemo(() => (refs?.tags ?? []).filter(match), [refs, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const typed = q.trim();
  const asCommit = /^([0-9a-f]{7,40}|HEAD([~^]\d*)*)$/i.test(typed) && ![...(refs?.branches ?? []), ...(refs?.tags ?? [])].some((r) => r.name === typed);
  const pick = (v: string) => { onChange(v); setOpen(false); };

  const row = (r: RefInfo, kind: 'branch' | 'tag' | 'remote') => (
    <button key={`${kind}:${r.name}`} type="button" role="option" aria-selected={value === r.name} className={`gx-refrow ${value === r.name ? 'sel' : ''}`} onClick={() => pick(r.name)} title={r.subject}>
      <span className="nm">{value === r.name ? <Check size={13} /> : kind === 'tag' ? <Tag size={13} /> : <GitBranch size={13} />}{r.name}</span>
      <span className="sub">{r.subject || '—'} · {ago(Date.parse(r.date))}</span>
    </button>
  );
  return (
    <div className="gx-brmenu gx-refpick" ref={box}>
      {compact ? (
        <button type="button" className={`btn sm ${value ? 'primary gx-refbtn' : 'ghost icon'}`} aria-expanded={open} aria-haspopup="listbox" aria-label={label} title={label} onClick={() => setOpen((o) => !o)}>
          <GitBranch size={14} />{value && <span className="nm mono">{value}</span>}
        </button>
      ) : (
        <button type="button" className="btn sm gx-refbtn" aria-expanded={open} aria-haspopup="listbox" title={label} onClick={() => setOpen((o) => !o)}>
          {icon && <GitBranch size={14} />}<span className="nm mono">{extra?.find((x) => x.value === value)?.label ?? (value || t('git.ref.pick'))}</span><ChevronDown size={13} />
        </button>
      )}
      {open && (
        <div className="gx-pop" role="listbox">
          <div className="search"><Search size={14} /><input className="input" autoFocus placeholder={t('git.ref.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('git.ref.search')}
            onKeyDown={(e) => { if (e.key === 'Enter' && asCommit) pick(typed); }} /></div>
          <div className="gx-brlist">
            {!q && extra?.map((x) => <button key={x.value} type="button" role="option" aria-selected={value === x.value} className={`gx-refrow ${value === x.value ? 'sel' : ''}`} onClick={() => pick(x.value)}><span className="nm">{value === x.value && <Check size={13} />}{x.label}</span></button>)}
            {asCommit && <button type="button" className="gx-refrow" onClick={() => pick(typed)}><span className="nm mono">{t('git.ref.useCommit', { ref: typed.slice(0, 12) })}</span></button>}
            {branches.length > 0 && <div className="gx-brhead">{t('git.ref.branches')}</div>}
            {branches.map((r) => row(r, 'branch'))}
            {tags.length > 0 && <div className="gx-brhead">{t('git.ref.tags')}</div>}
            {tags.slice(0, 200).map((r) => row(r, 'tag'))}
            {remotes.length > 0 && <div className="gx-brhead">{t('git.ref.remotes')}</div>}
            {remotes.slice(0, 200).map((r) => row(r, 'branch'))}
            {refs && !branches.length && !tags.length && !remotes.length && !asCommit && <p className="gx-note">{t('git.ref.none')}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
