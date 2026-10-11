'use client';
import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { useToast } from '@/components/ui';

/** Documentation (Markdown) or a Postman collection of one .http file or of all of them, downloaded as a file. */
export function ExportMenu({ objectId, file }: { objectId: string; file: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const go = async (format: 'markdown' | 'postman') => {
    try {
      const r = await api.get<{ filename: string; mime: string; content: string }>(`/objects/${objectId}/http/docs?format=${format}${all ? '' : `&file=${encodeURIComponent(file)}`}`);
      const url = URL.createObjectURL(new Blob([r.content], { type: r.mime }));
      const a = document.createElement('a'); a.href = url; a.download = r.filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setOpen(false); toast(t('hw2.export.done', { name: r.filename }));
    } catch (e) { toast(e instanceof Error ? e.message : 'error'); }
  };
  return (
    <div className="copyas" ref={box}>
      <button className="btn sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu"><Download size={14} />{t('hw2.export')}</button>
      {open && (
        <div className="copyas-menu" role="menu">
          <button role="menuitem" className="copyas-item" onClick={() => void go('markdown')}>{t('hw2.export.md')}</button>
          <button role="menuitem" className="copyas-item" onClick={() => void go('postman')}>{t('hw2.export.postman')}</button>
          <label className="copyas-opt small"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />{t('hw2.export.all')}</label>
        </div>)}
    </div>
  );
}
