'use client';
import { Drawer } from '@/components/ui';
import { AgentForm } from './AgentForm';
import { useAgentSettings } from './useAgentSettings';
import { useI18n } from '@/lib/i18n/index';
import type { Agent } from '@/lib/types';

/** Edit an agent without leaving the page you're on. Same form and actions as the agent workspace sidebar. */
export function AgentEditDrawer({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const { t } = useI18n();
  const s = useAgentSettings(agent, { onSaved: onClose, onDeleted: onClose });
  if (!s.draft) return null;
  return (
    <>
      <Drawer title={t('edit.title', { name: agent.name })} subtitle={agent.status === 'running' ? t('edit.subtitleRunning') : t('edit.subtitleIdle')} onClose={onClose}
        footer={s.actions({ onCancel: onClose })}>
        <AgentForm draft={s.draft} onChange={s.setDraft} errors={s.errors} selfId={agent.id} />
      </Drawer>
      {s.deleteModal}
    </>
  );
}
