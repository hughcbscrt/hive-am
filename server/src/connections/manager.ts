import { readFileSync } from 'node:fs';
import { agents } from '../db.js';
import { liveOrigin, notifyAgentsChanged } from '../runtime.js';
import { cleanInbox } from './files.js';
import { retentionPass, retentionTouched } from '../retention.js';
import { resolveSendable } from './outbound.js';
import { syncChannelSkill } from './channel-skill.js';
import { handleInbound } from './router.js';
import { findSecret, SECRET_REFUSAL } from './secrets.js';
import { connections, threadMessages, threads } from './store.js';
import type { AdapterStatus, ChannelAdapter, ChannelKind, Connection } from './types.js';
import { DomainError } from '../errors.js';

const TEXTUAL = /\.(txt|md|csv|json|svg|log|ya?ml|toml|ini|conf|sh|sql)$/i; // files whose text is checked for secrets before they are sent

type Factory = (c: Connection) => ChannelAdapter;
const factories = new Map<ChannelKind, Factory>();
const running = new Map<string, ChannelAdapter>();
const startErrors = new Map<string, string>();

/** Platforms register themselves here; the manager only knows the adapter interface. */
export const registerFactory = (kind: ChannelKind, f: Factory) => { factories.set(kind, f); };
export const adapterFor = (connectionId: string) => running.get(connectionId);

export const connectionStatus = (id: string): AdapterStatus =>
  running.get(id)?.status() ?? { state: 'stopped' };

// Starting is serialized per connection: two starts at once (the interface saving while startAll runs) would each build an adapter,
// and the one that lost the `running` slot would keep polling the platform for ever with nobody able to stop it.
const starting = new Map<string, Promise<void>>();
export function startConnection(id: string): Promise<void> {
  const prev = starting.get(id) ?? Promise.resolve();
  const next = prev.then(() => doStart(id));
  starting.set(id, next);
  void next.finally(() => { if (starting.get(id) === next) starting.delete(id); });
  return next;
}

async function doStart(id: string): Promise<void> {
  await stopConnection(id);
  const c = connections.get(id);
  if (!c || !c.enabled) return;
  syncChannelSkill(c.agent_id);
  const make = factories.get(c.kind);
  if (!make) return;
  const adapter = make(c);
  running.set(id, adapter);
  try {
    await adapter.start((m) => handleInbound(id, adapter, m));
    startErrors.delete(id);
  } catch (e) {
    startErrors.set(id, e instanceof Error ? e.message : String(e));
    console.error(`[connections] ${c.name} failed to start:`, startErrors.get(id));
  }
  notifyAgentsChanged();
}

export async function stopConnection(id: string): Promise<void> {
  const a = running.get(id);
  if (!a) return;
  running.delete(id);
  try { await a.stop(); } catch { /* already down */ }
}

let cleaner: ReturnType<typeof setInterval> | undefined;
/** Received files are kept for a while, then removed; and what hive-am keeps of its own record is aged out (retention.ts). */
function housekeeping(): void {
  cleanInbox();
  try { const r = retentionPass(); if (retentionTouched(r)) console.log(`[retention] removed ${r.messages} messages, ${r.dispatches} dispatches, ${r.sessions} sessions; emptied ${r.files} file records`); }
  catch (e) { console.error('[retention]', e); }
}
export const startAll = () => {
  housekeeping();
  cleaner ??= setInterval(housekeeping, 6 * 3_600_000).unref();
  return Promise.all(connections.list().filter((c) => c.enabled).map((c) => startConnection(c.id)));
};
export const stopAll = () => Promise.all([...running.keys()].map(stopConnection));

export async function testConnection(id: string): Promise<string> {
  const c = connections.get(id); const a = running.get(id);
  if (!c) throw new Error('Connection not found');
  if (!a) throw new Error(c.enabled ? `Not running${startErrors.get(id) ? `: ${startErrors.get(id)}` : ''}` : 'The connection is disabled.');
  if (!a.test) throw new Error('This platform has no test.');
  return a.test(c.allowed.map((u) => u.id));
}

export class ChannelError extends DomainError {}

export { SendError } from './outbound.js';

/** `channel_mute`: the agent keeps quiet in the thread it is handling (or starts talking there again). */
export function channelMute(agentId: string, muted: boolean): { muted: boolean; place: string } {
  if (!agents.get(agentId)) throw new ChannelError('Unknown agent');
  const origin = liveOrigin(agentId);
  if (!origin) throw new ChannelError('No channel message is being handled right now, so there is no thread to mute.');
  threads.setMuted(origin.threadId, muted);
  return { muted, place: origin.place };
}

/** `channel_reply`: sends the agent's text to the thread of the message it is handling. */
export async function channelReply(agentId: string, text: string): Promise<{ sent: boolean; parts: number }> {
  if (!agents.get(agentId)) throw new ChannelError('Unknown agent');
  if (!text.trim()) throw new ChannelError('The message is empty');
  const origin = liveOrigin(agentId);
  if (!origin) throw new ChannelError('No channel message is being handled right now, so there is nobody to reply to.');
  const adapter = running.get(origin.connectionId);
  if (!adapter) throw new ChannelError('The connection is not running.');
  const thread = threads.get(origin.threadId);
  if (!thread) throw new ChannelError('The thread no longer exists.');
  if (origin.mention && !origin.mentioned && adapter.mention) {
    text = `${adapter.mention(origin.mention)} ${text}`;
    origin.mentioned = true;
  }
  const leak = findSecret(text);
  if (leak) { console.warn(`[connections] blocked a reply of agent ${agentId}: it seemed to contain ${leak}`); throw new ChannelError(SECRET_REFUSAL(leak)); }
  const { externalId } = await adapter.send(thread.target, text);
  threadMessages.record(thread.id, 'out', externalId, { name: agents.get(agentId)?.name }, text);
  origin.replied = true;
  return { sent: true, parts: 1 };
}

/** `channel_react`: puts an emoji on the message the agent is handling. What counts as a valid emoji depends on the platform (see `ChannelAdapter.reactions`). */
export async function channelReact(agentId: string, emoji: unknown): Promise<{ reacted: boolean; emoji: string }> {
  if (!agents.get(agentId)) throw new ChannelError('Unknown agent');
  const e = String(emoji ?? '').trim();
  if (!e || e.length > 16) throw new ChannelError('Give one emoji');
  const origin = liveOrigin(agentId);
  if (!origin?.messageId) throw new ChannelError('No channel message is being handled right now, so there is nothing to react to.');
  const adapter = running.get(origin.connectionId);
  if (!adapter?.react) throw new ChannelError('This connection cannot react to messages. Answer with channel_reply instead.');
  const thread = threads.get(origin.threadId);
  if (!thread) throw new ChannelError('The thread no longer exists.');
  try { await adapter.react(thread.target, origin.messageId, e); }
  catch (err) { throw new ChannelError(err instanceof Error ? err.message : 'The reaction failed'); }
  origin.replied = true;   // a reaction can be the whole answer ("ok", "thanks")
  return { reacted: true, emoji: e };
}

/** `channel_send_file`: sends a file from the agent's working folder (or inbox) to the thread of the message it is handling. */
export async function channelSendFile(agentId: string, path: string, caption?: string): Promise<{ sent: boolean; name: string; kind: string }> {
  const agent = agents.get(agentId);
  if (!agent) throw new ChannelError('Unknown agent');
  const origin = liveOrigin(agentId);
  if (!origin) throw new ChannelError('No channel message is being handled right now, so there is nobody to send the file to.');
  const adapter = running.get(origin.connectionId);
  if (!adapter?.sendFile) throw new ChannelError('This connection cannot send files.');
  const thread = threads.get(origin.threadId);
  if (!thread) throw new ChannelError('The thread no longer exists.');
  const file = resolveSendable(agent, path);   // throws SendError with the reason
  const leak = findSecret(caption ?? '') ?? (TEXTUAL.test(file.name) && file.size <= 2 * 1024 * 1024 ? findSecret(readFileSync(file.path, 'utf8')) : null);
  if (leak) { console.warn(`[connections] blocked a file of agent ${agentId}: it seemed to contain ${leak}`); throw new ChannelError(SECRET_REFUSAL(leak).replace('the message', `the ${caption && findSecret(caption) ? 'caption' : 'file'}`)); }
  const { externalId } = await adapter.sendFile(thread.target, file, caption?.trim() || undefined);
  threadMessages.record(thread.id, 'out', externalId, { name: agent.name }, `${caption?.trim() ? `${caption.trim()} ` : ''}[sent file: ${file.name}]`);
  origin.replied = true;
  return { sent: true, name: file.name, kind: file.kind };
}
