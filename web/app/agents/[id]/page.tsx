'use client';
import { TerminalButton } from '@/components/dock/TerminalButton';
import { useAgentSettings } from '@/components/agents/useAgentSettings';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { History, MessageSquare, RotateCcw, SlidersHorizontal, Waypoints } from 'lucide-react';
import { useAgent, useHiveData } from '@/lib/store';
import { api } from '@/lib/api';
import { ago, shortPath, PROVIDERS, permissionLabel } from '@/lib/meta';
import { LAST_CHAT } from '@/lib/lastChat';
import { writeStored } from '@/lib/hooks/usePersistentState';
import { useQueryState } from '@/lib/hooks/useQueryState';
import { Chat, type ChatApi } from '@/components/chat/Chat';
import type { DiffCommentsCtl } from '@/components/git/DiffComments';
import { useDiffComments } from '@/lib/git/useDiffComments';
import { StatsBar } from '@/components/chat/StatsBar';
import { ResourceStrip } from '@/components/chat/ResourceStrip';
import { CopyBtn } from '@/components/chat/ToolCall';
import { GitExplorer } from '@/components/git/GitExplorer';
import { useGit } from '@/lib/git/useGit';
import { AgentForm } from '@/components/agents/AgentForm';
import { NotebookPanel } from '@/components/agents/NotebookPanel';
import { InstructionsPanel } from '@/components/agents/InstructionsPanel';
import { CloneChip, ClonesChip } from '@/components/agents/CloneTag';
import { Banner, ConfirmDialog, Drawer, EmptyState, Hex, ProviderBadge, RoleChip, StatusChip, TabPanel, Tabs, WorkspaceHeader, useToast, type HeaderAction } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

interface Sess { session_id: string; first_seen: number; last_seen: number; kind: 'direct' | 'delegation'; from_name: string | null; task: string | null }
type CfgTab = 'config' | 'notebook' | 'instructions' | 'sessions';
const CFG_TABS: CfgTab[] = ['config', 'notebook', 'instructions', 'sessions'];

export default function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // Keyed so switching agents resets every piece of the chat's local state (draft, tab, viewed session). The side agent list
  // and the grid around it come from app/agents/layout.tsx, which is not mounted again, so the list keeps its scroll.
  return <Workspace key={id} id={id} />;
}

function Workspace({ id }: { id: string }) {
  const { t } = useI18n();
  const { ready, error, retry, refresh } = useHiveData();
  const agent = useAgent(id);
  const router = useRouter();
  const toast = useToast();
  // The settings drawer is open only while the URL says so (?tab=config|notebook|instructions|sessions): a modal never opens by itself from a saved preference.
  const [qtab, setQtab] = useQueryState('tab', '');
  const [lastTab, setLastTab] = useState<CfgTab>('config');
  const tab: CfgTab = (CFG_TABS as string[]).includes(qtab) ? (qtab as CfgTab) : lastTab;
  const open = qtab !== '';
  const [askClose, setAskClose] = useState(false);
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [viewing, setViewing] = useState<string | undefined>(undefined);
  const [confirm, setConfirm] = useState<'new' | null>(null);
  const [view, setView] = useState<'chat' | 'changes'>('chat');
  // Always loaded (cheap) so the tab can show how many files changed; the file tree loads when the tab opens.
  const git = useGit(agent, view === 'changes');
  const changedCount = git.status && git.status.isRepo ? git.status.changes.length : 0;
  // Comments on the diff live here, not in the explorer (unmounted on the way back to the chat), and go out through the chat's own send.
  const diffComments = useDiffComments(id);
  const chatApi = useRef<ChatApi | null>(null);
  const readOnly = viewing !== undefined && viewing !== agent?.session_id;
  const commentsCtl = useMemo<DiffCommentsCtl>(() => ({
    ...diffComments, readOnly, busy: agent?.status === 'running', agentName: agent?.name ?? '', onViewChat: () => setView('chat'),
    send: (text) => (chatApi.current ? chatApi.current.send(text, { quiet: true }) : Promise.resolve({ ok: false, error: t('chat.sendFailed') })),
  }), [diffComments, readOnly, agent?.status, agent?.name, t]);

  const setOpen = (v: boolean, tb?: CfgTab) => { const next = tb ?? tab; setLastTab(next); setQtab(v ? next : ''); };
  const settings = useAgentSettings(agent, { onDeleted: () => router.push('/agents'), onCloned: (c) => router.push(`/agents/${c.id}`) });
  const { draft, setDraft, errors, dirty } = settings;
  // Closing with edits (X, Escape, scrim, Hide) asks first.
  const closeCfg = () => { if (dirty) setAskClose(true); else setOpen(false); };
  useEffect(() => { if (open && tab === 'sessions') api.get<Sess[]>(`/agents/${id}/sessions`).then(setSessions).catch(() => undefined); }, [open, tab, id, agent?.session_id]);

  // The Chat entry of the side rail comes back to the conversation that was open last.
  useEffect(() => { if (agent) writeStored(LAST_CHAT, agent.id); }, [agent]);

  if (!agent) return (
    <div className="page">
      {!ready && error ? <Banner kind="err"><span>{error}</span> <button type="button" className="btn sm" onClick={() => void retry()}>{t('fa.retry')}</button></Banner>
        : ready ? <EmptyState title={t('agent.missing.title')} body={t('agent.missing.body')} action={<Link className="btn" href="/agents">{t('agent.missing.back')}</Link>} /> : null}
    </div>
  );

  const resume = async (sid: string) => { await api.post(`/agents/${id}/resume-session`, { session_id: sid }); setViewing(undefined); toast(t('agent.resumed')); };
  const direct = sessions.filter((s) => s.kind !== 'delegation');
  const delegated = sessions.filter((s) => s.kind === 'delegation');
  const viewingDelegation = sessions.find((s) => s.session_id === viewing)?.kind === 'delegation';
  const actions: HeaderAction[] = [
    ...(viewing ? [
      { id: 'make-current', label: t('agent.makeCurrent'), onClick: () => void resume(viewing).catch((e) => toast(e instanceof Error ? e.message : String(e), 'err')), disabled: viewingDelegation },
      { id: 'back-current', label: t('agent.backToCurrent'), onClick: () => setViewing(undefined) },
    ] : []),
    { id: 'new-conv', label: t('agent.newConversation'), icon: <RotateCcw size={14} />, onClick: () => setConfirm('new'), disabled: !agent.session_id || agent.status === 'running' },
  ];

  return (
    <>
      <section className="ws-chat">
        <WorkspaceHeader
          back={{ href: '/colony', label: t('agent.backToColony') }}
          avatar={<Hex agent={agent} />}
          title={agent.name}
          meta={<><RoleChip role={agent.role} /><ProviderBadge provider={agent.provider} /><span className="small">{agent.model || t('model.cliDefault')}</span><StatusChip status={agent.status} /><CloneChip agent={agent} link /><ClonesChip agent={agent} /></>}
          actions={actions}
          primary={<>
            <div className="seg" role="group" aria-label={t('git.tab.label')}>
              <button type="button" aria-pressed={view === 'chat'} onClick={() => setView('chat')}>{t('git.tab.chat')}</button>
              <button type="button" aria-pressed={view === 'changes'} onClick={() => setView('changes')}>{t('git.tab.changes')}{changedCount > 0 && <span className="tabcount">{changedCount}</span>}
                {diffComments.items.length > 0 && <span className="tabcount dc-tabcount" role="img" aria-label={t('diffc.tab', { count: diffComments.items.length })} title={t('diffc.tab', { count: diffComments.items.length })}><MessageSquare size={10} aria-hidden />{diffComments.items.length}</span>}</button>
            </div>
            <TerminalButton spec={{ agentId: id }} title={t('dock.agent')} />
            <button type="button" className={`btn sm ${open ? 'primary' : ''}`} onClick={() => (open ? closeCfg() : setOpen(true))} aria-expanded={open} aria-label={t('colony.agentSettings')}><SlidersHorizontal size={14} />{t('agent.settings')}{dirty && <i className="dot run" title={t('agent.unsaved')} />}</button>
          </>}
        />
        {/* The chat stays mounted (just hidden) so a half-written message and the scroll position survive a visit to Changes. */}
        <div className="chat-pane" hidden={view !== 'chat'}>
          {agent.permission_stale && !viewing && (
            <Banner kind="warn" action={<button type="button" className="btn sm" onClick={() => setConfirm('new')}>{t('agent.permStale.action')}</button>}>
              <b>{t('agent.permStale.title')}</b> {t('agent.permStale.body', { a1: permissionLabel(agent.effective.permission) })}
            </Banner>
          )}
          <ResourceStrip agent={agent} />
          <StatsBar agent={agent} session={viewing} />
          <Chat agent={agent} sessionOverride={viewing} apiRef={chatApi} />
        </div>
        {view === 'changes' && <GitExplorer agent={agent} git={git} comments={commentsCtl} />}
      </section>

      {open && (
        <Drawer title={agent.name} subtitle={`${t(`role.${agent.role}`)} · ${PROVIDERS[agent.provider].label}`} onClose={closeCfg}
          footer={(tab === 'config' || tab === 'instructions') && draft ? (
            <>
              <span className="muted small grow">{dirty ? t('agent.unsavedChanges') : t('agent.allSaved')}{dirty && agent.status === 'running' ? ` ${t('agent.appliesNextTurn')}` : ''}</span>
              {settings.actions({ size: 'sm' })}
            </>
          ) : undefined}>
          <div className="agent-config">
            <Tabs idPrefix="cfg" label={t('fa.cfg.tabs')} value={tab} onChange={(v) => setOpen(true, v as CfgTab)}
              tabs={[{ id: 'config', label: t('agent.tab.config') }, { id: 'notebook', label: t('agent.tab.notebook') }, { id: 'instructions', label: t('agent.tab.instructions') }, { id: 'sessions', label: t('nav.sessions') }]} />
          <TabPanel id="config" value={tab} idPrefix="cfg">
            {draft && (
              <>
                <div className="pane"><AgentForm draft={draft} onChange={setDraft} errors={errors} selfId={id} /></div>
              </>
            )}
          </TabPanel>
          <TabPanel id="notebook" value={tab} idPrefix="cfg"><NotebookPanel agent={agent} /></TabPanel>
          <TabPanel id="instructions" value={tab} idPrefix="cfg"><InstructionsPanel agent={agent} draft={draft} onChange={setDraft} dirty={dirty} /></TabPanel>
          <TabPanel id="sessions" value={tab} idPrefix="cfg">
            <div className="pane">
              <p className="hint m0">{t('agent.sessions.intro', { path: shortPath(agent.effective.cwd) })}</p>
              <div className="eyebrow">{t('agent.sessions.conversations')}</div>
              {direct.length === 0 ? <EmptyState compact icon={<History size={22} />} title={t('agent.sessions.empty')} /> : direct.map((s) => {
                const current = s.session_id === agent.session_id;
                return (
                  <div key={s.session_id} className={`card card-pad col fa-sess ${viewing === s.session_id ? 'on' : ''}`}>
                    <div className="row gap-xs"><span className="mono grow sess-id">{s.session_id}</span><CopyBtn compact text={s.session_id} label={t('agent.sessions.copyId')} />{current && <span className="chip honey">{t('sessions.current')}</span>}</div>
                    <span className="muted small">{t('agent.sessions.started', { started: ago(s.first_seen), last: ago(s.last_seen) })}</span>
                    <div className="row gap-s"><button className="btn sm" onClick={() => { setViewing(current ? undefined : s.session_id); setOpen(false); }}>{viewing === s.session_id ? t('agent.sessions.viewing') : t('agent.sessions.read')}</button>{!current && <button className="btn sm" onClick={() => resume(s.session_id).then(() => setOpen(false)).catch((e) => toast(e instanceof Error ? e.message : String(e), 'err'))}>{t('agent.sessions.resume')}</button>}</div>
                  </div>
                );
              })}
              {delegated.length > 0 && <div className="eyebrow mt-s">{t('agent.sessions.delegated')}</div>}
              {delegated.map((s) => (
                <div key={s.session_id} className={`card card-pad col fa-sess ${viewing === s.session_id ? 'on' : ''}`}>
                  <div className="row gap-s"><Waypoints size={14} className="muted" /><b className="grow">{t('agent.sessions.from', { name: s.from_name ?? t('chat.anOrchestrator') })}</b><span className="muted small">{ago(s.last_seen)}</span></div>
                  {s.task && <span className="small fa-clamp3">{s.task}</span>}
                  <div className="row gap-xs"><span className="mono muted small grow sess-id">{s.session_id}</span><CopyBtn compact text={s.session_id} label={t('agent.sessions.copyId')} /></div>
                  <div className="row gap-s"><button className="btn sm" onClick={() => { setViewing(viewing === s.session_id ? undefined : s.session_id); setOpen(false); }}>{viewing === s.session_id ? t('agent.sessions.viewing') : t('agent.sessions.read')}</button></div>
                </div>
              ))}
            </div>
          </TabPanel>
          </div>
        </Drawer>
      )}

      {settings.deleteModal}
      {settings.cloneModal}
      {askClose && <ConfirmDialog danger title={t('fa.unsaved.title')} body={t('fa.unsaved.body')} confirmLabel={t('fa.unsaved.discard')} cancelLabel={t('fa.unsaved.keep')} onClose={() => setAskClose(false)} onConfirm={() => { settings.discard(); setOpen(false); }} />}
      {confirm === 'new' && (
        <ConfirmDialog title={t('agent.newConvTitle')} body={t('agent.newConvBody')} confirmLabel={t('agent.newConvStart')} onClose={() => setConfirm(null)}
          onConfirm={async () => { await api.post(`/agents/${id}/new-session`); await refresh(['agents']); toast(t('agent.newConvStarted')); }} />
      )}
    </>
  );
}
