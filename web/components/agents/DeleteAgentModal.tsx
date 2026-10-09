'use client';
import { Modal, useToast } from '@/components/ui';
import { useHive } from '@/lib/store';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import type { Agent } from '@/lib/types';

/** Confirm and delete an agent. Shared by the agent workspace and the colony panel. */
export function DeleteAgentModal({ agent, onClose, onDeleted }: { agent: Agent; onClose: () => void; onDeleted?: () => void }) {
  const { t } = useI18n();
  const { refresh } = useHive();
  const toast = useToast();
  return (
    <Modal title={t('agent.deleteTitle', { name: agent.name })} onClose={onClose}>
      <p style={{ margin: 0 }} className="muted">{t('agent.deleteBody')}</p>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn ghost" onClick={onClose}>{t('agent.keep')}</button>
        <button className="btn danger" onClick={async () => {
          try { await api.del(`/agents/${agent.id}`); await refresh(['agents', 'colonies']); toast(t('agent.deleted')); onDeleted?.(); onClose(); }
          catch (e) { toast(e instanceof Error ? e.message : t('edit.saveFailed'), 'err'); }
        }}>{t('agent.delete')}</button></div>
    </Modal>
  );
}
