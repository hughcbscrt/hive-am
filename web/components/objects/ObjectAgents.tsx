'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { useHive } from '@/lib/store';
import type { ObjectView } from '@/lib/types';
import { useToast } from '@/components/ui';
import { OBJECTS_SKILL_ID } from '@/components/agents/NewAgentDrawer';
import { Card } from './ObjectForm';

/**
 * Which agents look after a resource. The agents of its own colony already can (when they have the skill); here a person adds any other
 * existing agent by hand. Linking one that lacks the "Colony resources" skill gives it the skill. It saves on its own, not with the settings bar.
 */
export function ObjectAgents({ object: o }: { object: ObjectView }) {
  const { t } = useI18n();
  const { agents, colonies, refresh } = useHive();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const colonyName = (id: string | null) => colonies.find((c) => c.id === id)?.name;
  const same = (a: { colony_id: string | null }) => (a.colony_id ?? null) === (o.colony_id ?? null);
  const set = async (id: string, on: boolean) => {
    const next = on ? [...o.agent_ids, id] : o.agent_ids.filter((x) => x !== id);
    setBusy(true);
    try {
      const r = await api.put<{ skillAdded: string[] }>(`/objects/${o.id}/agents`, { agent_ids: next });
      await refresh(['objects', 'agents']);
      if (r.skillAdded.length) toast(t('obj.agents.skillAdded'));
    } catch (e) { toast(e instanceof Error ? e.message : '', 'err'); } finally { setBusy(false); }
  };
  return (
    <Card title={t('obj.agents.title')} hint={t('obj.agents.hint')} wide>
      {agents.length === 0 ? <p className="muted small" style={{ margin: 0 }}>{t('obj.agents.none')}</p> : (
        <div className="col" style={{ gap: 4 }}>
          {agents.map((a) => {
            const inColony = same(a), linked = o.agent_ids.includes(a.id), has = a.skill_ids.includes(OBJECTS_SKILL_ID);
            return (
              <label key={a.id} className="row gap-s oa-row">
                <input type="checkbox" checked={linked || (inColony && has)} disabled={busy || (inColony && has && !linked)} onChange={(e) => void set(a.id, e.target.checked)} />
                <b>{a.name}</b>
                <span className="muted small grow">{colonyName(a.colony_id) ?? t('common.noColony')}{inColony && has && !linked ? ` · ${t('obj.agents.byColony')}` : ''}{!has && !linked ? ` · ${t('obj.agents.noSkill')}` : ''}{a.permission === 'plan' ? ` · ${t('obj.managers.readonly')}` : ''}</span>
              </label>
            );
          })}
        </div>
      )}
    </Card>
  );
}
