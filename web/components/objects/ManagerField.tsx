'use client';
import { useMemo } from 'react';
import { useI18n } from '@/lib/i18n/index';
import { useHive } from '@/lib/store';
import { Field } from '@/components/ui';
import { PickSearch } from '@/components/PickSearch';

/** The resource kinds an agent can start, stop and restart. */
export const MANAGEABLE = ['server', 'docker', 'cluster'];

/** The one agent that looks after a resource, chosen by searching the agents. Used when creating and when editing. */
export function ManagerField({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { t } = useI18n();
  const { agents, colonies } = useHive();
  const options = useMemo(() => agents.map((a) => ({ id: a.id, label: a.name, hint: colonies.find((c) => c.id === a.colony_id)?.name ?? t('common.noColony') })), [agents, colonies, t]);
  return (
    <Field label={t('obj.manager.label')} hint={value ? t('obj.manager.hint.set') : t('obj.manager.hint.none')}>
      <PickSearch options={options} value={value ? [value] : []} onChange={(ids) => onChange(ids[0] ?? '')} placeholder={t('obj.manager.placeholder')} empty={t('obj.manager.empty')} ariaLabel={t('obj.manager.label')} />
    </Field>
  );
}
