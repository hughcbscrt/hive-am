import { agents } from '../db.js';
import { liveTurn, queueDepth, sendTurn, stopAgent } from '../runtime.js';
import { saveAttachments } from './files.js';
import { describeImages, validVision } from './vision.js';
import { channelPrompt } from './prompt.js';
import { connections, threadMessages, threads } from './store.js';
import type { AllowedChat, AllowedUser, ChannelAdapter, Connection, Inbound, OnSilent, Origin, Thread } from './types.js';

const MAX_INPUT = 8000;
const DEFAULT_RATE = 20; // messages per user per minute
const QUIET_MS = 4000;   // group chatter is handed over once it pauses this long, so a burst is one turn
const QUIET_RETRIES = 5; // while the agent is busy the hand-over waits; after this it is left as context for the next turn

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
  notAllowedChat: (user: string, chat: string) => ({ es: `No tienes acceso. Para usarme aquí, añade tu id (${user}) o este chat (${chat}) en la conexión.`, en: `You don't have access. To use me here, add your id (${user}) or this chat (${chat}) to the connection.` }),
};
type Msg = { es: string; en: string };
const say = (c: Connection, m: Msg) => (c.config.lang === 'en' ? m.en : m.es);

const hits = new Map<string, number[]>();
function tooFast(connId: string, user: string, limit: number): boolean {
  const key = `${connId}:${user}`, t = Date.now();
  const arr = (hits.get(key) ?? []).filter((x) => t - x < 60_000);
  arr.push(t); hits.set(key, arr);
  return arr.length > limit;
}
const told = new Set<string>(); // users already told how to get access, so strangers can't make us spam them

const chatsOf = (c: Connection): AllowedChat[] => (Array.isArray(c.config.chats) ? c.config.chats : []);
const aliasesOf = (c: Connection): string[] => (Array.isArray(c.config.aliases) ? c.config.aliases : []).map((a: unknown) => String(a).trim()).filter(Boolean);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Group chatter that names the agent counts as aimed at it, even without @mention. */
function calledByName(c: Connection, text: string): boolean {
  const names = aliasesOf(c); if (!names.length) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}_])(${names.map(escapeRe).join('|')})(?![\\p{L}\\p{N}_])`, 'iu').test(text);
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

  const user: AllowedUser | undefined = conn.allowed.find((u) => u.id === m.userId)
    ?? (group && chatsOf(conn).some((c) => c.id === m.target.chat) ? { id: m.userId, name: m.userName } : undefined);
  if (!user) {
    if (!addressed) return; // never answer strangers' chatter
    const key = `${connectionId}:${m.userId}`;
    if (!told.has(key)) { told.add(key); await reply(say(conn, group ? T.notAllowedChat(m.userId, m.target.chat) : T.notAllowed(m.userId))); }
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
      if (addressed) await adapter.busy(m.target, 'working').catch(() => undefined);
      const { saved, failed } = await saveAttachments(agent.id, adapter, m);
      if (validVision(conn.config.vision)) await describeImages(agent, conn.config.vision, saved);
      m.files = saved;
      if (saved.length) threadMessages.setFiles(thread.id, m.externalId, saved);
      if (failed.length && addressed) await reply(say(conn, T.fileFailed(failed)));
    }
    if (!m.text.trim() && !m.files?.length) return; // only files, and none could be saved: nothing to hand over
  }

  if (m.command) {
    const { name, args } = m.command;
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
    void deliver(conn, adapter, thread, m, msgId, false);
  }, QUIET_MS);
  timer.unref?.();
  quiet.set(threadId, { timer, m, msgId, tries });
}

/** Hands one message (and anything unseen before it) to the agent and reports how the turn went. */
async function deliver(conn: Connection, adapter: ChannelAdapter, thread: Thread, m: Inbound, msgId: number, addressed: boolean): Promise<void> {
  const agent = conn.agent_id ? agents.get(conn.agent_id) : undefined;
  if (!agent) return;
  const reply = (text: string) => adapter.send(m.target, text).catch(() => undefined);
  const fresh = threads.get(thread.id) ?? thread;

  if (m.text.length > MAX_INPUT) { if (addressed) await reply(say(conn, T.tooLong)); return; }
  if (tooFast(conn.id, m.userId, Number(conn.config.rate_limit) || DEFAULT_RATE)) { if (addressed) await reply(say(conn, T.rate)); return; }

  const ahead = queueDepth(agent.id) + (liveTurn(agent.id) ? 1 : 0);
  if (addressed && ahead > 0) await reply(say(conn, T.queued(ahead)));

  const unseen = threadMessages.unseen(thread.id, fresh.seen_id, msgId).map((r) => ({ name: r.user_name ?? r.user_id ?? '?', text: r.text as string, files: r.files ? JSON.parse(r.files) : undefined }));
  threads.markSeen(thread.id, msgId);

  const origin: Origin = { connectionId: conn.id, threadId: thread.id, externalKey: m.externalKey, platform: conn.kind, place: m.place, userName: m.userName, addressed, replied: false };
  if (addressed) await adapter.busy(m.target, 'working').catch(() => undefined);
  const res = await sendTurn(agent.id, channelPrompt(conn.kind, m, { addressed, muted: fresh.muted, unseen }), 'user', undefined, undefined, origin);

  const onSilent: OnSilent = conn.config.on_silent ?? 'notice';
  if (!res.ok) {
    if (!addressed) { console.error(`[connections] ${conn.name}: a turn on group chatter failed: ${res.error}`); return; }
    await adapter.busy(m.target, 'failed').catch(() => undefined);
    if (res.error && res.error !== 'Stopped') await reply(say(conn, T.failed(res.error)));
  } else if (origin.replied || !addressed) {
    // Staying quiet on chatter nobody aimed at the agent is a normal outcome.
    if (addressed) await adapter.busy(m.target, 'done').catch(() => undefined);
  } else {
    if (onSilent === 'send_text' && res.text) { await reply(res.text); await adapter.busy(m.target, 'done').catch(() => undefined); }
    else if (onSilent === 'notice') { await adapter.busy(m.target, 'failed').catch(() => undefined); await reply(say(conn, T.silent)); }
    else await adapter.busy(m.target, 'done').catch(() => undefined);
  }
}
