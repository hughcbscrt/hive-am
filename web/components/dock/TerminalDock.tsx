'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileText, FolderOpen, Plus, SquareTerminal, X } from 'lucide-react';
import { useDock } from '@/lib/dock';
import { useI18n } from '@/lib/i18n';
import { FolderPicker, Modal } from '@/components/ui';
import { LogView } from '@/components/objects/LogView';
import { XTerm } from './XTerm';

const tabDomId = (key: string) => `dock-tab-${key}`;

/** The bottom panel: terminals and object logs in tabs, resizable by its top edge, opened with Ctrl+`. Hiding it keeps the terminals mounted, so a full screen app keeps its modes and scroll. */
export function TerminalDock() {
  const { t } = useI18n();
  const d = useDock();
  const [picking, setPicking] = useState<string | null>(null);
  const drag = useRef<{ y: number; h: number } | null>(null);

  useEffect(() => {
    const move = (e: PointerEvent) => { if (drag.current) d.setHeight(drag.current.h + (drag.current.y - e.clientY)); };
    const up = () => { drag.current = null; document.body.style.userSelect = ''; };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [d]);

  const activeKnown = d.tabs.some((x) => x.key === d.active);
  /** Arrows/Home/End move between tabs, Delete closes the focused one. */
  const tabKey = (e: React.KeyboardEvent) => {
    const keys = d.tabs.map((x) => x.key); const i = keys.indexOf(d.active ?? ''); let n: number | null = null;
    if (e.key === 'ArrowRight') n = (i + 1) % keys.length; else if (e.key === 'ArrowLeft') n = (i - 1 + keys.length) % keys.length;
    else if (e.key === 'Home') n = 0; else if (e.key === 'End') n = keys.length - 1;
    else if (e.key === 'Delete' && i >= 0) { e.preventDefault(); d.closeTab(keys[i]); return; }
    if (n === null || !keys.length) return;
    e.preventDefault(); d.setActive(keys[n]); requestAnimationFrame(() => document.getElementById(tabDomId(keys[n!]))?.focus());
  };
  const lastCwd = [...d.tabs].reverse().find((x) => x.kind === 'term')?.cwd;
  return (
    <section className="dock" style={{ height: d.height, display: d.open ? undefined : 'none' }} aria-hidden={!d.open} aria-label={t('dock.title')}>
      <div className="dock-grip" onPointerDown={(e) => { drag.current = { y: e.clientY, h: d.height }; document.body.style.userSelect = 'none'; e.preventDefault(); }} role="separator" aria-orientation="horizontal" />
      <div className="dock-bar">
        <div className="dock-tabs" role="tablist" aria-label={t('dock.title')} onKeyDown={tabKey}>
          {d.tabs.map((x) => {
            const on = d.active === x.key; const id = tabDomId(x.key);
            // The close button is a sibling of the tab, not inside it: a button must not contain another control.
            return (
              <div key={x.key} className={`dock-tabwrap ${on ? 'on' : ''}`}>
                <button id={id} type="button" role="tab" aria-selected={on} aria-controls={`${id}-panel`} tabIndex={on || (!activeKnown && x === d.tabs[0]) ? 0 : -1} className="dock-tab-btn" onClick={() => d.setActive(x.key)} title={x.kind === 'term' ? x.cwd : t('obj.logs')}>
                  {x.kind === 'term' ? <SquareTerminal size={14} /> : <FileText size={14} />}
                  <span className="nm">{x.title}</span>
                  {x.kind === 'term' && x.ended !== undefined && <i className="odot off" title={t('dock.ended', { code: x.ended ?? '' })} />}
                </button>
                <button type="button" className="dock-x" tabIndex={-1} onClick={() => d.closeTab(x.key)} aria-label={`${t('common.close')}: ${x.title}`}><X size={12} /></button>
              </div>
            );
          })}
        </div>
        {d.enabled && <button className="btn ghost icon sm" onClick={() => void d.openTerminal(lastCwd ? { cwd: lastCwd } : {})} aria-label={t('dock.new')} title={t('dock.new')}><Plus size={15} /></button>}
        {d.enabled && <button className="btn ghost icon sm" onClick={() => setPicking(lastCwd ?? '')} aria-label={t('dock.inFolder')} title={t('dock.inFolder')}><FolderOpen size={15} /></button>}
        <span className="grow" />
        <button className="btn ghost icon sm" onClick={() => d.setOpen(false)} aria-label={t('dock.hide')} title={`${t('dock.hide')} (Ctrl+\`)`}><ChevronDown size={15} /></button>
      </div>
      <div className="dock-body">
        {d.error && <p className="gx-note err gx-hint-row" role="alert">{d.error}</p>}
        {!d.enabled && !d.tabs.length && <p className="gx-note">{t('dock.disabled')}</p>}
        {d.enabled && !d.tabs.length && !d.error && <p className="gx-note">{t('dock.empty')}</p>}
        {d.tabs.map((x) => (
          <div key={x.key} id={`${tabDomId(x.key)}-panel`} role="tabpanel" aria-labelledby={tabDomId(x.key)} className="dock-pane" hidden={d.active !== x.key}>
            {x.kind === 'term' ? <XTerm id={x.id} visible={d.open && d.active === x.key} onEnded={(code) => d.markEnded(x.key, code)} /> : d.open && <div className="dock-logpane"><LogView id={x.objectId} height="100%" /></div>}
          </div>
        ))}
      </div>
      {picking !== null && (
        <Modal title={t('dock.inFolder')} onClose={() => setPicking(null)}>
          <FolderPicker value={picking} onChange={setPicking} label={t('obj.f.folder')} hint={t('dock.folder.hint')} />
          <div className="row confirm-actions">
            <button className="btn ghost" onClick={() => setPicking(null)}>{t('common.cancel')}</button>
            <button className="btn primary" disabled={!picking.startsWith('/')} onClick={() => { const cwd = picking; setPicking(null); void d.openTerminal({ cwd }); }}>{t('dock.open')}</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
