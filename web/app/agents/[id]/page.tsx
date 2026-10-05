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

interface Sess { session_id: string; first_seen: number; last_seen: number; kind: 'direct' | 'delegation'; from_name: string | null; task: string | null }

export default function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // Keyed so switching agents from the side list resets every piece of local state.
  return <Workspace key={id} id={id} />;
}

function Workspace({ id }: { id: string }) {
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
  const toggle = (v: boolean, t?: 'config' | 'sessions') => { setOpen(v); if (t) setTab(t); try { localStorage.setItem('hive-cfg-open', v ? '1' : '0'); } catch { /* ignore */ } };

  useEffect(() => { if (agent && !draft) setDraft(draftFromAgent(agent)); }, [agent, draft]);
  useEffect(() => { if (open && tab === 'sessions') api.get<Sess[]>(`/agents/${id}/sessions`).then(setSessions).catch(() => undefined); }, [open, tab, id, agent?.session_id]);

  const dirty = useMemo(() => !!(agent && draft && JSON.stringify(draftFromAgent(agent)) !== JSON.stringify(draft)), [agent, draft]);
  const errors = draft ? validate(draft, agents, id, colonies) : {};

  if (!agent) return (
    <div className="ws"><AgentSwitcher activeId={id} /><div className="page">{ready ? <div className="empty"><h3>That agent doesn’t exist</h3><p>It may have been deleted.</p><Link className="btn" href="/agents">Back to agents</Link></div> : null}</div></div>
  );

  const save = async () => {
    if (!draft || Object.keys(errors).length) { toast('Fix the highlighted fields first', 'err'); return; }
    setSaving(true);
    try {
      const { type_id: _t, ...patch } = draft; void _t;
      await api.patch(`/agents/${id}`, patch);
      await refresh(['agents', 'colonies']); setDraft(null);
      toast('Changes saved');
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not save', 'err'); }
    setSaving(false);
  };
  const resume = async (sid: string) => { await api.post(`/agents/${id}/resume-session`, { session_id: sid }); setViewing(undefined); toast('Conversation resumed'); };
  const direct = sessions.filter((s) => s.kind !== 'delegation');
  const delegated = sessions.filter((s) => s.kind === 'delegation');

  return (
    <div className={`ws ${open ? 'with-config' : ''}`}>
      <AgentSwitcher activeId={id} />
      <section className="ws-chat">
        <header className="ws-head">
          <Link href="/" className="btn ghost icon" aria-label="Back to the colony"><ArrowLeft size={18} /></Link>
          <Hex agent={agent} />
          <div className="grow"><h1>{agent.name}</h1><div className="row gap-s wrap" style={{ marginTop: 3 }}><RoleChip role={agent.role} /><ProviderBadge provider={agent.provider} /><span className="muted small">{agent.model || 'CLI default'}</span><StatusChip status={agent.status} /></div></div>
          {viewing && <button className="btn primary sm" onClick={() => resume(viewing)} disabled={sessions.find((s) => s.session_id === viewing)?.kind === 'delegation'}>Make this conversation current</button>}
          {viewing && <button className="btn sm" onClick={() => setViewing(undefined)}>Back to current</button>}
          <button className="btn sm" onClick={() => setConfirm('new')} disabled={!agent.session_id || agent.status === 'running'}><RotateCcw size={14} />New conversation</button>
          <button className={`btn sm ${open ? 'primary' : ''}`} onClick={() => toggle(!open)} aria-expanded={open} aria-label="Agent settings"><SlidersHorizontal size={14} />Settings{dirty && <i className="dot run" title="Unsaved changes" />}</button>
        </header>
        <StatsBar agent={agent} session={viewing} />
        <Chat agent={agent} sessionOverride={viewing} />
      </section>

      {open && (
        <aside className="ws-side">
          <div className="tabs" role="tablist" style={{ padding: '0 12px', position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>
            <button className="tab" role="tab" aria-selected={tab === 'config'} onClick={() => setTab('config')}>Configuration</button>
            <button className="tab" role="tab" aria-selected={tab === 'sessions'} onClick={() => setTab('sessions')}>Sessions</button>
            <button className="btn ghost sm" style={{ marginLeft: 'auto', alignSelf: 'center' }} onClick={() => toggle(false)}>Hide</button>
          </div>
          {tab === 'config' && draft && (
            <>
              <div className="pane"><AgentForm draft={draft} onChange={setDraft} errors={errors} selfId={id} />
                <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%' }} />
                <button className="btn danger sm" style={{ alignSelf: 'flex-start' }} onClick={() => setConfirm('delete')}><Trash2 size={14} />Delete agent</button>
              </div>
              <div className="savebar">
                <span className="muted small grow">{dirty ? 'You have unsaved changes.' : 'All changes saved.'}{dirty && agent.status === 'running' ? ' They apply from the next turn.' : ''}</span>
                <button className="btn ghost sm" disabled={!dirty} onClick={() => setDraft(draftFromAgent(agent))}>Discard</button>
                <button className="btn primary sm" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button>
              </div>
            </>
          )}
          {tab === 'sessions' && (
            <div className="pane">
              <p className="hint" style={{ margin: 0 }}>Native sessions in <span className="mono">{shortPath(agent.effective.cwd)}</span>. Reading one never changes the agent.</p>
              <div className="eyebrow">Conversations</div>
              {direct.length === 0 ? <div className="empty" style={{ padding: 24 }}><History size={22} /><p>No conversations yet. The first message creates one.</p></div> : direct.map((s) => {
                const current = s.session_id === agent.session_id;
                return (
                  <div key={s.session_id} className="card card-pad col" style={{ gap: 8, borderColor: viewing === s.session_id ? 'var(--honey)' : undefined }}>
                    <div className="row"><span className="mono grow">{s.session_id.slice(0, 18)}…</span>{current && <span className="chip honey">Current</span>}</div>
                    <span className="muted small">Started {ago(s.first_seen)} · last used {ago(s.last_seen)}</span>
                    <div className="row gap-s"><button className="btn sm" onClick={() => setViewing(current ? undefined : s.session_id)}>{viewing === s.session_id ? 'Viewing' : 'Read transcript'}</button>{!current && <button className="btn sm" onClick={() => resume(s.session_id)}>Resume this one</button>}</div>
                  </div>
                );
              })}
              {delegated.length > 0 && <div className="eyebrow" style={{ marginTop: 6 }}>Delegated tasks</div>}
              {delegated.map((s) => (
                <div key={s.session_id} className="card card-pad col" style={{ gap: 8, borderColor: viewing === s.session_id ? 'var(--honey)' : undefined }}>
                  <div className="row gap-s"><Waypoints size={14} className="muted" /><b className="grow">From {s.from_name ?? 'an orchestrator'}</b><span className="muted small">{ago(s.last_seen)}</span></div>
                  {s.task && <span className="small" style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.task}</span>}
                  <div className="row gap-s"><button className="btn sm" onClick={() => setViewing(viewing === s.session_id ? undefined : s.session_id)}>{viewing === s.session_id ? 'Viewing' : 'Read transcript'}</button></div>
                </div>
              ))}
            </div>
          )}
        </aside>
      )}

      {confirm === 'delete' && (
        <Modal title={`Delete ${agent.name}?`} onClose={() => setConfirm(null)}>
          <p style={{ margin: 0 }} className="muted">The agent and its connections are removed. Its native session files stay on disk, untouched.</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn ghost" onClick={() => setConfirm(null)}>Keep agent</button>
            <button className="btn danger" onClick={async () => { await api.del(`/agents/${id}`); await refresh(['agents', 'colonies']); toast('Agent deleted'); router.push('/agents'); }}>Delete agent</button></div>
        </Modal>
      )}
      {confirm === 'new' && (
        <Modal title="Start a new conversation?" onClose={() => setConfirm(null)}>
          <p style={{ margin: 0 }} className="muted">The agent starts with a fresh session. The current one stays in its Sessions tab and can be resumed anytime.</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn ghost" onClick={() => setConfirm(null)}>Cancel</button>
            <button className="btn primary" onClick={async () => { await api.post(`/agents/${id}/new-session`); await refresh(['agents']); setConfirm(null); toast('New conversation started'); }}>Start new conversation</button></div>
        </Modal>
      )}
    </div>
  );
}
