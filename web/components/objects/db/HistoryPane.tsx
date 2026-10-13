'use client';
import { useState } from 'react';
import { Pencil, Save, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { ago } from '@/lib/meta';
import { useI18n } from '@/lib/i18n/index';
import type { DbHistoryEntry, DbSaved, ObjectView } from '@/lib/types';
import { ConfirmDialog, useToast } from '@/components/ui';
import { NameModal } from './NameModal';

export function HistoryPane({ o, hist, saved, sql, database, onUse, onChanged }: { o: ObjectView; hist: DbHistoryEntry[] | null; saved: DbSaved[]; sql: string; database?: string; onUse: (q: string, db?: string) => void; onChanged: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [renaming, setRenaming] = useState<DbSaved | null>(null);
  const [confirm, setConfirm] = useState<DbSaved | null>(null);
  const fail = (e: unknown) => toast(e instanceof Error ? e.message : '', 'err');
  const clear = async () => { try { await api.del(`/objects/${o.id}/db/history`); onChanged(); } catch (e) { fail(e); } };
  const drop = async (id: string) => { await api.del(`/objects/${o.id}/db/saved/${id}`); onChanged(); };
  const patch = async (id: string, body: { name?: string; sql?: string; database?: string }, done?: string) => { try { await api.patch(`/objects/${o.id}/db/saved/${id}`, body); if (done) toast(done); onChanged(); } catch (e) { fail(e); } };
  return (
    <div className="dbh">
      <section>
        <div className="row gap-s"><h3 className="grow">{t('db.saved.title')}</h3></div>
        {saved.length === 0 ? <p className="muted small">{t('db.saved.none')}</p> : saved.map((s) => (
          <div key={s.id} className="dbh-row">
            <button className="dbh-main" onClick={() => onUse(s.sql, s.database)} title={t('db.saved.use')}><b>{s.name}</b><code className="mono" title={s.sql}>{s.sql.trim().slice(0, 600)}</code></button>
            <button className="btn ghost icon sm" onClick={() => setRenaming(s)} aria-label={t('db.saved.rename')} title={t('db.saved.rename')}><Pencil size={14} /></button>
            <button className="btn ghost icon sm" disabled={!sql.trim() || sql === s.sql} onClick={() => void patch(s.id, { sql, database: database ?? '' }, t('db.saved.updated'))} aria-label={t('db.saved.replace')} title={t('db.saved.replace')}><Save size={14} /></button>
            <button className="btn ghost icon sm" onClick={() => setConfirm(s)} aria-label={t('db.delete')} title={t('db.delete')}><Trash2 size={14} /></button>
          </div>))}
      </section>
      <section>
        <div className="row gap-s"><h3 className="grow">{t('db.hist.title')}</h3>{hist && hist.length > 0 && <button className="btn ghost sm" onClick={() => void clear()}><Trash2 size={14} />{t('db.hist.clear')}</button>}</div>
        {hist === null ? <p className="muted small">{t('git.loading')}</p> : hist.length === 0 ? <p className="muted small">{t('db.hist.empty')}</p> : hist.map((h) => (
          <div key={h.n} className="dbh-row">
            <button className="dbh-main" onClick={() => onUse(h.sql, h.database)} title={h.error}>
              <span className="row gap-s small"><i className={`dot ${h.ok ? 'ok' : 'err'}`} /><span className="muted">{ago(h.at)}</span>{h.ok ? <span className="muted">· {h.rows !== undefined ? t('db.result.rows', { count: h.rows }) : t('db.result.affected', { count: h.affected ?? 0 })} · {h.ms} ms</span> : <span className="db-bad">{h.error}</span>}</span>
              <code className="mono" title={h.error ? undefined : h.sql}>{h.sql.trim().slice(0, 600)}</code>
            </button>
          </div>))}
      </section>
      {renaming && <NameModal title={t('db.saved.rename')} initial={renaming.name} onClose={() => setRenaming(null)} onSave={(n) => { const r = renaming; setRenaming(null); void patch(r.id, { name: n }, t('db.saved.updated')); }} />}
      {confirm && <ConfirmDialog title={t('db.saved.delete.title', { name: confirm.name })} body={t('db.saved.delete.body')} confirmLabel={t('db.delete')} danger onConfirm={() => drop(confirm.id)} onClose={() => setConfirm(null)} />}
    </div>
  );
}
