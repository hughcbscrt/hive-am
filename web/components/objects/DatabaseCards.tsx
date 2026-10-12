'use client';
import { PasswordInput } from '@/components/PasswordInput';
import { useState } from 'react';
import { CheckCircle2, ChevronRight, Database as DbIcon, Link2, Loader2, PlugZap, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { Field, PathPicker, Segmented } from '@/components/ui';
import { useI18n } from '@/lib/i18n/index';
import { useDriverProps } from '@/lib/useDriverProps';
import type { DbEngine } from '@/lib/types';
import { Card, dbConfigOf, type Draft } from './ObjectForm';
import { DriverProps } from './DriverProps';
import { parseDbUrl } from './dbUrl';

export const DB_ENGINES: Record<DbEngine, { label: string; port: number; color: string; sample: string }> = {
  mysql: { label: 'MySQL / MariaDB', port: 3306, color: '#00758f', sample: 'mysql://user:password@localhost:3306/app' },
  postgresql: { label: 'PostgreSQL', port: 5432, color: '#4a7fb5', sample: 'postgresql://user:password@localhost:5432/app?sslmode=require' },
  sqlite: { label: 'SQLite', port: 0, color: '#0f80cc', sample: 'sqlite:///home/you/app/data.db' },
  mssql: { label: 'SQL Server', port: 1433, color: '#cc2927', sample: 'mssql://sa:password@localhost:1433/master' },
};
const ENGINES = Object.keys(DB_ENGINES) as DbEngine[];
const SSL_FILES = ['ssl.ca', 'ssl.cert', 'ssl.key'] as const;
const SSL_LABEL = { 'ssl.ca': 'db.ssl.ca', 'ssl.cert': 'db.ssl.cert', 'ssl.key': 'db.ssl.key' } as const;

/** A name for the object that says what it points at, to offer while the field is empty. */
export function suggestDbName(d: Draft): string {
  const where = d.engine === 'sqlite' ? d.dbFile.split('/').pop()?.replace(/\.[^.]+$/, '') : d.dbName.trim() || d.dbHost.trim();
  return where ? `${where} · ${DB_ENGINES[d.engine].label.split(' ')[0]}` : '';
}

/** The settings of a database object: how to connect (with a test that does not need saving first), SSL, driver properties and limits. */
export function DatabaseCards({ d, set, setD, objectId, creating = false }: {
  d: Draft; set: <K extends keyof Draft>(k: K, v: Draft[K]) => void; setD: (f: (x: Draft) => Draft) => void; objectId?: string; creating?: boolean;
}) {
  const { t, locale } = useI18n();
  const cat = useDriverProps();
  const [test, setTest] = useState<{ state: 'idle' | 'busy' | 'ok' | 'err'; text?: string }>({ state: 'idle' });
  const [url, setUrl] = useState('');
  const [urlErr, setUrlErr] = useState('');
  const file = d.engine === 'sqlite';
  const text = (k: keyof Draft, o: { placeholder?: string; type?: string; mono?: boolean; auto?: string } = {}) => (
    <input className={`input ${o.mono ? 'mono' : ''}`} type={o.type} value={d[k] as string} placeholder={o.placeholder} autoComplete={o.auto ?? 'off'} onChange={(e) => set(k, e.target.value as never)} />
  );
  const pickEngine = (e: DbEngine) => { if (e === d.engine) return; setD((x) => ({ ...x, engine: e, dbProps: {}, dbSsl: false, dbTrust: false })); setTest({ state: 'idle' }); };
  const run = async () => {
    setTest({ state: 'busy' });
    try { const r = await api.post<{ version: string; ms: number }>('/object-db/test', { id: objectId, config: dbConfigOf(d) }); setTest({ state: 'ok', text: `${r.version} · ${r.ms} ms` }); }
    catch (e) { setTest({ state: 'err', text: e instanceof Error ? e.message : '' }); }
  };
  const useUrl = () => {
    const p = parseDbUrl(url, cat?.[parseDbUrl(url)?.engine ?? d.engine]);
    if (!p) { setUrlErr(t('db.url.bad')); return; }
    setUrlErr(''); setTest({ state: 'idle' });
    setD((x) => ({ ...x, engine: p.engine, dbHost: p.host, dbPort: p.port, dbUser: p.user, dbPassword: p.password, dbName: p.database, dbFile: p.file, dbSsl: p.ssl, dbTrust: p.trust, dbProps: p.props }));
    setUrl('');
  };

  const connection = (<>
    {file ? (
      <PathPicker mode="file" exts={['db', 'sqlite', 'sqlite3', 'db3']} value={d.dbFile} onChange={(v) => set('dbFile', v)} label={t('db.file')} hint={t('db.file.hint')} placeholder="/home/you/app/data.db" />
    ) : (<>
      <div className="of-grid2">
        <Field label={t('db.host')}>{text('dbHost', { placeholder: '127.0.0.1', mono: true })}</Field>
        <Field label={t('db.port')}>{text('dbPort', { placeholder: String(DB_ENGINES[d.engine].port) })}</Field>
        <Field label={t('db.user')}>{text('dbUser', { mono: true })}</Field>
        <Field label={t('db.password')} hint={d.dbPasswordSet && !d.dbPassword ? t('db.password.saved') : undefined}>
          <PasswordInput value={d.dbPassword} autoComplete="new-password" placeholder={d.dbPasswordSet ? '••••••••' : ''} onChange={(e) => set('dbPassword', e.target.value)} />
        </Field>
      </div>
      <Field label={t('db.database')} hint={t('db.database.hint')}>{text('dbName', { mono: true })}</Field>
    </>)}
    <div className="row gap-s wrap db-test">
      <button type="button" className="btn sm" onClick={() => void run()} disabled={test.state === 'busy' || (file ? !d.dbFile.trim() : false)}>
        {test.state === 'busy' ? <Loader2 size={14} className="spin" /> : <PlugZap size={14} />}{t('db.test')}
      </button>
      {test.state === 'ok' && <span className="db-ok small"><CheckCircle2 size={14} />{t('db.test.ok')} · {test.text}</span>}
      {test.state === 'err' && <span className="db-bad small"><XCircle size={14} />{test.text}</span>}
    </div>
  </>);

  const ssl = file ? null : (<>
    <label className="row gap-s small"><input type="checkbox" checked={d.dbSsl} onChange={(e) => set('dbSsl', e.target.checked)} />{t('db.ssl')}</label>
    {d.dbSsl && (<>
      <label className="row gap-s small"><input type="checkbox" checked={d.dbTrust} onChange={(e) => set('dbTrust', e.target.checked)} />{t('db.trust')}</label>
      <p className="muted small" style={{ margin: '-4px 0 0' }}>{d.dbTrust ? t('db.trust.on') : t('db.trust.off')}</p>
      {SSL_FILES.filter((k) => cat?.[d.engine].some((p) => p.name === k)).map((k) => {
        const def = cat![d.engine].find((p) => p.name === k)!;
        return <PathPicker key={k} mode="file" exts={['pem', 'crt', 'cer', 'key']} value={d.dbProps[k] ?? ''} onChange={(v) => set('dbProps', { ...d.dbProps, [k]: v })} label={t(SSL_LABEL[k])} hint={locale === 'es' ? def.es : def.desc} placeholder={def.placeholder} />;
      })}
      <DriverProps engine={d.engine} value={d.dbProps} onChange={(v) => set('dbProps', v)} groups={['ssl']} exclude={[...SSL_FILES]} quiet />
    </>)}
  </>);

  const driver = (<DriverProps engine={d.engine} value={d.dbProps} onChange={(v) => set('dbProps', v)} groups={['session', 'network', 'advanced']} />);

  const safety = (<>
    <label className="row gap-s small"><input type="checkbox" checked={d.dbReadOnly} onChange={(e) => set('dbReadOnly', e.target.checked)} />{t('db.readonly')}</label>
    <p className="muted small" style={{ margin: '-4px 0 0' }}>{d.dbReadOnly ? t('db.readonly.on') : t('db.readonly.off')}</p>
    <div className="of-grid2">
      <Field label={t('db.timeout')} hint={t('db.timeout.hint')}>{text('dbTimeout', { placeholder: '30' })}</Field>
      <Field label={t('db.maxRows')} hint={t('db.maxRows.hint')}>{text('dbMaxRows', { placeholder: '1000' })}</Field>
    </div>
  </>);

  const engines = (
    <div className="dbengines" role="group" aria-label={t('db.engine')}>
      {ENGINES.map((e) => (
        <button key={e} type="button" className="dbengine" aria-pressed={d.engine === e} style={{ ['--c' as never]: DB_ENGINES[e].color }} onClick={() => pickEngine(e)}>
          <DbIcon size={18} /><b>{DB_ENGINES[e].label}</b><small>{e === 'sqlite' ? t('db.engine.file') : t('db.engine.port', { port: DB_ENGINES[e].port })}</small>
        </button>
      ))}
    </div>
  );

  if (creating) {
    return (<>
      <Card title={t('db.engine')} hint={t('db.engine.hint')}>{engines}</Card>
      <Card title={t('db.conn')} hint={t('db.conn.hint')}>
        <Field label={t('db.url')} error={urlErr} hint={urlErr ? undefined : t('db.url.hint')}>
          <div className="row gap-s">
            <input className="input mono grow" value={url} placeholder={DB_ENGINES[d.engine].sample} autoComplete="off" spellCheck={false}
              onChange={(e) => { setUrl(e.target.value); setUrlErr(''); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); useUrl(); } }} />
            <button type="button" className="btn sm" disabled={!url.trim()} onClick={useUrl}><Link2 size={14} />{t('db.url.use')}</button>
          </div>
        </Field>
        {connection}
      </Card>
      <Card title={t('db.safety')} hint={t('db.safety.hint')}>{safety}</Card>
      <details className="of-adv">
        <summary><ChevronRight size={15} />{t('db.advanced')}<span className="muted small">{t('db.advanced.hint')}</span></summary>
        {!file && <Card title={t('db.sslTitle')} hint={t('db.sslTitle.hint')}>{ssl}</Card>}
        <Card title={t('dp.title')} hint={t('dp.hint')}>{driver}</Card>
      </details>
    </>);
  }
  return (<>
    <Card title={t('db.conn')} hint={t('db.conn.hint')}>
      <Field label={t('db.engine')}>
        <Segmented value={d.engine} onChange={pickEngine} options={ENGINES.map((e) => ({ id: e, label: DB_ENGINES[e].label }))} />
      </Field>
      {connection}
    </Card>
    {!file && <Card title={t('db.sslTitle')} hint={t('db.sslTitle.hint')}>{ssl}</Card>}
    <Card title={t('dp.title')} hint={t('dp.hint')}>{driver}</Card>
    <Card title={t('db.safety')} hint={t('db.safety.hint')}>{safety}</Card>
  </>);
}
