'use client';
import { SquareTerminal } from 'lucide-react';
import { useDock, type TerminalSpec } from '@/lib/dock';
import { useI18n } from '@/lib/i18n/index';

/** Opens a terminal in the bottom panel for an agent, a server or a container. Same look as the buttons around it: icon and text. */
export function TerminalButton({ spec, label, title }: { spec: TerminalSpec; /** Text of the button (default: "Terminal"). */ label?: string; /** What it will do, as a tooltip. */ title?: string }) {
  const { t } = useI18n();
  const dock = useDock();
  return <button className="btn sm" onClick={() => void dock.openTerminal(spec)} title={title}><SquareTerminal size={14} />{label ?? t('dock.nav')}</button>;
}
