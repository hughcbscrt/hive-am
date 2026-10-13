import { Check, Plus, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import type { HttpSessionView } from '@/lib/types';
import { ConfirmDialog } from '@/components/ui';
import { HelpPopover } from '@/components/HelpPopover';
import type { HttpWs } from './useHttpWorkspace';

/** The values the response handlers keep (the session), with add, forget and clear. */
export function HttpSessionBlock({ ws }: { ws: HttpWs }) {
  const { t } = useI18n();
  const { kept, adding, setAdding, newName, setNewName, newValue, setNewValue, setValue, forget, setConfirm } = ws;
  return (
          <div className="hw-session-body hw-session-pad">
          <div className="row gap-s"><b>{t('hw.session')}</b><HelpPopover size="sm" label={t('common.help')} title={t('hw2.help.how')}>{t('hw.session.hint')}</HelpPopover></div>

            {kept.length === 0 && !adding && <p className="muted small res-m0">{t('hw.session.empty')}</p>}
            {kept.map(([k, v]) => (
              <div key={k} className="hw-kv"><code className="mono" title={k}>{k}</code><span className="mono val" title={v}>{v}</span>
                <button className="btn ghost icon sm" onClick={() => void forget(k)} aria-label={t('hw.session.forget')} title={t('hw.session.forget')}><X size={13} /></button></div>))}
            {adding ? (
              <div className="hw-kv-add"><input className="input mono" placeholder={t('hw.session.name')} value={newName} onChange={(e) => setNewName(e.target.value)} aria-label={t('hw.session.name')} />
                <input className="input mono" placeholder={t('hw.session.value')} value={newValue} onChange={(e) => setNewValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setValue(); }} aria-label={t('hw.session.value')} />
                <button className="btn primary icon sm" onClick={setValue} aria-label={t('hw.session.add')}><Check size={14} /></button><button className="btn ghost icon sm" onClick={() => setAdding(false)} aria-label={t('common.cancel')}><X size={14} /></button></div>
            ) : (
              <div className="row gap-s mt-s"><button className="btn sm" onClick={() => setAdding(true)}><Plus size={13} />{t('hw.session.add')}</button>
                {kept.length > 0 && <button className="btn ghost sm" onClick={() => setConfirm('session')}><Trash2 size={13} />{t('hw.session.clear')}</button>}</div>)}
          </div>
  );
}

/** Asks before clearing the history or the session (the two destructive actions of this screen). */
export function HttpConfirmDialog({ ws }: { ws: HttpWs }) {
  const { t } = useI18n();
  const { o, confirm, setConfirm, setHist, setHistSel, setSession } = ws;
  return confirm && (
    <ConfirmDialog title={t(confirm === 'history' ? 'hw2.history.clear' : 'hw.session.clear')} confirmLabel={t(confirm === 'history' ? 'hw2.history.clear' : 'hw.session.clear')} danger
      body={t(confirm === 'history' ? 'rs.confirm.history' : 'rs.confirm.session')} onClose={() => setConfirm(null)}
      onConfirm={() => (confirm === 'history' ? api.del(`/objects/${o.id}/http/history`).then(() => { setHist([]); setHistSel(null); }) : api.del<HttpSessionView>(`/objects/${o.id}/http/session`).then(setSession))} />
  );
}
