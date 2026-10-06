'use client';
import { useI18n } from '@/lib/i18n';
import type { Agent, SwitchPlan } from '@/lib/types';
import { Modal } from './ui';
import type { GitActions } from './GitActions';

/**
 * The only time switching asks: other agents are working in this repository right now, and a branch switch moves
 * their files too. (Everything else happens directly: git carries clean changes over, and anything else goes through
 * a stash and the conflict resolver.)
 */
export function SwitchDialog({ agent, plan, a, onClose, onGo }: { agent: Agent; plan: SwitchPlan; a: GitActions; onClose: () => void; onGo: () => void }) {
  const { t } = useI18n();
  return (
    <Modal title={t('git.sw.title', { branch: plan.to })} onClose={onClose}>
      {plan.carried > 0 && <p className="muted" style={{ margin: 0 }}>{t('git.sw.carried', { count: plan.carried, from: plan.from })}</p>}
      <div className="gx-sw-warn" role="alert">
        {plan.selfRunning && <div>{t('git.warn.running', { name: agent.name })}</div>}
        {plan.others.length > 0 && <div>{t('git.sw.others', { count: plan.others.length, names: plan.others.map((o) => o.name).join(', ') })}</div>}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={!!a.busy} onClick={onGo}>{t('git.sw.anyway')}</button>
      </div>
    </Modal>
  );
}
