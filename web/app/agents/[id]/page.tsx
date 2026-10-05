'use client';
import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, History, RotateCcw, SlidersHorizontal, Trash2, Waypoints } from 'lucide-react';
import { useHive } from '@/lib/store';
import { api } from '@/lib/api';
import { ago, shortPath } from '@/lib/meta';
import { Chat } from '@/components/Chat';
import { StatsBar } from '@/components/StatsBar';
import { AgentSwitcher } from '@/components/AgentSwitcher';
import { AgentForm, draftFromAgent, validate, type AgentDraft } from '@/components/AgentForm';
import { Hex, Modal, ProviderBadge, RoleChip, StatusChip, useToast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

interface Sess { session_id: string; first_seen: number; last_seen: number; kind: 'direct' | 'delegation'; from_name: string | null; task: string | null }

export default function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // Keyed so switching agents from the side list resets every piece of local state.
  return <Workspace key={id} id={id} />;
}

function Workspace({ id }: { id: string }) {
  const { t } = useI18n();
  const { agent: find, agents, colonies, ready, refresh } = useHive();
  const agent = find(id);
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'config' | 'sessions'>('config');
  const [draft, setDraft] = useState<AgentDraft | null>(null);
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [viewing, setViewing] = useState<string | undefined>(undefined);
  const [confirm, setConfirm] = useState<'delete' | 'new' | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { try { setOpen(localStorage.getItem('hive-cfg-open') === '1'); } catch { /* ignore */ } }, []);
  const toggle = (v: boolean, tb?: 'config' | 'sessions') => { setOpen(v); if (tb) setTab(tb); try { localStorage.setItem('hive-cfg-open', v ? '1' : '0'); } catch { /* ignore */ } };

  useEffect(() => { if (agent && !draft) setDraft(draftFromAgent(agent)); }, [agent, draft]);
  useEffect(() => { if (open && tab === 'sessions') api.get<Sess[]>(`/agents/${id}/sessions`).then(setSessions).catch(() => undefined); }, [open, tab, id, agent?.session_id]);

  const dirty = useMemo(() => !!(agent && draft && JSON.stringify(draftFromAgent(agent)) !== JSON.stringify(draft)), [agent, draft]);
  const errors = draft ? validate(draft, agents, id, colonies) : {};

  if (!agent) return (
    <div className="ws"><AgentSwitcher activeId={id} /><div className="page">{ready ? <div className="empty"><h3>{t('agent.missing.title')}</h3><p>{t('agent.missing.body')}</p><Link className="btn" href="/agents">{t('agent.missing.back')}</Link></div> : null}</div></div>
  );

  const save = async () => {
    if (!draft || Object.keys(errors).length) { toast(t('edit.fixFields'), 'err'); return; }
    setSaving(true);
    try {
      const { type_id: _t, ...patch } = draft; void _t;
      await api.patch(`/agents/${id}`, patch);
      await refresh(['agents', 'colonies']); setDraft(null);
      toast(t('agent.changesSaved'));
    } catch (e) { toast(e instanceof Error ? e.message : t('edit.saveFailed'), 'err'); }
    setSaving(false);
  };
  const resume = async (sid: string) => { await api.post(`/agents/${id}/resume-session`, { session_id: sid }); setViewing(undefined); toast(t('agent.resumed')); };
  const direct = sessions.filter((s) => s.kind !== 'delegation');
  const delegated = sessions.filter((s) => s.kind === 'delegation');

  return (
    <div className={`ws ${open ? 'with-config' : ''}`}>
      <AgentSwitcher activeId={id} />
      <section className="ws-chat">
        <header className="ws-head">
          <Link href="/" className="btn ghost icon" aria-label={t('agent.backToColony')}><ArrowLeft size={18} /></Link>
          <Hex agent={agent} />
          <div className="grow"><h1>{agent.name}</h1><div className="row gap-s wrap" style={{ marginTop: 3 }}><RoleChip role={agent.role} /><ProviderBadge provider={agent.provider} /><span className="muted small">{agent.model || t('model.cliDefault')}</span><StatusChip status={agent.status} /></div></div>
          {viewing && <button className="btn primary sm" onClick={() => resume(viewing)} disabled={sessions.find((s) => s.session_id === viewing)?.kind === 'delegation'}>{t('agent.makeCurrent')}</button>}
          {viewing && <button className="btn sm" onClick={() => setViewing(undefined)}>{t('agent.backToCurrent')}</button>}
          <button className="btn sm" onClick={() => setConfirm('new')} disabled={!agent.session_id || agent.status === 'running'}><RotateCcw size={14} />{t('agent.newConversation')}</button>
          <button className={`btn sm ${open ? 'primary' : ''}`} onClick={() => toggle(!open)} aria-expanded={open} aria-label={t('colony.agentSettings')}><SlidersHorizontal size={14} />{t('agent.settings')}{dirty && <i className="dot run" title={t('agent.unsaved')} />}</button>
        </header>
        <StatsBar agent={agent} session={viewing} />
        <Chat agent={agent} sessionOverride={viewing} />
      </section>

      {open && (
        <aside className="ws-side">
          <div className="tabs" role="tablist" style={{ padding: '0 12px', position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>
            <button className="tab" role="tab" aria-selected={tab === 'config'} onClick={() => setTab('config')}>{t('agent.tab.config')}</button>
            <button className="tab" role="tab" aria-selected={tab === 'sessions'} onClick={() => setTab('sessions')}>{t('nav.sessions')}</button>
            <button className="btn ghost sm" style={{ marginLeft: 'auto', alignSelf: 'center' }} onClick={() => toggle(false)}>{t('common.hide')}</button>
          </div>
          {tab === 'config' && draft && (
            <>
              <div className="pane"><AgentForm draft={draft} onChange={setDraft} errors={errors} selfId={id} />
                <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%' }} />
                <button className="btn danger sm" style={{ alignSelf: 'flex-start' }} onClick={() => setConfirm('delete')}><Trash2 size={14} />{t('agent.delete')}</button>
              </div>
              <div className="savebar">
                <span className="muted small grow">{dirty ? t('agent.unsavedChanges') : t('agent.allSaved')}{dirty && agent.status === 'running' ? ` ${t('agent.appliesNextTurn')}` : ''}</span>
                <button className="btn ghost sm" disabled={!dirty} onClick={() => setDraft(draftFromAgent(agent))}>{t('common.discard')}</button>
                <button className="btn primary sm" disabled={!dirty || saving} onClick={save}>{saving ? t('common.saving') : t('common.saveChanges')}</button>
              </div>
            </>
          )}
          {tab === 'sessions' && (
            <div className="pane">
              <p className="hint" style={{ margin: 0 }}>{t('agent.sessions.intro', { path: shortPath(agent.effective.cwd) })}</p>
              <div className="eyebrow">{t('agent.sessions.conversations')}</div>
              {direct.length === 0 ? <div className="empty" style={{ padding: 24 }}><History size={22} /><p>{t('agent.sessions.empty')}</p></div> : direct.map((s) => {
                const current = s.session_id === agent.session_id;
                return (
                  <div key={s.session_id} className="card card-pad col" style={{ gap: 8, borderColor: viewing === s.session_id ? 'var(--honey)' : undefined }}>
                    <div className="row"><span className="mono grow">{s.session_id.slice(0, 18)}…</span>{current && <span className="chip honey">{t('sessions.current')}</span>}</div>
                    <span className="muted small">{t('agent.sessions.started', { started: ago(s.first_seen), last: ago(s.last_seen) })}</span>
                    <div className="row gap-s"><button className="btn sm" onClick={() => setViewing(current ? undefined : s.session_id)}>{viewing === s.session_id ? t('agent.sessions.viewing') : t('agent.sessions.read')}</button>{!current && <button className="btn sm" onClick={() => resume(s.session_id)}>{t('agent.sessions.resume')}</button>}</div>
                  </div>
                );
              })}
              {delegated.length > 0 && <div className="eyebrow" style={{ marginTop: 6 }}>{t('agent.sessions.delegated')}</div>}
              {delegated.map((s) => (
                <div key={s.session_id} className="card card-pad col" style={{ gap: 8, borderColor: viewing === s.session_id ? 'var(--honey)' : undefined }}>
                  <div className="row gap-s"><Waypoints size={14} className="muted" /><b className="grow">{t('agent.sessions.from', { name: s.from_name ?? t('chat.anOrchestrator') })}</b><span className="muted small">{ago(s.last_seen)}</span></div>
                  {s.task && <span className="small" style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.task}</span>}
                  <div className="row gap-s"><button className="btn sm" onClick={() => setViewing(viewing === s.session_id ? undefined : s.session_id)}>{viewing === s.session_id ? t('agent.sessions.viewing') : t('agent.sessions.read')}</button></div>
                </div>
              ))}
            </div>
          )}
        </aside>
      )}

      {confirm === 'delete' && (
        <Modal title={t('agent.deleteTitle', { name: agent.name })} onClose={() => setConfirm(null)}>
          <p style={{ margin: 0 }} className="muted">{t('agent.deleteBody')}</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn ghost" onClick={() => setConfirm(null)}>{t('agent.keep')}</button>
            <button className="btn danger" onClick={async () => { await api.del(`/agents/${id}`); await refresh(['agents', 'colonies']); toast(t('agent.deleted')); router.push('/agents'); }}>{t('agent.delete')}</button></div>
        </Modal>
      )}
      {confirm === 'new' && (
        <Modal title={t('agent.newConvTitle')} onClose={() => setConfirm(null)}>
          <p style={{ margin: 0 }} className="muted">{t('agent.newConvBody')}</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn ghost" onClick={() => setConfirm(null)}>{t('common.cancel')}</button>
            <button className="btn primary" onClick={async () => { await api.post(`/agents/${id}/new-session`); await refresh(['agents']); setConfirm(null); toast(t('agent.newConvStarted')); }}>{t('agent.newConvStart')}</button></div>
        </Modal>
      )}
    </div>
  );
}
