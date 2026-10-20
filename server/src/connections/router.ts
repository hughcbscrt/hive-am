import { agents } from '../db.js';
import { parseJson } from '../db/json.js';
import { liveTurn, queueDepth, sendTurn, stopAgent } from '../runtime.js';
import { calledByName as aliasCall, directedAtOther, firstNames } from './addressing.js';
import { allow } from './rate.js';
import { saveAttachments } from './files.js';
import { describeImages, validVision } from './vision.js';
import { channelPrompt } from './prompt.js';
import { connections, threadMessages, threads } from './store.js';
import type { AllowedChat, AllowedUser, ChannelAdapter, Connection, Inbound, OnSilent, Origin, SavedFile, Thread } from './types.js';

const MAX_INPUT = 8000;
const DEFAULT_RATE = 20; // messages per user per minute
const DEFAULT_CHATTER_PER_MINUTE = 10; // times per minute that chatter nobody aimed at the agent may wake it, per thread
const DENIED_PER_MINUTE = 5; // access notices per person and chat per minute, so a stranger can't make the bot spam a chat
const DENIED_CHAT_PER_MINUTE = 20; // access notices per chat per minute, whoever asks
/** Sent once when a turn aimed at the agent ended without a reply. */
const NUDGE = '[hive:channel] System reminder: your last turn ended without calling `channel_reply`, so the person received nothing. If you had an answer, send it now with `channel_reply` (if the tool says it is unknown, call it again: it was still connecting). If you chose not to answer, say so in one short sentence with `channel_reply`.';
import { validEffort } from '../efforts.js';
const QUIET_MS = 4000;   // group chatter is handed over once it pauses this long, so a burst is one turn
const LONG_TURN_MS = 45_000; // an unaddressed turn this long did real work: if it never replied, remind it
const QUIET_RETRIES = 15; // while the agent is busy the hand-over waits (about a minute); after this it is left as context for the next turn

const T = {
  noAgent: { es: 'Esta conexión no tiene un agente vinculado.', en: 'This connection has no agent linked.' },
  notAllowed: (id: string) => ({ es: `No tienes acceso. Pide que añadan tu id: ${id}`, en: `You don't have access. Ask to add your id: ${id}` }),
  tooLong: { es: 'Mensaje demasiado largo.', en: 'Message too long.' },
  rate: { es: 'Demasiados mensajes seguidos; espera un momento.', en: 'Too many messages in a row; wait a moment.' },
  queued: (n: number) => ({ es: `⏳ En cola (${n} por delante).`, en: `⏳ Queued (${n} ahead).` }),
  silent: { es: '⚠️ El agente terminó sin responder.', en: '⚠️ The agent finished without replying.' },
  failed: (e: string) => ({ es: `❌ Falló el turno: ${e}`, en: `❌ The turn failed: ${e}` }),
  stopped: { es: '🛑 Detenido.', en: '🛑 Stopped.' },
  nothingToStop: { es: 'No había nada en curso.', en: 'Nothing was running.' },
  status: (name: string, state: string, cwd: string, q: number) => ({ es: `${name} · ${state} · ${cwd}${q ? ` · ${q} en cola` : ''}`, en: `${name} · ${state} · ${cwd}${q ? ` · ${q} queued` : ''}` }),
  adminOnly: { es: 'Solo un administrador puede usar /new.', en: 'Only an admin can use /new.' },
  confirmNew: { es: 'Esto borra el contexto compartido de TODAS las conversaciones del agente. Responde `/new confirmar` para continuar.', en: 'This wipes the shared context of ALL of the agent’s conversations. Reply `/new confirm` to continue.' },
  filesOff: { es: 'Esta conexión no recibe archivos.', en: 'This connection does not receive files.' },
  fileFailed: (list: { name: string; reason: string }[]) => ({ es: `No pude recibir: ${list.map((f) => `${f.name} (${f.reason})`).join('; ')}`, en: `I could not receive: ${list.map((f) => `${f.name} (${f.reason})`).join('; ')}` }),
  newDone: { es: '🆕 Conversación nueva.', en: '🆕 New conversation.' },
  muted: { es: '🔇 Me quedo callado en este hilo. Menciónenme o respondan a un mensaje mío para que vuelva a hablar.', en: '🔇 I\'ll stay quiet in this thread. Mention me or reply to one of my messages to bring me back.' },
  unmuted: { es: '🔊 Listo, vuelvo a participar en este hilo.', en: '🔊 Done, I\'m back in this thread.' },
  help: { es: 'Comandos: /new (o /clear, /reset) empieza una conversación nueva (solo administradores) · /stop detiene el turno en curso · /status estado del agente · /mute y /unmute me callan o me reactivan en este hilo · /id tu id y el de este chat · /help esta ayuda.', en: 'Commands: /new (or /clear, /reset) starts a new conversation (admins only) · /stop stops the turn in progress · /status the agent\'s state · /mute and /unmute silence me or bring me back in this thread · /id your id and this chat\'s · /help this help.' },
  ids: (user: string, chat: string) => ({ es: `Tu id: ${user} · este chat: ${chat}`, en: `Your id: ${user} · this chat: ${chat}` }),
  notAllowedChat: (user: string, chat: string) => ({ es: `No tienes acceso. Para usarme aquí, añade tu id (${user}) o este chat (${chat}) en la conexión.`, en: `You don't have access. To use me here, add your id (${user}) or this chat (${chat}) to the connection.` }),
  notAllowedMember: (user: string, chat: string, slack: boolean) => slack
    ? { es: `Este canal solo admite a personas de su lista. Para usarme aquí, añade tu id (${user}) a los miembros de este canal (${chat}).`, en: `This channel only admits the people on its list. To use me here, add your id (${user}) to this channel's members (${chat}).` }
    : { es: `Este chat solo admite a personas de su lista. Para usarme aquí, añade tu id (${user}) a los miembros de este chat (${chat}).`, en: `This chat only admits the people on its list. To use me here, add your id (${user}) to this chat's members (${chat}).` },
};
type Msg = { es: string; en: string };
/** The same commands on every platform; these are other names for them. */
const COMMAND_ALIASES: Record<string, string> = { clear: 'new', reset: 'new' };
const say = (c: Connection, m: Msg) => (c.config.lang === 'en' ? m.en : m.es);

const hits = new Map<string, number[]>();
function tooFast(connId: string, user: string, limit: number): boolean {
  const key = `${connId}:${user}`, t = Date.now();
  const arr = (hits.get(key) ?? []).filter((x) => t - x < 60_000);
  arr.push(t); hits.set(key, arr);
  return arr.length > limit;
}

const chatsOf = (c: Connection): AllowedChat[] => (Array.isArray(c.config.chats) ? c.config.chats : []);

/** Who may talk: in a DM and in a group with no entry of its own, the connection's people list (with their admin flag); in a listed group, that group's own rule: everyone in it, or only its members (the people list does not open it, and an empty list admits nobody). A member keeps admin only if the people list gives it. The chat is `target.chat`, so a rule covers every topic and thread in it. */
export function senderOf(c: Connection, m: Inbound): AllowedUser | undefined {
  const listed = c.allowed.find((u) => u.id === m.userId);
  if (!m.group) return listed;
  const chat = chatsOf(c).find((x) => x.id === m.target.chat);
  if (!chat) return listed;
  if (chat.mode !== 'members') return listed ?? { id: m.userId, name: m.userName };
  const member = (Array.isArray(chat.members) ? chat.members : []).find((x) => x.id === m.userId);
  return member ? { id: m.userId, name: member.name ?? m.userName, ...(listed?.admin ? { admin: true } : {}) } : undefined;
}
const aliasesOf = (c: Connection): string[] => (Array.isArray(c.config.aliases) ? c.config.aliases : []).map((a: unknown) => String(a).trim()).filter(Boolean);

/** Group chatter that speaks TO the agent by one of its aliases counts as aimed at it, even without @mention. */
const selfNames = (c: Connection): string[] => { const n = (c.agent_id ? agents.get(c.agent_id)?.name : '') ?? ''; return n ? [n, n.split(/\s+/)[0]] : []; };
const calledByName = (c: Connection, text: string): boolean => aliasCall([...aliasesOf(c), ...selfNames(c)], text);

/** The other humans of this thread, by first name (never the sender, the agent or its aliases). */
function otherPeople(threadId: string, sender: Inbound, agentNames: string[]): string[] {
  const names = threadMessages.senders(threadId).filter((x) => x.id !== sender.userId).map((x) => x.name);
  return firstNames(names, [sender.userName, ...agentNames]);
}

interface Quiet { timer: ReturnType<typeof setTimeout>; m: Inbound; msgId: number; tries: number }
const quiet = new Map<string, Quiet>(); // thread id → chatter waiting for a pause
const clearQuiet = (threadId: string) => { const q = quiet.get(threadId); if (q) { clearTimeout(q.timer); quiet.delete(threadId); } };

/** One inbound message: access checks, commands, then a turn on the agent's single session. Resolves when the turn ends. */
export async function handleInbound(connectionId: string, adapter: ChannelAdapter, m: Inbound): Promise<void> {
  const conn = connections.get(connectionId);
  if (!conn) return;
  const reply = (text: string) => adapter.send(m.target, text).catch(() => undefined);
  const group = !!m.group;
  let addressed = m.addressed !== false || (group && calledByName(conn, m.text));

  // Group chatter is only heard when the connection is open to it.
  if (group && !addressed && conn.config.group_mode !== 'open') return;

  const user = senderOf(conn, m);
  if (!user) {
    if (!addressed) return; // never answer strangers' chatter
    // Told at every message, so the bot never looks dead; capped per person and per chat (topics and threads share it) so nobody can make it flood a chat.
    if (!allow(`denied:${connectionId}:${m.userId}:${m.target.chat}`, DENIED_PER_MINUTE) || !allow(`denied-chat:${connectionId}:${m.target.chat}`, DENIED_CHAT_PER_MINUTE)) {
      return;
    }
    const restricted = group && chatsOf(conn).some((c) => c.id === m.target.chat && c.mode === 'members');
    await reply(say(conn, restricted ? T.notAllowedMember(m.userId, m.target.chat, conn.kind === 'slack') : group ? T.notAllowedChat(m.userId, m.target.chat) : T.notAllowed(m.userId)));
    return;
  }

  const thread = threads.touch(connectionId, m.externalKey, { title: m.place, target: m.target, user: m.userName });
  if (!threadMessages.record(thread.id, 'in', m.externalId, { id: m.userId, name: m.userName }, m.text)) return; // duplicate delivery
  const msgId = threadMessages.lastId(thread.id);

  const agent = conn.agent_id ? agents.get(conn.agent_id) : undefined;
  if (!agent) { if (addressed) await reply(say(conn, T.noAgent)); return; }

  if (m.attachments?.length && !m.command) {
    if (conn.config.files === false) { if (addressed) await reply(say(conn, T.filesOff)); }
    else {
      if (addressed) await adapter.busy(m.target, 'working', m.externalId).catch(() => undefined);
      const { saved, failed } = await saveAttachments(agent.id, adapter, m);
      if (validVision(conn.config.vision)) await describeImages(agent, conn.config.vision, saved);
      m.files = saved;
      if (saved.length) threadMessages.setFiles(thread.id, m.externalId, saved);
      if (failed.length && addressed) await reply(say(conn, T.fileFailed(failed)));
    }
    if (!m.text.trim() && !m.files?.length) { await adapter.busy(m.target, 'done', m.externalId).catch(() => undefined); return; } // only files, and none could be saved: nothing to hand over
  }

  if (m.command) {
    const { args } = m.command;
    const name = COMMAND_ALIASES[m.command.name] ?? m.command.name;
    if (name === 'help') { await reply(say(conn, T.help)); return; }
    if (name === 'id') { await reply(say(conn, T.ids(m.userId, m.target.chat))); return; }
    if (name === 'stop') { await reply(say(conn, stopAgent(agent.id) ? T.stopped : T.nothingToStop)); return; }
    if (name === 'status') { await reply(say(conn, T.status(agent.name, liveTurn(agent.id) ? 'running' : agent.status, agent.effective.cwd, queueDepth(agent.id)))); return; }
    if (name === 'mute' || name === 'unmute') {
      clearQuiet(thread.id); threads.setMuted(thread.id, name === 'mute');
      await reply(say(conn, name === 'mute' ? T.muted : T.unmuted)); return;
    }
    if (name === 'new') {
      if (!user.admin) { await reply(say(conn, T.adminOnly)); return; }
      if (!/^(confirm|confirmar)$/i.test(args.trim())) { await reply(say(conn, T.confirmNew)); return; }
      stopAgent(agent.id); agents.setSession(agent, null);
      await reply(say(conn, T.newDone)); return;
    }
    // Unknown commands are just text for the agent.
    addressed = true;
  }

  if (!addressed) {
    // People talking to each other: the agent still listens (it can correct a mistake or warn of a danger) but the header says it is for somebody else, and the bar to speak is higher.
    m.directedAt = m.directedAt || directedAtOther(otherPeople(thread.id, m, [...selfNames(conn), ...aliasesOf(conn)]), m.text) || undefined;
    // Heard, not called: it is kept for context, and the agent only wakes up once the chat pauses (never while muted).
    if (thread.muted) return;
    const q = quiet.get(thread.id);
    if (q) clearTimeout(q.timer);
    arm(connectionId, adapter, thread.id, m, msgId, q?.tries ?? 0);
    return;
  }

  clearQuiet(thread.id);
  await deliver(conn, adapter, thread, m, msgId, true);
}

function arm(connectionId: string, adapter: ChannelAdapter, threadId: string, m: Inbound, msgId: number, tries: number) {
  const timer = setTimeout(() => {
    quiet.delete(threadId);
    const conn = connections.get(connectionId), thread = threads.get(threadId), agent = conn?.agent_id ? agents.get(conn.agent_id) : undefined;
    if (!conn || !thread || !agent || thread.muted || !conn.enabled) return;
    if (liveTurn(agent.id) || queueDepth(agent.id) > 0) { if (tries < QUIET_RETRIES) arm(connectionId, adapter, threadId, m, msgId, tries + 1); return; }
    // A flood of chatter must not wake the agent over and over: past the limit the message stays as context for the next turn (see `chatter_per_minute`).
    if (!allow(`chatter:${thread.id}`, Number(conn.config.chatter_per_minute ?? DEFAULT_CHATTER_PER_MINUTE))) return;
    void deliver(conn, adapter, thread, m, msgId, false);
  }, QUIET_MS);
  timer.unref?.();
  quiet.set(threadId, { timer, m, msgId, tries });
}

/** Hands one message (and anything unseen before it) to the agent and reports how the turn went. */
async function deliver(conn: Connection, adapter: ChannelAdapter, thread: Thread, m: Inbound, msgId: number, addressed: boolean, scheduled = false): Promise<void> {
  const agent = conn.agent_id ? agents.get(conn.agent_id) : undefined;
  if (!agent) return;
  const reply = (text: string) => adapter.send(m.target, text).catch(() => undefined);
  const fresh = threads.get(thread.id) ?? thread;

  if (m.text.length > MAX_INPUT) { if (addressed) await reply(say(conn, T.tooLong)); return; }
  if (tooFast(conn.id, m.userId, Number(conn.config.rate_limit) || DEFAULT_RATE)) { if (addressed) await reply(say(conn, T.rate)); return; }

  const ahead = queueDepth(agent.id) + (liveTurn(agent.id) ? 1 : 0);
  if (addressed && ahead > 0 && !scheduled) await reply(say(conn, T.queued(ahead)));

  const unseen = threadMessages.unseen(thread.id, fresh.seen_id, msgId).map((r) => ({ name: r.user_name ?? r.user_id ?? '?', text: r.text as string, files: r.files ? parseJson<SavedFile[] | undefined>(r.files, undefined, `thread message ${r.id} files`) : undefined }));
  threads.markSeen(thread.id, msgId);

  const origin: Origin = { connectionId: conn.id, threadId: thread.id, externalKey: m.externalKey, platform: conn.kind, place: m.place, userName: m.userName, userId: m.userId, group: !!m.group, mention: m.mention, addressed, replied: false, messageId: m.externalId, target: m.target, effort: validEffort(conn.config.effort) ? conn.config.effort : undefined };
  if (addressed) await adapter.busy(m.target, 'working', m.externalId).catch(() => undefined);
  const startedAt = Date.now();
  let res = await sendTurn(agent.id, channelPrompt(conn.kind, m, { addressed, muted: fresh.muted, unseen }), 'user', undefined, undefined, origin);
  // Chatter nobody aimed at the agent may be left unanswered, but a turn that worked for a while and ended without `channel_reply`
  // produced a result nobody will ever see (the agent wrote it as plain text). Remind it once.
  if (!addressed && res.ok && !origin.replied && !threads.get(thread.id)?.muted && Date.now() - startedAt > LONG_TURN_MS) {
    res = await sendTurn(agent.id, NUDGE, 'user', undefined, undefined, origin);
  }
  // Someone talked to the agent and it ended without answering: usually a tool that failed at the start of the turn and a model that gave up.
  // One reminder (same conversation, same origin) fixes that; staying quiet on purpose (muted thread) is respected.
  if (addressed && res.ok && !origin.replied && !threads.get(thread.id)?.muted) {
    res = await sendTurn(agent.id, NUDGE, 'user', undefined, undefined, origin);
  }

  const onSilent: OnSilent = conn.config.on_silent ?? 'notice';
  if (!res.ok) {
    if (!addressed) { console.error(`[connections] ${conn.name}: a turn on group chatter failed: ${res.error}`); return; }
    await adapter.busy(m.target, 'failed', m.externalId).catch(() => undefined);
    if (res.error && res.error !== 'Stopped') await reply(say(conn, T.failed(res.error)));
  } else if (origin.replied || !addressed) {
    // Staying quiet on chatter nobody aimed at the agent is a normal outcome.
    if (addressed) await adapter.busy(m.target, 'done', m.externalId).catch(() => undefined);
  } else {
    if (onSilent === 'send_text' && res.text) { await reply(res.text); await adapter.busy(m.target, 'done', m.externalId).catch(() => undefined); }
    else if (onSilent === 'notice') { await adapter.busy(m.target, 'failed', m.externalId).catch(() => undefined); await reply(say(conn, T.silent)); }
    else await adapter.busy(m.target, 'done', m.externalId).catch(() => undefined);
  }
}

/** A message the agent asked to receive later (a wake-up, a schedule): it reaches the agent like a message of that thread, so it can answer there (on Slack, in the channel: see `ChannelAdapter.proactive`). */
export async function deliverScheduled(conn: Connection, adapter: ChannelAdapter, thread: Thread, text: string, mention?: { id: string; name: string }): Promise<void> {
  const m: Inbound = {
    externalId: `sched-${Date.now()}`, externalKey: thread.external_key, userId: '', userName: 'hive-am (scheduled)', place: thread.title || 'chat', target: adapter.proactive?.(thread.target) ?? thread.target, addressed: true, text, mention,
  };
  await deliver(conn, adapter, thread, m, threadMessages.lastId(thread.id), true, true);
}
