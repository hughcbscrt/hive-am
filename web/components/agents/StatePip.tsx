'use client';
import { useI18n } from '@/lib/i18n';
import type { DotState } from '@/lib/attentionRules';

const LABEL = { running: 'status.running', err: 'status.error', unread: 'attn.state.doneUnread' } as const;

/** The dot on an agent's avatar (working, needs attention, finished unread), with its state as accessible name. Nothing when there is no state. */
export function StatePip({ state }: { state: DotState }) {
  const { t } = useI18n();
  if (!state) return null;
  return <i className={`pip ${state === 'running' ? '' : state}`} role="img" aria-label={t(LABEL[state])} />;
}
