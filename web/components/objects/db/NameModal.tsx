'use client';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n/index';
import { Modal } from '@/components/ui';

export function NameModal({ onClose, onSave, title, initial = '' }: { onClose: () => void; onSave: (n: string) => void; title?: string; initial?: string }) {
  const { t } = useI18n();
  const [name, setName] = useState(initial);
  return (
    <Modal title={title ?? t('db.save')} onClose={onClose}>
      <div className="field"><label>{t('db.saved.name')}</label><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onSave(name.trim()); }} /></div>
      <div className="row res-end"><button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>{title ? t('common.saveChanges') : t('db.save')}</button></div>
    </Modal>
  );
}
