import { readFileSync } from 'node:fs';
import { agents } from '../db.js';
import { liveOrigin, notifyAgentsChanged } from '../runtime.js';
import { cleanInbox } from './files.js';
import { resolveSendable } from './outbound.js';
import { syncChannelSkill } from './channel-skill.js';
import { handleInbound } from './router.js';
import { findSecret, SECRET_REFUSAL } from './secrets.js';
import { connections, threadMessages, threads } from './store.js';
import type { AdapterStatus, ChannelAdapter, ChannelKind, Connection } from './types.js';

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

export async function startConnection(id: string): Promise<void> {
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

export const startAll = () => {
  // Received files are kept for a while, then removed.
  cleanInbox();
  setInterval(() => cleanInbox(), 6 * 3_600_000).unref();
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

export class ChannelError extends Error {}

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
