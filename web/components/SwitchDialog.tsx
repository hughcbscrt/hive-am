'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { parseDiff } from '@/lib/diff';
import type { Agent, SwitchPlan } from '@/lib/types';
import { Modal } from './ui';
import { DiffView } from './DiffView';
import type { GitActions } from './GitActions';

/** One of your new files that also exists on the other branch: the two versions, as a diff (− theirs, + yours). */
function Compare({ agent, path, branch }: { agent: Agent; path: string; branch: string }) {
  const { t } = useI18n();
  const [res, setRes] = useState<{ diff: string; binary: boolean } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let dead = false;
    api.get<{ diff: string; binary: boolean }>(`/agents/${agent.id}/git/collision-diff?path=${encodeURIComponent(path)}&branch=${encodeURIComponent(branch)}`).then((r) => !dead && setRes(r)).catch((e) => !dead && setErr(e instanceof Error ? e.message : 'error'));
    return () => { dead = true; };
  }, [agent.id, path, branch]);
  const parsed = useMemo(() => (res && !res.binary ? parseDiff(res.diff) : null), [res]);
  return (
    <div className="gx-cmp">
      <div className="gx-cmp-legend small muted"><span className="del">− {t('git.sw.cmp.theirs', { branch })}</span><span className="add">+ {t('git.sw.cmp.mine')}</span></div>
      <div className="gx-cmp-body">
        {err ? <p className="gx-note err">{err}</p> : !res ? <p className="gx-note">{t('git.loading')}</p> : res.binary ? <p className="gx-note">{t('git.diff.binary')}</p>
          : parsed && parsed.hunks.length ? <DiffView parsed={parsed} layout="unified" path={path} /> : <p className="gx-note">{t('git.diff.empty')}</p>}
      </div>
    </div>
  );
}

/**
 * Asked when switching branches is not just "git carries your changes over": other agents are working in the same
 * repository, and/or some of your changes clash with the other branch.
 */
export function SwitchDialog({ agent, plan, a, onClose }: { agent: Agent; plan: SwitchPlan; a: GitActions; onClose: () => void }) {
  const { t } = useI18n();
  const [keep, setKeep] = useState<Record<string, 'mine' | 'theirs'>>({});
  const [open, setOpen] = useState<string | null>(null);
  const clash = plan.overlap.length > 0 || plan.collisions.length > 0;
  const chosen = plan.collisions.every((p) => keep[p]);
  const done = t('git.done.switch', { branch: plan.to });
  const go = async (mode: 'smart' | 'force' | 'plain') => {
    onClose();
    if (mode === 'plain') await a.run('switch', done, 'switch', { branch: plan.to });
    else await a.run('switch', done, 'switch-smart', { branch: plan.to, mode, keep });
  };

  return (
    <Modal title={t('git.sw.title', { branch: plan.to })} onClose={onClose} wide>
      {plan.carried > 0 && <p className="muted" style={{ margin: 0 }}>{t('git.sw.carried', { count: plan.carried, from: plan.from })}</p>}
      {(plan.others.length > 0 || plan.selfRunning) && (
        <div className="gx-sw-warn" role="alert">
          {plan.selfRunning && <div>{t('git.warn.running', { name: agent.name })}</div>}
          {plan.others.length > 0 && <div>{t('git.sw.others', { count: plan.others.length, names: plan.others.map((o) => o.name).join(', ') })}</div>}
        </div>
      )}
      {plan.overlap.length > 0 && (
        <div className="gx-sw-sec">
          <b>{t('git.sw.overlap', { count: plan.overlap.length, branch: plan.to })}</b>
          <ul className="gx-dlist">{plan.overlap.slice(0, 10).map((f) => <li key={f} className="mono">{f}</li>)}{plan.overlap.length > 10 && <li className="muted">{t('hover.more', { count: plan.overlap.length - 10 })}</li>}</ul>
        </div>
      )}
      {plan.collisions.length > 0 && (
        <div className="gx-sw-sec">
          <b>{t('git.sw.collisions', { count: plan.collisions.length, branch: plan.to })}</b>
          <div className="gx-sw-cols">
            {plan.collisions.map((p) => (
              <div key={p} className="gx-sw-col">
                <div className="row gap-s wrap">
                  <span className="mono grow">{p}</span>
                  <button type="button" className="btn ghost sm" aria-expanded={open === p} onClick={() => setOpen(open === p ? null : p)}>{t('git.sw.compare')}</button>
                  <div className="seg" role="group" aria-label={p}>
                    <button type="button" aria-pressed={keep[p] === 'mine'} onClick={() => setKeep({ ...keep, [p]: 'mine' })}>{t('git.sw.keepMine')}</button>
                    <button type="button" aria-pressed={keep[p] === 'theirs'} onClick={() => setKeep({ ...keep, [p]: 'theirs' })}>{t('git.sw.keepTheirs', { branch: plan.to })}</button>
                  </div>
                </div>
                {open === p && <Compare agent={agent} path={p} branch={plan.to} />}
              </div>
            ))}
          </div>
          {!chosen && <p className="small muted" style={{ margin: 0 }}>{t('git.sw.chooseEach')}</p>}
        </div>
      )}
      {clash && (<>
        <p className="small muted" style={{ margin: 0 }}><b>{t('git.sw.smart')}</b> {t('git.sw.smart.hint')}<br /><b>{t('git.sw.force')}</b> {t('git.sw.force.hint')}</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn danger" disabled={!!a.busy} onClick={() => void go('force')}>{t('git.sw.force')}</button>
          <button className="btn primary" disabled={!!a.busy || !chosen} onClick={() => void go('smart')}>{t('git.sw.smart')}</button>
        </div>
      </>)}
      {!clash && (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" disabled={!!a.busy} onClick={() => void go('plain')}>{t('git.sw.anyway')}</button>
        </div>
      )}
    </Modal>
  );
}
