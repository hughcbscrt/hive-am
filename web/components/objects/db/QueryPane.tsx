'use client';
import type { MutableRefObject } from 'react';
import { AlignLeft, BookMarked, Pencil, Loader2, Play, Save, Lock, Unlock } from 'lucide-react';
import { useI18n } from '@/lib/i18n/index';
import { useGitPrefs } from '@/lib/git/gitPrefs';
import type { DatabaseConfig, DbResult, DbSaved, DbSchema, ObjectView } from '@/lib/types';
import { SqlEditor } from '../SqlEditor';
import type { SqlCtx } from '@/lib/sql';
import { GitSettings } from '@/components/git/GitSettings';
import { HelpPopover } from '@/components/HelpPopover';
import { Menu, MenuGroup, MenuItem, MenuSep } from '@/components/Menu';
import { Results } from './Results';

function ReadOnlyBadge({ cfg }: { cfg: DatabaseConfig }) {
  const { t } = useI18n();
  return cfg.readOnly !== false
    ? <span className="db-badge ro" title={t('db.readonly.on')}><Lock size={12} />{t('db.readonly.badge')}</span>
    : <span className="db-badge rw" title={t('db.readonly.off')}><Unlock size={12} />{t('db.write.badge')}</span>;
}

export function QueryPane({ o, sql, setSql, area, run, format, ctx, busy, result, error, schema, database, setDatabase, saved, onSave, onUse, onManage }: {
  o: ObjectView; sql: string; setSql: (v: string) => void; area: MutableRefObject<HTMLTextAreaElement | null>; run: () => void; format: () => void; ctx: SqlCtx; busy: boolean; result: DbResult | null; error: string;
  schema: DbSchema | null; database?: string; setDatabase: (d: string | undefined) => void; saved: DbSaved[]; onSave: () => void; onUse: (q: string, db?: string) => void; onManage: () => void;
}) {
  const { t } = useI18n();
  const prefs = useGitPrefs();
  const cfg = o.config as DatabaseConfig;
  const dbs = schema?.databases ?? [];
  return (
    <div className="dbq">
      <div className="dbq-bar">
        <button className="btn primary sm" disabled={busy || !sql.trim()} onClick={run} title="Ctrl/⌘ + Enter">{busy ? <Loader2 size={14} className="spin" /> : <Play size={14} />}{busy ? t('db.running') : t('db.run')}</button>
        <button className="btn sm" disabled={!sql.trim()} onClick={onSave}><Save size={14} />{t('db.save')}</button>
        <button className="btn sm" disabled={!sql.trim()} onClick={format} title={t('db.format.hint')}><AlignLeft size={14} />{t('db.format')}</button>
        <Menu label={t('db.saved')} icon={<BookMarked size={14} />}>{(close) => (<>
          {saved.length === 0 ? <p className="muted small db-menu-none">{t('db.saved.none')}</p>
            : <MenuGroup label={t('db.saved.title')}>{saved.map((s) => <MenuItem key={s.id} hint={s.sql.replace(/\s+/g, ' ').slice(0, 70)} onClick={() => { close(); onUse(s.sql, s.database); }}>{s.name}</MenuItem>)}</MenuGroup>}
          <MenuSep /><MenuItem icon={<Pencil size={14} />} onClick={() => { close(); onManage(); }}>{t('db.saved.manage')}</MenuItem>
        </>)}</Menu>
        {dbs.length > 1 && (
          <select className="select db-pick" value={database ?? schema?.database ?? ''} onChange={(e) => setDatabase(e.target.value)} aria-label={t('db.database.pick')} title={t('db.database.pick')}>
            {dbs.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        <span className="grow" />
        <ReadOnlyBadge cfg={cfg} />
        <HelpPopover size="sm" align="end" label={t('common.help')} title={t('db.help.title')}><p>{t('db.help.1')}</p><p>{t('db.help.2')}</p><p>{t('db.help.3')}</p><p>{t('db.help.4')}</p></HelpPopover>
        <GitSettings compact />
      </div>
      <div className="db-ed gx" data-hotkeys="own" data-gx-theme={prefs.theme} style={{ ['--g-tab' as never]: prefs.tabSize }}>
        <SqlEditor value={sql} onChange={setSql} areaRef={area} ctx={ctx} label={t('db.editor')}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); } else if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); format(); } }} />
      </div>
      <div className="dbq-res">
        {busy && !result && !error ? <p className="muted small db-note"><Loader2 size={14} className="spin" /> {t('db.running')}</p>
          : error ? <div className="gx-note err db-err">{error}</div>
          : result ? <Results result={result} /> : <p className="muted small db-note">{t('db.result.none')}</p>}
      </div>
    </div>
  );
}
