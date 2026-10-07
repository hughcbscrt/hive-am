'use client';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Plus, Trash2, X } from 'lucide-react';
import { useHive } from '@/lib/store';
import { api } from '@/lib/api';
import { ago } from '@/lib/meta';
import { useI18n } from '@/lib/i18n';
import type { AllowedUser, Connection, ConnectionThread } from '@/lib/types';
import { Drawer, Field, Hex, Modal, Segmented, useToast } from './ui';

type Silent = 'notice' | 'send_text' | 'ignore';

/** Create or edit a connection: which agent answers, who may talk to it, and the platform credentials. */
export function ConnectionDrawer({ connection, onClose }: { connection?: Connection; onClose: () => void }) {
  const { t } = useI18n();
  const { agents, refresh } = useHive();
  const toast = useToast();
  const editing = !!connection;

  const [name, setName] = useState(connection?.name ?? '');
  const [agentId, setAgentId] = useState(connection?.agent_id ?? '');
  const [token, setToken] = useState('');
  const [allowed, setAllowed] = useState<AllowedUser[]>(connection?.allowed ?? []);
  const [lang, setLang] = useState<'es' | 'en'>(connection?.config.lang === 'en' ? 'en' : 'es');
  const [silent, setSilent] = useState<Silent>(connection?.config.on_silent ?? 'notice');
  const [enabled, setEnabled] = useState(connection?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [errs, setErrs] = useState<{ name?: string; agent?: string; token?: string }>({});
  const [threads, setThreads] = useState<ConnectionThread[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const agent = agents.find((a) => a.id === agentId);
  const perm = agent?.effective.permission;
  const tokenHint = connection?.config.token?.set ? connection.config.token.hint : '';

  useEffect(() => { if (connection) api.get<ConnectionThread[]>(`/connections/${connection.id}/threads`).then(setThreads).catch(() => undefined); }, [connection]);

  const eligible = useMemo(() => [...agents].sort((a, b) => a.name.localeCompare(b.name)), [agents]);
  const setUser = (i: number, p: Partial<AllowedUser>) => setAllowed((l) => l.map((u, j) => (j === i ? { ...u, ...p } : u)));

  /** Reading is not enough to reply, so raise the agent to "Edit files" (and stop following its colony's setting if it did). */
  const allowEditing = async () => {
    if (!agent) return;
    try {
      const overrides = agent.effective.inherited.includes('permission') ? [...new Set([...agent.overrides, 'permission'])] : agent.overrides;
      await api.patch(`/agents/${agent.id}`, { permission: 'acceptEdits', overrides });
      await refresh(['agents']);
      toast(t('conn.perm.fixed', { name: agent.name }));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const save = async () => {
    const e: typeof errs = {};
    if (!name.trim()) e.name = t('conn.err.name');
    if (!agentId) e.agent = t('conn.err.agent');
    if (!editing && !token.trim()) e.token = t('conn.err.token');
    setErrs(e); setError('');
    if (Object.keys(e).length) return;
    setSaving(true);
    const body = { kind: 'telegram', name: name.trim(), agent_id: agentId, enabled, allowed: allowed.filter((u) => u.id.trim()), config: { ...(token.trim() ? { token: token.trim() } : {}), lang, on_silent: silent } };
    try {
      if (connection) await api.patch(`/connections/${connection.id}`, body); else await api.post('/connections', body);
      await refresh(['connections', 'agents']);
      toast(t(editing ? 'conn.saved' : 'conn.created'));
      onClose();
    } catch (x) { setError(x instanceof Error ? x.message : String(x)); } finally { setSaving(false); }
  };

  const test = async () => {
    try { const r = await api.post<{ detail: string }>(`/connections/${connection!.id}/test`); toast(t('conn.test.ok', { detail: r.detail })); }
    catch (x) { toast(x instanceof Error ? x.message : t('conn.test.failed'), 'err'); }
  };
  const remove = async () => {
    try { await api.del(`/connections/${connection!.id}`); await refresh(['connections', 'agents']); toast(t('conn.deleted')); onClose(); }
    catch (x) { toast(x instanceof Error ? x.message : String(x), 'err'); }
  };

  return (
    <>
      <Drawer
        title={t(editing ? 'conn.edit' : 'conn.new')} subtitle={t('conn.shared')} onClose={onClose}
        footer={<>
          {editing && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => setConfirmDelete(true)}><Trash2 size={15} />{t('conn.delete')}</button>}
          {editing && <button className="btn" onClick={test} disabled={!enabled}>{t('conn.test')}</button>}
          <button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" onClick={save} disabled={saving}>{t(editing ? 'conn.save' : 'conn.create')}</button>
        </>}
      >
        {error && <div className="banner err"><AlertTriangle size={16} /><div className="grow">{error}</div></div>}

        <Field label={t('conn.kind')}>
          <Segmented value="telegram" onChange={() => undefined} options={[{ id: 'telegram', label: t('conn.kind.telegram') }, { id: 'slack' as 'telegram', label: t('conn.kind.soon'), disabled: true }]} />
        </Field>

        <Field label={t('conn.name')} hint={t('conn.name.hint')} error={errs.name}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('conn.name.placeholder')} autoFocus={!editing} />
        </Field>

        <Field label={t('conn.agent')} hint={t('conn.agent.hint')} error={errs.agent}>
          <select className="input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">{t('conn.agent.pick')}</option>
            {eligible.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        {agent && perm === 'plan' && (
          <div className="banner err"><AlertTriangle size={16} /><div className="grow">{t('conn.perm.plan', { name: agent.name })}</div><button className="btn sm" onClick={allowEditing}>{t('conn.perm.fix')}</button></div>
        )}
        {agent && perm === 'bypassPermissions' && <div className="banner honey"><AlertTriangle size={16} /><div className="grow">{t('conn.perm.full', { name: agent.name })}</div></div>}
        {agent && agent.provider === 'opencode' && <p className="hint" style={{ margin: 0 }}>{t('conn.perm.opencode')}</p>}

        <Field label={t('conn.token')} hint={t('conn.token.hint')} error={errs.token}>
          <input className="input mono" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={tokenHint ? t('conn.token.keep', { hint: tokenHint }) : '123456:ABC…'} />
        </Field>

        <Field label={t('conn.allowed')} hint={t('conn.allowed.hint')}>
          <div className="col" style={{ gap: 8 }}>
            {allowed.length === 0 && <p className="hint" style={{ margin: 0 }}>{t('conn.allowed.empty')}</p>}
            {allowed.map((u, i) => (
              <div key={i} className="row gap-s" style={{ alignItems: 'center' }}>
                <input className="input mono" style={{ width: 150 }} value={u.id} onChange={(e) => setUser(i, { id: e.target.value.replace(/\D/g, '') })} placeholder={t('conn.allowed.id')} aria-label={t('conn.allowed.id')} />
                <input className="input grow" value={u.name ?? ''} onChange={(e) => setUser(i, { name: e.target.value })} placeholder={t('conn.allowed.name')} aria-label={t('conn.allowed.name')} />
                <label className="row gap-s small" title={t('conn.allowed.adminHint')} style={{ whiteSpace: 'nowrap' }}><input type="checkbox" checked={!!u.admin} onChange={(e) => setUser(i, { admin: e.target.checked })} />{t('conn.allowed.admin')}</label>
                <button className="btn ghost icon sm" onClick={() => setAllowed((l) => l.filter((_, j) => j !== i))} aria-label={t('conn.allowed.remove')} title={t('conn.allowed.remove')}><X size={15} /></button>
              </div>
            ))}
            <div><button className="btn sm" onClick={() => setAllowed((l) => [...l, { id: '' }])}><Plus size={14} />{t('conn.allowed.add')}</button></div>
            <p className="hint" style={{ margin: 0 }}>{t('conn.allowed.howto')}</p>
          </div>
        </Field>

        <Field label={t('conn.lang')}><Segmented value={lang} onChange={setLang} options={[{ id: 'es', label: t('conn.lang.es') }, { id: 'en', label: t('conn.lang.en') }]} /></Field>
        <Field label={t('conn.silent')}>
          <Segmented value={silent} onChange={setSilent} options={(['notice', 'send_text', 'ignore'] as Silent[]).map((s) => ({ id: s, label: t(`conn.silent.${s}`) }))} />
        </Field>
        <Field label={t('conn.enabled')} hint={t('conn.enabled.hint')}>
          <Segmented value={enabled ? 'on' : 'off'} onChange={(v) => setEnabled(v === 'on')} options={[{ id: 'on', label: t('common.yes') }, { id: 'off', label: t('conn.status.stopped') }]} />
        </Field>

        {editing && (
          <div className="col" style={{ gap: 6 }}>
            <div className="eyebrow">{t('conn.threads.title')}</div>
            {threads.length === 0 ? <p className="hint" style={{ margin: 0 }}>{t('conn.threads.empty')}</p> : threads.map((th) => (
              <div key={th.id} className="row gap-s small" style={{ justifyContent: 'space-between' }}>
                <span><b>{th.title || th.external_key}</b> <span className="muted mono">{th.external_key}</span></span>
                <span className="muted">{th.last_user ? t('conn.threads.last', { user: th.last_user }) + ' · ' : ''}{ago(th.last_activity)}</span>
              </div>
            ))}
          </div>
        )}
      </Drawer>
      {confirmDelete && (
        <Modal title={t('conn.deleteTitle', { name: connection!.name })} onClose={() => setConfirmDelete(false)}>
          <p style={{ margin: 0 }} className="muted">{t('conn.deleteBody')}</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</button>
            <button className="btn danger" onClick={remove}>{t('conn.delete')}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
