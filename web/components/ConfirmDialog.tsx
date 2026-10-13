'use client';
import { useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Modal } from './Dialog';
import { useToast } from './Toast';

/**
 * Asks before doing something. `onConfirm` may be async: while it runs the buttons are disabled, if it throws the error shows as a toast and the
 * dialog stays open (nothing is lost), and when it finishes the dialog closes through `onClose`. With `danger` the focus starts on Cancel.
 */
export function ConfirmDialog({ title, body, children, confirmLabel, cancelLabel, danger = false, onConfirm, onClose }: {
  title: string; body?: ReactNode; children?: ReactNode; confirmLabel: string; cancelLabel?: string; danger?: boolean;
  onConfirm: () => Promise<unknown> | unknown; onClose: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try { await onConfirm(); } catch (e) { toast(e instanceof Error ? e.message : String(e), 'err'); setBusy(false); return; }
    onClose();
  };
  return (
    <Modal title={title} onClose={() => { if (!busy) onClose(); }}>
      {body && <p className="confirm-body">{body}</p>}
      {children}
      <div className="row confirm-actions">
        <button type="button" className="btn" data-autofocus={danger ? '' : undefined} disabled={busy} onClick={onClose}>{cancelLabel ?? t('common.cancel')}</button>
        <button type="button" className={`btn ${danger ? 'danger' : 'primary'}`} data-autofocus={danger ? undefined : ''} disabled={busy} aria-busy={busy} onClick={run}>
          {busy && <Loader2 size={14} className="spin" aria-hidden />}{confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
