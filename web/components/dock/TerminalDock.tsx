'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileText, FolderOpen, Plus, SquareTerminal, X } from 'lucide-react';
import { useDock } from '@/lib/dock';
import { useI18n } from '@/lib/i18n';
import { FolderPicker, Modal } from '@/components/ui';
import { LogView } from '@/components/objects/LogView';
import { XTerm } from './XTerm';

/** The bottom panel: terminals and object logs in tabs, resizable by its top edge, opened with Ctrl+`. */
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

  if (!d.open) return null;
  const lastCwd = [...d.tabs].reverse().find((x) => x.kind === 'term')?.cwd;
  return (
    <section className="dock" style={{ height: d.height }} aria-label={t('dock.title')}>
      <div className="dock-grip" onPointerDown={(e) => { drag.current = { y: e.clientY, h: d.height }; document.body.style.userSelect = 'none'; e.preventDefault(); }} role="separator" aria-orientation="horizontal" />
      <div className="dock-bar">
        <div className="dock-tabs" role="tablist">
          {d.tabs.map((x) => (
            <div key={x.key} role="tab" aria-selected={d.active === x.key} className={`dock-tab ${d.active === x.key ? 'on' : ''}`} onClick={() => d.setActive(x.key)} title={x.kind === 'term' ? x.cwd : t('obj.logs')}>
              {x.kind === 'term' ? <SquareTerminal size={14} /> : <FileText size={14} />}
              <span className="nm">{x.title}</span>
              {x.kind === 'term' && x.ended !== undefined && <i className="odot off" title={t('dock.ended', { code: x.ended ?? '' })} />}
              <button className="dock-x" onClick={(e) => { e.stopPropagation(); d.closeTab(x.key); }} aria-label={t('common.close')}><X size={12} /></button>
            </div>
          ))}
        </div>
        {d.enabled && <button className="btn ghost icon sm" onClick={() => void d.openTerminal(lastCwd ? { cwd: lastCwd } : {})} aria-label={t('dock.new')} title={t('dock.new')}><Plus size={16} /></button>}
        {d.enabled && <button className="btn ghost icon sm" onClick={() => setPicking(lastCwd ?? '')} aria-label={t('dock.inFolder')} title={t('dock.inFolder')}><FolderOpen size={15} /></button>}
        <span className="grow" />
        <button className="btn ghost icon sm" onClick={() => d.setOpen(false)} aria-label={t('dock.hide')} title={`${t('dock.hide')} (Ctrl+\`)`}><ChevronDown size={16} /></button>
      </div>
      <div className="dock-body">
        {d.error && <p className="gx-note err" style={{ margin: 0, padding: '10px 14px' }}>{d.error}</p>}
        {!d.enabled && !d.tabs.length && <p className="gx-note">{t('dock.disabled')}</p>}
        {d.enabled && !d.tabs.length && !d.error && <p className="gx-note">{t('dock.empty')}</p>}
        {d.tabs.map((x) => (
          <div key={x.key} className="dock-pane" hidden={d.active !== x.key}>
            {x.kind === 'term' ? <XTerm id={x.id} visible={d.active === x.key} onEnded={(code) => d.markEnded(x.key, code)} /> : <div style={{ padding: 8, height: '100%' }}><LogView id={x.objectId} height="100%" /></div>}
          </div>
        ))}
      </div>
      {picking !== null && (
        <Modal title={t('dock.inFolder')} onClose={() => setPicking(null)}>
          <FolderPicker value={picking} onChange={setPicking} label={t('obj.f.folder')} hint={t('dock.folder.hint')} />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={() => setPicking(null)}>{t('common.cancel')}</button>
            <button className="btn primary" disabled={!picking.startsWith('/')} onClick={() => { const cwd = picking; setPicking(null); void d.openTerminal({ cwd }); }}>{t('dock.open')}</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
