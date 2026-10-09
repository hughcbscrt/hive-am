'use client';
import { useAgentSettings } from '@/components/agents/useAgentSettings';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, History, Maximize2, Minimize2, RotateCcw, SlidersHorizontal, Waypoints } from 'lucide-react';
import { useHive } from '@/lib/store';
import { api } from '@/lib/api';
import { ago, shortPath } from '@/lib/meta';
import { Chat } from '@/components/chat/Chat';
import { StatsBar } from '@/components/chat/StatsBar';
import { AgentSwitcher } from '@/components/agents/AgentSwitcher';
import { GitExplorer } from '@/components/git/GitExplorer';
import { useGit } from '@/lib/git/useGit';
import { AgentForm } from '@/components/agents/AgentForm';
import { NotebookPanel } from '@/components/agents/NotebookPanel';
import { Hex, Modal, ProviderBadge, RoleChip, StatusChip, useToast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

interface Sess { session_id: string; first_seen: number; last_seen: number; kind: 'direct' | 'delegation'; from_name: string | null; task: string | null }

const CFG_MIN = 340, CFG_DEFAULT = 400;
const maxCfg = () => Math.max(CFG_MIN, window.innerWidth - 80);

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
  const [tab, setTab] = useState<'config' | 'notebook' | 'sessions'>('config');
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [viewing, setViewing] = useState<string | undefined>(undefined);
  const [confirm, setConfirm] = useState<'new' | null>(null);
  const [view, setView] = useState<'chat' | 'changes'>('chat');
  const [swCollapsed, setSwCollapsed] = useState(false);
  useEffect(() => { try { setSwCollapsed(localStorage.getItem('hive-switcher-collapsed') === '1'); } catch { /* ignore */ } }, []);
  const toggleSwitcher = () => setSwCollapsed((c) => { try { localStorage.setItem('hive-switcher-collapsed', c ? '0' : '1'); } catch { /* ignore */ } return !c; });
  // Always loaded (cheap) so the tab can show how many files changed; the file tree loads when the tab opens.
  const git = useGit(agent, view === 'changes');
  const changedCount = git.status && git.status.isRepo ? git.status.changes.length : 0;

  useEffect(() => { try { setOpen(localStorage.getItem('hive-cfg-open') === '1'); } catch { /* ignore */ } }, []);
  const [cfgW, setCfgW] = useState(CFG_DEFAULT);
  useEffect(() => { try { const w = Number(localStorage.getItem('hive-cfg-width')); if (w >= CFG_MIN) setCfgW(Math.min(w, maxCfg())); } catch { /* ignore */ } }, []);
  const saveCfgW = (w: number) => { try { localStorage.setItem('hive-cfg-width', String(Math.round(w))); } catch { /* ignore */ } };
  const cfgWide = cfgW > CFG_DEFAULT + 40;
  const toggleCfgW = () => { const w = cfgWide ? CFG_DEFAULT : Math.min(maxCfg(), Math.round(window.innerWidth / 2)); setCfgW(w); saveCfgW(w); };
  const dragCfg = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget; el.setPointerCapture(e.pointerId);
    let w = cfgW;
    const move = (ev: PointerEvent) => { w = Math.min(maxCfg(), Math.max(CFG_MIN, window.innerWidth - ev.clientX)); setCfgW(w); };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); saveCfgW(w); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  };
  const toggle = (v: boolean, tb?: 'config' | 'notebook' | 'sessions') => { setOpen(v); if (tb) setTab(tb); try { localStorage.setItem('hive-cfg-open', v ? '1' : '0'); } catch { /* ignore */ } };

  const settings = useAgentSettings(agent, { onDeleted: () => router.push('/agents') });
  const { draft, setDraft, errors, dirty, saving } = settings;
  useEffect(() => { if (open && tab === 'sessions') api.get<Sess[]>(`/agents/${id}/sessions`).then(setSessions).catch(() => undefined); }, [open, tab, id, agent?.session_id]);


  if (!agent) return (
    <div className={`ws ${swCollapsed ? 'sw-collapsed' : ''}`}><AgentSwitcher activeId={id} collapsed={swCollapsed} onToggle={toggleSwitcher} /><div className="page">{ready ? <div className="empty"><h3>{t('agent.missing.title')}</h3><p>{t('agent.missing.body')}</p><Link className="btn" href="/agents">{t('agent.missing.back')}</Link></div> : null}</div></div>
  );

  const resume = async (sid: string) => { await api.post(`/agents/${id}/resume-session`, { session_id: sid }); setViewing(undefined); toast(t('agent.resumed')); };
  const direct = sessions.filter((s) => s.kind !== 'delegation');
  const delegated = sessions.filter((s) => s.kind === 'delegation');

  return (
    <div className={`ws ${open ? 'with-config' : ''} ${swCollapsed ? 'sw-collapsed' : ''}`} style={{ '--cfg': `${cfgW}px` } as React.CSSProperties}>
      <AgentSwitcher activeId={id} collapsed={swCollapsed} onToggle={toggleSwitcher} />
      <section className="ws-chat">
        <header className="ws-head">
          <Link href="/" className="btn ghost icon" aria-label={t('agent.backToColony')}><ArrowLeft size={18} /></Link>
          <Hex agent={agent} />
          <div className="grow"><h1>{agent.name}</h1><div className="row gap-s wrap" style={{ marginTop: 3 }}><RoleChip role={agent.role} /><ProviderBadge provider={agent.provider} /><span className="muted small">{agent.model || t('model.cliDefault')}</span><StatusChip status={agent.status} /></div></div>
          <div className="seg" role="group" aria-label={t('git.tab.label')}>
            <button type="button" aria-pressed={view === 'chat'} onClick={() => setView('chat')}>{t('git.tab.chat')}</button>
            <button type="button" aria-pressed={view === 'changes'} onClick={() => setView('changes')}>{t('git.tab.changes')}{changedCount > 0 && <span className="tabcount">{changedCount}</span>}</button>
          </div>
          {viewing && <button className="btn primary sm" onClick={() => resume(viewing)} disabled={sessions.find((s) => s.session_id === viewing)?.kind === 'delegation'}>{t('agent.makeCurrent')}</button>}
          {viewing && <button className="btn sm" onClick={() => setViewing(undefined)}>{t('agent.backToCurrent')}</button>}
          <button className="btn sm" onClick={() => setConfirm('new')} disabled={!agent.session_id || agent.status === 'running'}><RotateCcw size={14} />{t('agent.newConversation')}</button>
          <button className={`btn sm ${open ? 'primary' : ''}`} onClick={() => toggle(!open)} aria-expanded={open} aria-label={t('colony.agentSettings')}><SlidersHorizontal size={14} />{t('agent.settings')}{dirty && <i className="dot run" title={t('agent.unsaved')} />}</button>
        </header>
        {/* The chat stays mounted (just hidden) so a half-written message and the scroll position survive a visit to Changes. */}
        <div className="chat-pane" hidden={view !== 'chat'}>
          <StatsBar agent={agent} session={viewing} />
          <Chat agent={agent} sessionOverride={viewing} />
        </div>
        {view === 'changes' && <GitExplorer agent={agent} git={git} />}
      </section>

      {open && (
        <aside className="ws-side">
          <div className="ws-grip" onPointerDown={dragCfg} onDoubleClick={toggleCfgW} role="separator" aria-orientation="vertical" aria-label={t('drawer.resize')} title={t('drawer.resize')} />
          <div className="tabs" role="tablist" style={{ padding: '0 12px', position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>
            <button className="tab" role="tab" aria-selected={tab === 'config'} onClick={() => setTab('config')}>{t('agent.tab.config')}</button>
            <button className="tab" role="tab" aria-selected={tab === 'notebook'} onClick={() => setTab('notebook')}>{t('agent.tab.notebook')}</button>
            <button className="tab" role="tab" aria-selected={tab === 'sessions'} onClick={() => setTab('sessions')}>{t('nav.sessions')}</button>
            <button className="btn ghost icon sm" style={{ marginLeft: 'auto', alignSelf: 'center' }} onClick={toggleCfgW} aria-label={cfgWide ? t('drawer.shrink') : t('drawer.expand')} title={cfgWide ? t('drawer.shrink') : t('drawer.expand')}>{cfgWide ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
            <button className="btn ghost sm" style={{ alignSelf: 'center' }} onClick={() => toggle(false)}>{t('common.hide')}</button>
          </div>
          {tab === 'config' && draft && (
            <>
              <div className="pane"><AgentForm draft={draft} onChange={setDraft} errors={errors} selfId={id} />
              </div>
              <div className="savebar col">
                <span className="muted small">{dirty ? t('agent.unsavedChanges') : t('agent.allSaved')}{dirty && agent.status === 'running' ? ` ${t('agent.appliesNextTurn')}` : ''}</span>
                <div className="row">{settings.actions({ size: 'sm' })}</div>
              </div>
            </>
          )}
          {tab === 'notebook' && <NotebookPanel agent={agent} />}
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

      {settings.deleteModal}
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
