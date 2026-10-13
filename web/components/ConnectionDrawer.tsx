'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import { useHive } from '@/lib/store';
import { api } from '@/lib/api';
import { ago } from '@/lib/meta';
import { useI18n } from '@/lib/i18n';
import type { AllowedChat, AllowedUser, Connection, ConnectionThread, Provider } from '@/lib/types';
import { PasswordInput } from './PasswordInput';
import { Banner, CheckRow, ConfirmDialog, Drawer, Field, ModelField, Segmented, useToast } from './ui';
import { useUnsavedGuard } from '@/lib/hooks/useUnsavedGuard';

type Silent = 'notice' | 'send_text' | 'ignore';
type GroupMode = 'mention' | 'open';

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
  const [effort, setEffort] = useState<string>(connection?.config.effort ?? '');
  const [groupMode, setGroupMode] = useState<GroupMode>(connection?.config.group_mode === 'open' ? 'open' : 'mention');
  const [chats, setChats] = useState<AllowedChat[]>(connection?.config.chats ?? []);
  const [aliases, setAliases] = useState<string>((connection?.config.aliases ?? []).join(', '));
  const [files, setFiles] = useState<boolean>(connection?.config.files !== false);
  const [vision, setVision] = useState<{ provider: Provider; model: string } | null>(connection?.config.vision ?? null);
  const [enabled, setEnabled] = useState(connection?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [errs, setErrs] = useState<{ name?: string; agent?: string; token?: string }>({});
  const [threads, setThreads] = useState<ConnectionThread[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [askClose, setAskClose] = useState(false);
  // Everything the form holds (the token is never shown back, so a typed one counts as an edit too), to tell when closing would lose something.
  const snap = JSON.stringify([name, agentId, token, allowed, lang, silent, effort, groupMode, chats, aliases, files, vision, enabled]);
  const first = useRef(snap); const dirty = snap !== first.current;
  useUnsavedGuard(dirty);
  const close = () => { if (dirty) setAskClose(true); else onClose(); };

  const agent = agents.find((a) => a.id === agentId);
  const perm = agent?.effective.permission;
  const tokenHint = connection?.config.token?.set ? connection.config.token.hint : '';

  useEffect(() => { if (connection) api.get<ConnectionThread[]>(`/connections/${connection.id}/threads`).then(setThreads).catch(() => undefined); }, [connection]);

  const eligible = useMemo(() => [...agents].sort((a, b) => a.name.localeCompare(b.name)), [agents]);
  const setUser = (i: number, p: Partial<AllowedUser>) => setAllowed((l) => l.map((u, j) => (j === i ? { ...u, ...p } : u)));
  const setChat = (i: number, p: Partial<AllowedChat>) => setChats((l) => l.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const toggleMute = async (th: ConnectionThread) => {
    try { await api.patch(`/connections/${connection!.id}/threads/${th.id}`, { muted: !th.muted }); setThreads((l) => l.map((x) => (x.id === th.id ? { ...x, muted: !th.muted } : x))); }
    catch (x) { toast(x instanceof Error ? x.message : String(x), 'err'); }
  };

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
    const body = { kind: 'telegram', name: name.trim(), agent_id: agentId, enabled, allowed: allowed.filter((u) => u.id.trim()), config: {
      ...(token.trim() ? { token: token.trim() } : {}), lang, on_silent: silent, effort, group_mode: groupMode, files, vision,
      chats: chats.filter((c) => c.id.trim()), aliases: aliases.split(',').map((x) => x.trim()).filter(Boolean),
    } };
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
  const remove = async () => { await api.del(`/connections/${connection!.id}`); await refresh(['connections', 'agents']); toast(t('conn.deleted')); onClose(); };

  return (
    <>
      <Drawer
        title={t(editing ? 'conn.edit' : 'conn.new')} subtitle={t('conn.shared')} onClose={close}
        footer={<>
          {editing && <button className="btn danger push-r" onClick={() => setConfirmDelete(true)}><Trash2 size={15} />{t('conn.delete')}</button>}
          {editing && <button className="btn" onClick={test} disabled={!enabled}>{t('conn.test')}</button>}
          <button className="btn ghost" onClick={close}>{t('common.cancel')}</button>
          <button className="btn primary" onClick={save} disabled={saving}>{t(editing ? 'conn.save' : 'conn.create')}</button>
        </>}
      >
        {error && <Banner kind="err">{error}</Banner>}

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
          <Banner kind="err">{t('conn.perm.plan', { name: agent.name })} <button type="button" className="btn sm" onClick={allowEditing}>{t('conn.perm.fix')}</button></Banner>
        )}
        {agent && perm === 'bypassPermissions' && <Banner kind="honey">{t('conn.perm.full', { name: agent.name })}</Banner>}
        {agent && agent.provider === 'opencode' && <p className="hint m0">{t('conn.perm.opencode')}</p>}

        <Field label={t('conn.token')} hint={t('conn.token.hint')} error={errs.token}>
          <PasswordInput autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={tokenHint ? t('conn.token.keep', { hint: tokenHint }) : '123456:ABC…'} />
        </Field>

        <Field label={t('conn.allowed')} hint={t('conn.allowed.hint')}>
          <div className="stack-s">
            {allowed.length === 0 && <p className="hint m0">{t('conn.allowed.empty')}</p>}
            {allowed.map((u, i) => (
              <div key={i} className="row gap-s">
                <input className="input mono fa-w150" value={u.id} onChange={(e) => setUser(i, { id: e.target.value.replace(/\D/g, '') })} placeholder={t('conn.allowed.id')} aria-label={t('conn.allowed.id')} />
                <input className="input grow" value={u.name ?? ''} onChange={(e) => setUser(i, { name: e.target.value })} placeholder={t('conn.allowed.name')} aria-label={t('conn.allowed.name')} />
                <span title={t('conn.allowed.adminHint')} className="nowrap"><CheckRow checked={!!u.admin} onChange={(v) => setUser(i, { admin: v })} label={t('conn.allowed.admin')} /></span>
                <button className="btn ghost icon sm" onClick={() => setAllowed((l) => l.filter((_, j) => j !== i))} aria-label={t('conn.allowed.remove')} title={t('conn.allowed.remove')}><X size={15} /></button>
              </div>
            ))}
            <div><button className="btn sm" onClick={() => setAllowed((l) => [...l, { id: '' }])}><Plus size={14} />{t('conn.allowed.add')}</button></div>
            <p className="hint m0">{t('conn.allowed.howto')}</p>
          </div>
        </Field>

        <Field label={t('conn.groups')}>
          <div className="stack-s fa-gap10">
            <p className="hint m0">{t('conn.groups.hint')}</p>
            <Segmented value={groupMode} onChange={setGroupMode} options={[{ id: 'mention', label: t('conn.mode.mention') }, { id: 'open', label: t('conn.mode.open') }]} />
            <p className="hint m0">{t(`conn.mode.${groupMode}.hint`)}</p>
            <div className="eyebrow">{t('conn.chats')}</div>
            {chats.length === 0 && <p className="hint m0">{t('conn.chats.empty')}</p>}
            {chats.map((c, i) => (
              <div key={i} className="row gap-s">
                <input className="input mono fa-w190" value={c.id} onChange={(e) => setChat(i, { id: e.target.value.replace(/[^\d-]/g, '') })} placeholder={t('conn.chats.id')} aria-label={t('conn.chats.id')} />
                <input className="input grow" value={c.name ?? ''} onChange={(e) => setChat(i, { name: e.target.value })} placeholder={t('conn.chats.name')} aria-label={t('conn.chats.name')} />
                <button className="btn ghost icon sm" onClick={() => setChats((l) => l.filter((_, j) => j !== i))} aria-label={t('conn.chats.remove')} title={t('conn.chats.remove')}><X size={15} /></button>
              </div>
            ))}
            <div><button className="btn sm" onClick={() => setChats((l) => [...l, { id: '' }])}><Plus size={14} />{t('conn.chats.add')}</button></div>
            <p className="hint m0">{t('conn.chats.hint')} {t('conn.chats.howto')}</p>
            <Field label={t('conn.aliases')} hint={t('conn.aliases.hint')}>
              <input className="input" value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder={t('conn.aliases.placeholder')} />
            </Field>
          </div>
        </Field>

        <Field label={t('conn.files')} hint={t('conn.files.hint')}>
          <Segmented value={files ? 'on' : 'off'} onChange={(v) => setFiles(v === 'on')} options={[{ id: 'on', label: t('common.yes') }, { id: 'off', label: t('conn.files.off') }]} />
        </Field>

        {files && (
          <Field label={t('conn.vision')} hint={t(vision ? 'conn.vision.hint.other' : 'conn.vision.hint.agent')}>
            <div className="stack-s">
              <Segmented value={vision ? 'other' : 'agent'} onChange={(v) => setVision(v === 'other' ? { provider: 'claude', model: 'haiku' } : null)} options={[{ id: 'agent', label: t('conn.vision.agent') }, { id: 'other', label: t('conn.vision.other') }]} />
              {vision && (
                <div className="stack-s">
                  <select className="input" value={vision.provider} onChange={(e) => setVision({ provider: e.target.value as Provider, model: '' })} aria-label={t('form.provider')}>
                    {(['claude', 'opencode', 'kiro'] as Provider[]).map((p) => <option key={p} value={p}>{p === 'claude' ? 'Claude Code' : p === 'opencode' ? 'OpenCode' : 'Kiro'}</option>)}
                  </select>
                  <ModelField provider={vision.provider} value={vision.model} onChange={(m) => setVision({ ...vision, model: m })} />
                </div>
              )}
            </div>
          </Field>
        )}

        <Field label={t('conn.lang')}><Segmented value={lang} onChange={setLang} options={[{ id: 'es', label: t('conn.lang.es') }, { id: 'en', label: t('conn.lang.en') }]} /></Field>
        <Field label={t('conn.silent')}>
          <Segmented value={silent} onChange={setSilent} options={(['notice', 'send_text', 'ignore'] as Silent[]).map((s) => ({ id: s, label: t(`conn.silent.${s}`) }))} />
        </Field>
        <Field label={t('conn.effort')} hint={t('conn.effort.hint')}>
          <Segmented value={effort} onChange={setEffort} options={[{ id: '', label: t('conn.effort.default') }, { id: 'low', label: t('conn.effort.low') }, { id: 'medium', label: t('conn.effort.medium') }, { id: 'high', label: t('conn.effort.high') }]} />
        </Field>
        <Field label={t('conn.enabled')} hint={t('conn.enabled.hint')}>
          <Segmented value={enabled ? 'on' : 'off'} onChange={(v) => setEnabled(v === 'on')} options={[{ id: 'on', label: t('common.yes') }, { id: 'off', label: t('conn.status.stopped') }]} />
        </Field>

        {editing && (
          <div className="stack-s">
            <div className="eyebrow">{t('conn.threads.title')}</div>
            {threads.length === 0 ? <p className="hint m0">{t('conn.threads.empty')}</p> : threads.map((th) => (
              <div key={th.id} className="row gap-s small between">
                <span><b>{th.title || th.external_key}</b> <span className="muted mono">{th.external_key}</span></span>
                <span className="row gap-s muted">
                  {th.muted && <span className="gx-chip soft">{t('conn.threads.muted')}</span>}
                  {th.last_user ? t('conn.threads.last', { user: th.last_user }) + ' · ' : ''}{ago(th.last_activity)}
                  <button type="button" className="btn ghost icon sm" onClick={() => toggleMute(th)} title={t(th.muted ? 'conn.threads.unmute' : 'conn.threads.mute')} aria-label={t(th.muted ? 'conn.threads.unmute' : 'conn.threads.mute')}>{th.muted ? <Volume2 size={14} /> : <VolumeX size={14} />}</button>
                </span>
              </div>
            ))}
          </div>
        )}
      </Drawer>
      {confirmDelete && <ConfirmDialog danger title={t('conn.deleteTitle', { name: connection!.name })} body={t('conn.deleteBody')} confirmLabel={t('conn.delete')} onConfirm={remove} onClose={() => setConfirmDelete(false)} />}
      {askClose && <ConfirmDialog danger title={t('fa.unsaved.title')} body={t('fa.unsaved.body')} confirmLabel={t('fa.unsaved.discard')} cancelLabel={t('fa.unsaved.keep')} onClose={() => setAskClose(false)} onConfirm={onClose} />}
    </>
  );
}
