'use client';
import { useState } from 'react';
import { CheckCircle2, Loader2, PlugZap, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { Field, PathPicker, Segmented } from '@/components/ui';
import { useI18n } from '@/lib/i18n/index';
import type { DbEngine } from '@/lib/types';
import { Card, dbConfigOf, type Draft } from './ObjectForm';

export const DB_ENGINES: Record<DbEngine, { label: string; port: number; hint: string }> = {
  mysql: { label: 'MySQL / MariaDB', port: 3306, hint: 'MySQL or MariaDB' },
  postgresql: { label: 'PostgreSQL', port: 5432, hint: 'PostgreSQL' },
  sqlite: { label: 'SQLite', port: 0, hint: 'SQLite' },
  mssql: { label: 'SQL Server', port: 1433, hint: 'SQL Server' },
};

/** The settings of a database object: how to connect (with a test that does not need saving first), and how much it may do. */
export function DatabaseCards({ d, set, objectId }: { d: Draft; set: <K extends keyof Draft>(k: K, v: Draft[K]) => void; objectId?: string }) {
  const { t } = useI18n();
  const [test, setTest] = useState<{ state: 'idle' | 'busy' | 'ok' | 'err'; text?: string }>({ state: 'idle' });
  const file = d.engine === 'sqlite';
  const text = (k: keyof Draft, o: { placeholder?: string; type?: string; mono?: boolean; auto?: string } = {}) => (
    <input className={`input ${o.mono ? 'mono' : ''}`} type={o.type} value={d[k] as string} placeholder={o.placeholder} autoComplete={o.auto ?? 'off'} onChange={(e) => set(k, e.target.value as never)} />
  );
  const run = async () => {
    setTest({ state: 'busy' });
    try { const r = await api.post<{ version: string; ms: number }>('/object-db/test', { id: objectId, config: dbConfigOf(d) }); setTest({ state: 'ok', text: `${r.version} · ${r.ms} ms` }); }
    catch (e) { setTest({ state: 'err', text: e instanceof Error ? e.message : '' }); }
  };
  return (<>
    <Card title={t('db.conn')} hint={t('db.conn.hint')}>
      <Field label={t('db.engine')}>
        <Segmented value={d.engine} onChange={(v) => { set('engine', v); setTest({ state: 'idle' }); }} options={(Object.keys(DB_ENGINES) as DbEngine[]).map((e) => ({ id: e, label: DB_ENGINES[e].label }))} />
      </Field>
      {file ? (
        <PathPicker mode="file" exts={['db', 'sqlite', 'sqlite3', 'db3']} value={d.dbFile} onChange={(v) => set('dbFile', v)} label={t('db.file')} hint={t('db.file.hint')} placeholder="/home/you/app/data.db" />
      ) : (<>
        <div className="of-grid2">
          <Field label={t('db.host')}>{text('dbHost', { placeholder: '127.0.0.1', mono: true })}</Field>
          <Field label={t('db.port')}>{text('dbPort', { placeholder: String(DB_ENGINES[d.engine].port) })}</Field>
          <Field label={t('db.user')}>{text('dbUser', { mono: true })}</Field>
          <Field label={t('db.password')} hint={d.dbPasswordSet && !d.dbPassword ? t('db.password.saved') : undefined}>
            <input className="input mono" type="password" value={d.dbPassword} autoComplete="new-password" placeholder={d.dbPasswordSet ? '••••••••' : ''} onChange={(e) => set('dbPassword', e.target.value)} />
          </Field>
        </div>
        <Field label={t('db.database')} hint={t('db.database.hint')}>{text('dbName', { mono: true })}</Field>
        <label className="row gap-s small"><input type="checkbox" checked={d.dbSsl} onChange={(e) => set('dbSsl', e.target.checked)} />{t('db.ssl')}</label>
        {d.dbSsl && <label className="row gap-s small"><input type="checkbox" checked={d.dbTrust} onChange={(e) => set('dbTrust', e.target.checked)} />{t('db.trust')}</label>}
      </>)}
      <div className="row gap-s wrap db-test">
        <button type="button" className="btn sm" onClick={() => void run()} disabled={test.state === 'busy' || (file ? !d.dbFile.trim() : false)}>
          {test.state === 'busy' ? <Loader2 size={14} className="spin" /> : <PlugZap size={14} />}{t('db.test')}
        </button>
        {test.state === 'ok' && <span className="db-ok small"><CheckCircle2 size={14} />{t('db.test.ok')} · {test.text}</span>}
        {test.state === 'err' && <span className="db-bad small"><XCircle size={14} />{test.text}</span>}
      </div>
    </Card>
    <Card title={t('db.safety')} hint={t('db.safety.hint')}>
      <label className="row gap-s small"><input type="checkbox" checked={d.dbReadOnly} onChange={(e) => set('dbReadOnly', e.target.checked)} />{t('db.readonly')}</label>
      <p className="muted small" style={{ margin: '-4px 0 0' }}>{d.dbReadOnly ? t('db.readonly.on') : t('db.readonly.off')}</p>
      <div className="of-grid2">
        <Field label={t('db.timeout')} hint={t('db.timeout.hint')}>{text('dbTimeout', { placeholder: '30' })}</Field>
        <Field label={t('db.maxRows')} hint={t('db.maxRows.hint')}>{text('dbMaxRows', { placeholder: '1000' })}</Field>
      </div>
    </Card>
  </>);
}
