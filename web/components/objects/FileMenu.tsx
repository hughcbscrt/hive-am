'use client';
import { useState } from 'react';
import { FileText, MoreHorizontal, Package, Table2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { useToast } from '@/components/ui';
import { Menu, MenuCheck, MenuGroup, MenuItem, MenuSep } from '@/components/Menu';

/** What else can be done with a .http file: run it with rows of data, export it (documentation or a Postman collection), and how a whole run behaves. */
export function FileMenu({ objectId, file, onBatch, stopOnFail, onStopOnFail }: { objectId: string; file: string; onBatch: () => void; stopOnFail: boolean; onStopOnFail: (v: boolean) => void }) {
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
    <Menu label={t('svc.more')} icon={<MoreHorizontal size={14} />}>{(close) => (<>
      <MenuItem icon={<Table2 size={15} />} hint={t('hw2.batch.hint.short')} onClick={() => { close(); onBatch(); }}>{t('hw2.batch.open')}</MenuItem>
      <MenuCheck checked={stopOnFail} onChange={onStopOnFail} hint={t('hw2.stopOnFail.hint')}>{t('hw.stopOnFail')}</MenuCheck>
      <MenuSep />
      <MenuGroup label={t('hw2.export')}>
        <MenuItem icon={<FileText size={15} />} onClick={() => void go('markdown', close)}>{t('hw2.export.md')}</MenuItem>
        <MenuItem icon={<Package size={15} />} onClick={() => void go('postman', close)}>{t('hw2.export.postman')}</MenuItem>
        <MenuCheck checked={all} onChange={setAll}>{t('hw2.export.all')}</MenuCheck>
      </MenuGroup>
    </>)}</Menu>
  );
}
