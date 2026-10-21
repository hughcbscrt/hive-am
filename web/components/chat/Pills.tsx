'use client';
import type { ReactNode } from 'react';
import { Brain, ChevronRight } from 'lucide-react';
import { fmtDur } from '@/lib/format';
import { useI18n } from '@/lib/i18n/index';
import { summarize } from '@/lib/chat/pills';
import type { Block } from '@/lib/types';
import { describe, toolExit, toolFailed, ToolDetail, useTick } from './ToolCall';

type Tool = Extract<Block, { type: 'tool' }>;

/** Which pills of a reply are open, and the id prefix that ties each pill to its detail. */
export interface PillState { isOpen: (i: number) => boolean; toggle: (i: number) => void; ids: string }

function Pill({ id, open, onToggle, icon, label, meta, tip, cls = '' }: { id: string; open: boolean; onToggle: () => void; icon: ReactNode; label: string; meta?: ReactNode; tip: string; cls?: string }) {
  return (
    <button type="button" className={`pill ${cls}`} aria-expanded={open} aria-controls={open ? id : undefined} title={tip} onClick={onToggle}>
      <span className="pico">{icon}</span><span className="plabel">{label}</span>{meta && <span className="pmeta">{meta}</span>}
    </button>
  );
}

function ToolPill({ tool, streaming, id, open, onToggle }: { tool: Tool; streaming?: boolean; id: string; open: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const d = describe(tool);
  const running = tool.output === undefined && !!streaming;
  useTick(running);
  const dur = tool.durationMs ?? (running && tool.startedAt ? Date.now() - tool.startedAt : undefined);
  const exit = toolExit(tool, d);
  const bad = exit !== undefined && exit !== '0';
  const meta = (bad || tool.error || dur !== undefined || running) ? (<>
    {bad && <span className="tbad">{t('tool.exit', { code: exit })}</span>}
    {tool.error && exit === undefined && <span className="tbad">{t('tool.failed')}</span>}
    {dur !== undefined && <span className={running ? 'live' : ''}>{fmtDur(dur)}</span>}
    {running && <i className="dot run" />}
  </>) : null;
  return <Pill id={id} open={open} onToggle={onToggle} icon={d.icon} label={d.pill} tip={d.tip} meta={meta} cls={`${bad || tool.error ? 'err' : ''} ${running ? 'running' : ''}`} />;
}

/** One pill per step (reasoning or tool call) of a run. */
export function StepPills({ blocks, idx, streaming, st }: { blocks: Block[]; idx: number[]; streaming?: boolean; st: PillState }) {
  const { t } = useI18n();
  return (
    <>
      {idx.map((i) => {
        const b = blocks[i];
        if (b.type === 'text') return null;
        if (b.type === 'thinking') {
          const live = !!streaming && i === blocks.length - 1;
          return <Pill key={i} id={`${st.ids}-${i}`} open={st.isOpen(i)} onToggle={() => st.toggle(i)} icon={<Brain size={13} />} label={live ? t('activity.thinking') : t('chat.thoughtShort')} tip={t('chat.thought')} meta={live ? <i className="dot run" /> : null} cls="think" />;
        }
        return <ToolPill key={i} tool={b} streaming={streaming} id={`${st.ids}-${i}`} open={st.isOpen(i)} onToggle={() => st.toggle(i)} />;
      })}
    </>
  );
}

/** The details of the open pills of a run, full width under the row, in step order. */
export function StepPanels({ blocks, idx, st }: { blocks: Block[]; idx: number[]; st: PillState }) {
  const { t } = useI18n();
  return (
    <>
      {idx.filter((i) => st.isOpen(i)).map((i) => {
        const b = blocks[i];
        if (b.type === 'text') return null;
        if (b.type === 'thinking') return <div key={i} id={`${st.ids}-${i}`} role="region" aria-label={t('chat.thought')} className="pill-detail think"><pre>{b.text}</pre></div>;
        const d = describe(b);
        return <div key={i} id={`${st.ids}-${i}`} role="region" aria-label={d.pill} className="pill-detail"><ToolDetail tool={b} body={d.body} /></div>;
      })}
    </>
  );
}

/** A folded reply: how many steps and tools it had, how long it took and how many failed. Clicking shows or hides its pills. */
export function SummaryPill({ blocks, durationMs, open, onToggle }: { blocks: Block[]; durationMs?: number; open: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const s = summarize(blocks, durationMs, (b) => toolFailed(b));
  if (!s.steps) return null;
  const text = [t('chat.steps', { count: s.steps }), s.tools ? t('chat.tools', { count: s.tools }) : '', s.durationMs ? fmtDur(s.durationMs) : ''].filter(Boolean).join(' · ');
  const failed = s.failed ? t('chat.foldFailed', { count: s.failed }) : '';
  return (
    <button type="button" className={`pill sum ${failed ? 'err' : ''}`} aria-expanded={open} aria-label={`${t('chat.foldShow')}: ${[text, failed].filter(Boolean).join(' · ')}`} title={t('chat.foldShow')} onClick={onToggle}>
      <span className="pico"><ChevronRight size={13} className="chev" /></span><span className="plabel">{text}</span>{failed && <span className="pmeta"><span className="tbad">{failed}</span></span>}
    </button>
  );
}
