'use client';
import { useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { AgentSwitcher } from '@/components/agents/AgentSwitcher';
import { usePersistentState } from '@/lib/hooks/usePersistentState';

/**
 * An agent's chat (/agents/<id>) sits next to the side agent list. The list lives here, above the [id] segment, because the page
 * is mounted again for every agent: here it stays mounted, so it keeps its scroll and its search text when another agent is picked.
 * The agents screen (/agents) renders on its own.
 */
export default function AgentsLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id?: string }>();
  const [swCollapsedN, setSwCollapsed] = usePersistentState<number>('hive-switcher-collapsed', 0);
  const swCollapsed = swCollapsedN === 1;
  // The width only animates when the person flips it, never while the saved choice is applied on arrival.
  const [swAnimate, setSwAnimate] = useState(false);
  const toggleSwitcher = () => { setSwAnimate(true); setSwCollapsed(swCollapsed ? 0 : 1); };
  if (!id) return <>{children}</>;
  return (
    <div className={`ws ${swCollapsed ? 'sw-collapsed' : ''} ${swAnimate ? 'sw-anim' : ''}`}>
      <AgentSwitcher activeId={id} collapsed={swCollapsed} onToggle={toggleSwitcher} />
      {children}
    </div>
  );
}
