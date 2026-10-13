'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, GitBranch, GitMerge, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { ago } from '@/lib/meta';
import { useDismiss } from '@/lib/useDismiss';
import type { Agent, GitBranches } from '@/lib/types';
import { Modal } from '@/components/ui';
import type { GitActions } from './GitActions';

/* ------------------------------------------------------------------ branches */

export function BranchMenu({ agent, a, current, onSwitch }: { agent: Agent; a: GitActions; current: string | null; onSwitch: (branch: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<GitBranches | null>(null);
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [merge, setMerge] = useState<string | null>(null);
  const [del, setDel] = useState<string | null>(null);
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
      <button type="button" className="btn sm" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}><GitBranch size={14} />{t('git.act.branches')}<ChevronDown size={13} /></button>
      {open && (
        <div className="gx-pop" role="dialog" aria-label={t('git.act.branches')}>
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
                <button className="grow" disabled={b.name === current || !!a.busy} onClick={() => { setOpen(false); onSwitch(b.name); }} title={t('git.br.switchTo', { branch: b.name })}>
                  <span className="nm">{b.name === current && <Check size={13} />}{b.name}</span><span className="sub">{b.subject} · {ago(Date.parse(b.date))}</span>
                </button>
                {b.name !== current && <button className="btn ghost icon sm" disabled={!!a.busy} onClick={() => setMerge(b.name)} aria-label={t('git.br.merge', { branch: current ?? '' })} title={t('git.br.merge', { branch: current ?? '' })}><GitMerge size={14} /></button>}
                {b.name !== current && <button className="btn ghost icon sm" disabled={!!a.busy} onClick={() => { a.setNotice(null); setDel(b.name); setOpen(false); }} aria-label={t('git.br.delete', { branch: b.name })} title={t('git.br.delete', { branch: b.name })}><Trash2 size={14} /></button>}
              </div>
            ))}
            {remote.length > 0 && <div className="gx-brhead">{t('git.br.remote')}</div>}
            {remote.map((b) => (
              <div key={b.name} className="gx-br">
                <button className="grow" disabled={!!a.busy} onClick={() => { const short = b.name.split('/').slice(1).join('/'); setOpen(false); onSwitch(short); }} title={t('git.br.switchTo', { branch: b.name })}>
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
      {del && (
        <Modal title={t('git.br.delete', { branch: del })} onClose={() => setDel(null)}>
          <p className="confirm-body">{t('git.br.deleteAsk', { branch: del })}</p>
          {a.notice && <pre className="gx-notice err gx-prewrap">{a.notice.text}</pre>}
          <div className="row confirm-actions">
            <button className="btn ghost" onClick={() => setDel(null)}>{t('common.cancel')}</button>
            {a.notice && /not fully merged/i.test(a.notice.text)
              ? <button className="btn danger" disabled={!!a.busy} onClick={async () => { if (await a.run('branch-delete', t('git.done.branchDelete'), 'branch-delete', { branch: del, force: true })) setDel(null); }}>{t('git.br.deleteForce')}</button>
              : <button className="btn danger" disabled={!!a.busy} onClick={async () => { if (await a.run('branch-delete', t('git.done.branchDelete'), 'branch-delete', { branch: del })) setDel(null); }}>{t('git.br.deleteGo')}</button>}
          </div>
        </Modal>
      )}
    </div>
  );
}
