'use client';
import { ConfirmDialog, useToast } from '@/components/ui';
import { useHiveActions } from '@/lib/store';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import type { Agent } from '@/lib/types';

/** Confirm and delete an agent. Shared by the agent workspace and the colony panel. */
export function DeleteAgentModal({ agent, onClose, onDeleted }: { agent: Agent; onClose: () => void; onDeleted?: () => void }) {
  const { t } = useI18n();
  const { refresh } = useHiveActions();
  const toast = useToast();
  return (
    <ConfirmDialog title={t('agent.deleteTitle', { name: agent.name })} body={t('agent.deleteBody')} danger confirmLabel={t('agent.delete')} cancelLabel={t('agent.keep')} onClose={onClose}
      onConfirm={async () => { await api.del(`/agents/${agent.id}`); await refresh(['agents', 'colonies']); toast(t('agent.deleted')); onDeleted?.(); }} />
  );
}
