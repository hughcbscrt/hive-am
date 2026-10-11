'use client';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { useToast } from '@/components/ui';
import { Menu, MenuItem } from '@/components/Menu';

/** Documentation (Markdown) or a Postman collection of one .http file or of all of them, downloaded as a file. */
export function ExportMenu({ objectId, file }: { objectId: string; file: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [all, setAll] = useState(false);
  const go = async (format: 'markdown' | 'postman', close: () => void) => {
    try {
      const r = await api.get<{ filename: string; mime: string; content: string }>(`/objects/${objectId}/http/docs?format=${format}${all ? '' : `&file=${encodeURIComponent(file)}`}`);
      const url = URL.createObjectURL(new Blob([r.content], { type: r.mime }));
      const a = document.createElement('a'); a.href = url; a.download = r.filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      close(); toast(t('hw2.export.done', { name: r.filename }));
    } catch (e) { toast(e instanceof Error ? e.message : 'error'); }
  };
  return (
    <Menu label={t('hw2.export')} icon={<Download size={14} />}>{(close) => (<>
      <MenuItem onClick={() => void go('markdown', close)}>{t('hw2.export.md')}</MenuItem>
      <MenuItem onClick={() => void go('postman', close)}>{t('hw2.export.postman')}</MenuItem>
      <label className="menu-opt small"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />{t('hw2.export.all')}</label>
    </>)}</Menu>
  );
}
