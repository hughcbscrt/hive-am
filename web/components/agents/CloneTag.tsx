'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { Copy } from 'lucide-react';
import { useHiveSelector } from '@/lib/store';
import { useI18n } from '@/lib/i18n/index';
import type { Agent } from '@/lib/types';

/** Who an agent was cloned from, and who was cloned from it. */
export function useCloneInfo(a: Pick<Agent, 'id' | 'cloned_from'>) {
  const agents = useHiveSelector((s) => s.agents);
  return useMemo(() => ({
    of: a.cloned_from ? agents.find((x) => x.id === a.cloned_from) : undefined,
    clones: agents.filter((x) => x.cloned_from === a.id),
  }), [agents, a.id, a.cloned_from]);
}

/** "⧉ Maggie": this agent is a clone of Maggie. Nothing for an agent that is not a clone. `link` makes it a link to the source (not inside something that is a link already). */
export function CloneChip({ agent, link = false, className = '' }: { agent: Pick<Agent, 'id' | 'cloned_from'>; link?: boolean; className?: string }) {
  const { t } = useI18n();
  const { of } = useCloneInfo(agent);
  if (!of) return null;
  const inner = <><Copy size={11} aria-hidden />{of.name}</>;
  const title = t('agent.cloneOf', { name: of.name });
  return link
    ? <Link className={`chip clone ${className}`} href={`/agents/${of.id}`} title={title} onClick={(e) => e.stopPropagation()}>{inner}</Link>
    : <span className={`chip clone ${className}`} title={title}>{inner}</span>;
}

/** "2 clones": other agents were cloned from this one. */
export function ClonesChip({ agent }: { agent: Pick<Agent, 'id' | 'cloned_from'> }) {
  const { t } = useI18n();
  const { clones } = useCloneInfo(agent);
  if (!clones.length) return null;
  return <span className="chip clone" title={t('agent.clonesList', { names: clones.map((c) => c.name).join(', ') })}><Copy size={11} aria-hidden />{t('agent.clones.count', { count: clones.length })}</span>;
}
