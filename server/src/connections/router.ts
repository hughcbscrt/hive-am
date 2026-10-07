import { agents } from '../db.js';
import { liveTurn, queueDepth, sendTurn, stopAgent } from '../runtime.js';
import { channelPrompt } from './prompt.js';
import { connections, threadMessages, threads } from './store.js';
import type { ChannelAdapter, Connection, Inbound, OnSilent, Origin } from './types.js';

const MAX_INPUT = 8000;
const DEFAULT_RATE = 20; // messages per user per minute

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
  newDone: { es: '🆕 Conversación nueva.', en: '🆕 New conversation.' },
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

/** One inbound message: access checks, commands, then a turn on the agent's single session. Resolves when the turn ends. */
export async function handleInbound(connectionId: string, adapter: ChannelAdapter, m: Inbound): Promise<void> {
  const conn = connections.get(connectionId);
  if (!conn) return;
  const reply = (text: string) => adapter.send(m.target, text).catch(() => undefined);

  const user = conn.allowed.find((u) => u.id === m.userId);
  if (!user) {
    const key = `${connectionId}:${m.userId}`;
    if (!told.has(key)) { told.add(key); await reply(say(conn, T.notAllowed(m.userId))); }
    return;
  }

  const thread = threads.touch(connectionId, m.externalKey, { title: m.place, target: m.target, user: m.userName });
  if (!threadMessages.record(thread.id, 'in', m.externalId, { id: m.userId, name: m.userName }, m.text)) return; // duplicate delivery

  const agent = conn.agent_id ? agents.get(conn.agent_id) : undefined;
  if (!agent) { await reply(say(conn, T.noAgent)); return; }

  if (m.command) {
    const { name, args } = m.command;
    if (name === 'stop') { await reply(say(conn, stopAgent(agent.id) ? T.stopped : T.nothingToStop)); return; }
    if (name === 'status') { await reply(say(conn, T.status(agent.name, liveTurn(agent.id) ? 'running' : agent.status, agent.effective.cwd, queueDepth(agent.id)))); return; }
    if (name === 'new') {
      if (!user.admin) { await reply(say(conn, T.adminOnly)); return; }
      if (!/^(confirm|confirmar)$/i.test(args.trim())) { await reply(say(conn, T.confirmNew)); return; }
      stopAgent(agent.id); agents.setSession(agent, null);
      await reply(say(conn, T.newDone)); return;
    }
    // Unknown commands are just text for the agent.
  }

  if (m.text.length > MAX_INPUT) { await reply(say(conn, T.tooLong)); return; }
  if (tooFast(connectionId, m.userId, Number(conn.config.rate_limit) || DEFAULT_RATE)) { await reply(say(conn, T.rate)); return; }

  const ahead = queueDepth(agent.id) + (liveTurn(agent.id) ? 1 : 0);
  if (ahead > 0) await reply(say(conn, T.queued(ahead)));

  const origin: Origin = { connectionId, threadId: thread.id, externalKey: m.externalKey, platform: conn.kind, place: m.place, userName: m.userName, replied: false };
  await adapter.busy(m.target, 'working').catch(() => undefined);
  const res = await sendTurn(agent.id, channelPrompt(conn.kind, m), 'user', undefined, undefined, origin);

  const onSilent: OnSilent = conn.config.on_silent ?? 'notice';
  if (!res.ok) {
    await adapter.busy(m.target, 'failed').catch(() => undefined);
    if (res.error && res.error !== 'Stopped') await reply(say(conn, T.failed(res.error)));
  } else if (origin.replied) {
    await adapter.busy(m.target, 'done').catch(() => undefined);
  } else {
    if (onSilent === 'send_text' && res.text) { await reply(res.text); await adapter.busy(m.target, 'done').catch(() => undefined); }
    else if (onSilent === 'notice') { await adapter.busy(m.target, 'failed').catch(() => undefined); await reply(say(conn, T.silent)); }
    else await adapter.busy(m.target, 'done').catch(() => undefined);
  }
}
