import { syncChannelSkill } from '../connections/channel-skill.js';
import { connectionStatus, startConnection, stopConnection } from '../connections/manager.js';
import { mergeConfig, publicConnection } from '../connections/public.js';
import { connections } from '../connections/store.js';
import type { AllowedUser, ChannelKind } from '../connections/types.js';
import { notifyAgentsChanged } from '../runtime.js';
import { bad, notFound } from '../http/errors.js';
import type { Body } from '../http/body.js';
import { CONNECTION_KINDS, isRecord, trimmed, validateConnection, type ConnConfig } from '../http/validate.js';

/** Ids with an optional name: trimmed, de-duplicated, blanks dropped. */
function cleanIds(list: unknown[]): { id: string; name?: string }[] {
  const seen = new Set<string>();
  return list
    .map((c: unknown) => { const r = isRecord(c) ? c : {}; return { id: trimmed(r.id), name: r.name ? String(r.name).trim() : undefined }; })
    .filter((c) => c.id && !seen.has(c.id) && seen.add(c.id));
}
/** One group's mode: `everyone` (or nothing) keeps the entry as `{ id, name }`; `members` keeps its cleaned list; anything else is left for validation to refuse. */
function cleanChat(c: unknown) {
  const r = isRecord(c) ? c : {};
  const [chat] = cleanIds([r]);
  if (!chat || r.mode === undefined || r.mode === null || r.mode === 'everyone') return chat;
  if (r.mode !== 'members') return { ...chat, mode: r.mode, members: r.members };
  return { ...chat, mode: 'members', members: Array.isArray(r.members) ? cleanIds(r.members) : r.members ?? [] };
}
/** Group ids and alias names from the form: trimmed, de-duplicated, blanks dropped. */
function cleanGroupConfig(config: ConnConfig): ConnConfig {
  if (Array.isArray(config.chats)) {
    const seen = new Set<string>();
    config.chats = config.chats.map(cleanChat).filter((c) => c && !seen.has(c.id) && seen.add(c.id));
  }
  if (Array.isArray(config.aliases)) config.aliases = [...new Set(config.aliases.map((x: unknown) => String(x).trim()).filter(Boolean))];
  return config;
}
const cleanAllowed = (v: unknown): AllowedUser[] => (Array.isArray(v) ? v : [])
  .map((u: unknown) => { const r = isRecord(u) ? u : {}; return { id: trimmed(r.id), name: r.name ? String(r.name) : undefined, admin: !!r.admin }; })
  .filter((u) => u.id);
const incomingConfig = (v: unknown) => (isRecord(v) ? v : undefined);
const sameName = (name: string, exceptId?: string) => connections.list().some((c) => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase());

export async function createConnection(p: Body) {
  const kind = p.kind as ChannelKind;
  if (!(CONNECTION_KINDS as readonly string[]).includes(kind)) throw bad(`Kind must be one of: ${CONNECTION_KINDS.join(', ')}`);
  const name = trimmed(p.name); if (!name) throw bad('Name is required');
  if (sameName(name)) throw bad(`A connection named "${name}" already exists`);
  const config = cleanGroupConfig(mergeConfig({}, incomingConfig(p.config))); const enabled = p.enabled !== false;
  const agentId = (p.agent_id as string | null | undefined) || null;
  validateConnection(kind, config, agentId, enabled);
  const c = connections.create({ kind, name, agent_id: agentId, config, allowed: cleanAllowed(p.allowed), enabled });
  syncChannelSkill(c.agent_id);
  await startConnection(c.id); notifyAgentsChanged();
  return publicConnection(connections.get(c.id)!);
}

export async function updateConnection(id: string, p: Body) {
  const cur = connections.get(id); if (!cur) throw notFound('Connection not found');
  const name = p.name !== undefined ? trimmed(p.name) : cur.name; if (!name) throw bad('Name is required');
  if (name.toLowerCase() !== cur.name.toLowerCase() && sameName(name)) throw bad(`A connection named "${name}" already exists`);
  const config = cleanGroupConfig(mergeConfig(cur.config, incomingConfig(p.config)));
  const agent_id = p.agent_id !== undefined ? ((p.agent_id as string | null) || null) : cur.agent_id;
  const enabled = p.enabled !== undefined ? !!p.enabled : cur.enabled;
  validateConnection(cur.kind, config, agent_id, enabled);
  connections.update(cur.id, { name, config, agent_id, enabled, allowed: p.allowed !== undefined ? cleanAllowed(p.allowed) : cur.allowed });
  syncChannelSkill(cur.agent_id, agent_id);
  await startConnection(cur.id); notifyAgentsChanged();
  return publicConnection(connections.get(cur.id)!);
}

export async function removeConnection(id: string): Promise<void> {
  await stopConnection(id);
  const gone = connections.get(id);
  if (!connections.remove(id)) throw notFound('Connection not found');
  syncChannelSkill(gone?.agent_id);
  notifyAgentsChanged();
}

export async function restartConnection(id: string) {
  if (!connections.get(id)) throw notFound('Connection not found');
  await startConnection(id);
  return { status: connectionStatus(id) };
}
