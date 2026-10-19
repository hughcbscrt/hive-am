'use client';
import { useState } from 'react';
import { Copy } from 'lucide-react';
import { api } from '@/lib/api';
import { useHiveActions, useHiveData } from '@/lib/store';
import { useI18n } from '@/lib/i18n/index';
import type { Agent } from '@/lib/types';
import { Field, Modal, useToast } from '@/components/ui';

/** A name that is free: "Maggie 2", "Maggie 3"... */
const freeName = (base: string, taken: Set<string>) => { for (let n = 2; ; n++) { const c = `${base} ${n}`; if (!taken.has(c.toLowerCase())) return c; } };

/**
 * Clone an agent: a separate agent with the same configuration that runs in parallel with it and reads the same notebook. The dialog says what it is and what it
 * does not bring. Shared by the colony (its card) and the agent workspace (its footer).
 */
export function CloneAgentModal({ agent, onClose, onCloned }: { agent: Agent; onClose: () => void; onCloned?: (clone: Agent) => void }) {
  const { t } = useI18n();
  const { agents, colonies } = useHiveData();
  const { refresh } = useHiveActions();
  const toast = useToast();
  const [name, setName] = useState(() => freeName(agent.name, new Set(agents.map((a) => a.name.toLowerCase()))));
  const [colony, setColony] = useState(agent.colony_id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const clash = agents.some((a) => a.name.toLowerCase() === name.trim().toLowerCase());
  const go = async () => {
    setBusy(true); setError('');
    try {
      const clone = await api.post<Agent>(`/agents/${agent.id}/clone`, { name: name.trim(), colony_id: colony || null });
      await refresh(['agents', 'colonies']);
      toast(t('agent.cloned', { name: clone.name }));
      onCloned?.(clone);
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };
  return (
    <Modal title={t('agent.clone.title', { name: agent.name })} onClose={onClose}>
      <Field label={t('agent.clone.name')} error={clash ? t('agent.clone.taken') : error}>
        <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim() && !clash && !busy) void go(); }} />
      </Field>
      <Field label={t('form.colony')}>
        <select className="select" value={colony} onChange={(e) => setColony(e.target.value)}>
          <option value="">{t('common.noColony')}</option>{colonies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <ul className="muted small clone-facts">
        <li>{t('agent.clone.parallel', { name: agent.name })}</li>
        <li>{t('agent.clone.config')}</li>
        <li>{t('agent.clone.notebook', { name: agent.name })}</li>
        <li>{t('agent.clone.notBring', { name: agent.name })}</li>
      </ul>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={!name.trim() || clash || busy} onClick={() => void go()}><Copy size={14} />{busy ? t('agent.clone.working') : t('agent.clone')}</button>
      </div>
    </Modal>
  );
}
