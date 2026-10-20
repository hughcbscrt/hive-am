import { existsSync } from 'node:fs';
import { agents, colonies } from '../db.js';
import { validVision } from '../connections/vision.js';
import type { Agent, Colony } from '../types.js';
import { isProvider } from '../services/providers.js';
import { EFFORTS, validEffort } from '../efforts.js';
import { bad } from './errors.js';
import type { Body } from './body.js';

/** Plain value helpers: what a field is when it may be missing or of the wrong type. */
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Text of a field, '' when missing (like `String(v ?? '')`). */
export const text = (v: unknown): string => String(v ?? '');
export const trimmed = (v: unknown): string => text(v).trim();
export const optText = (v: unknown): string | undefined => (v === undefined || v === null || v === '' ? undefined : String(v));
export const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
export const numList = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number) : []);
export const requireName = (v: unknown): string => { const n = trimmed(v); if (!n) throw bad('Name is required'); return n; };
/** The `path` query parameter every git file endpoint needs. */
export const qpath = (url: URL): string => { const p = url.searchParams.get('path'); if (!p) throw bad('path is required'); return p; };
/** A folder that must exist when given. */
const checkFolder = (cwd: unknown) => { if (cwd && (typeof cwd !== 'string' || !existsSync(cwd))) throw bad(`Folder does not exist: ${String(cwd)}`); };

/** What the agent form and the spawn endpoint may send. Checked here; the repository takes it as it is. */
export type AgentInput = Partial<Agent> & { name?: string };
export function validateAgentInput(p: Body, partial = false): AgentInput {
  if (!partial || p.name !== undefined) requireName(p.name);
  if (p.provider !== undefined && !isProvider(p.provider)) throw bad(`Unknown provider "${text(p.provider)}"`);
  if (p.role !== undefined && !['orchestrator', 'worker'].includes(p.role as string)) throw bad('Role must be orchestrator or worker');
  checkFolder(p.cwd);
  if (p.browser !== undefined && typeof p.browser !== 'boolean') throw bad('browser must be true or false');
  if (p.effort !== undefined && (typeof p.effort !== 'string' || p.effort.length > 24)) throw bad('effort must be text');
  if (p.colony_id && (typeof p.colony_id !== 'string' || !colonies.get(p.colony_id))) throw bad('That colony no longer exists');
  return p as AgentInput;
}

export type ColonyInput = Partial<Colony> & { name?: string };
export function validateColony(p: Body, partial = false): ColonyInput {
  if (!partial || p.name !== undefined) requireName(p.name);
  checkFolder(p.cwd);
  return p as ColonyInput;
}

export type ConnConfig = Record<string, unknown>;
const MAX_CHATS = 50;
const MAX_CHAT_MEMBERS = 50;
/** What a person's id looks like on each platform: Telegram user ids are positive numbers; Slack member ids are `U…` (or `W…` on Enterprise Grid). */
const MEMBER_ID: Record<string, RegExp> = { telegram: /^\d+$/, slack: /^[UW][A-Z0-9]{2,}$/ };
/** One authorized group: its mode, and when it only admits some people, who they are. */
function validateChat(kind: string, c: unknown): void {
  const r = isRecord(c) ? c : {};
  if (r.mode !== undefined && r.mode !== 'everyone' && r.mode !== 'members') throw bad('chat mode must be everyone or members');
  if (r.members === undefined) return;
  if (!Array.isArray(r.members) || r.members.length > MAX_CHAT_MEMBERS) throw bad(`a chat can list at most ${MAX_CHAT_MEMBERS} members`);
  const shape = MEMBER_ID[kind];
  if (shape && r.members.some((m) => !shape.test(trimmed(isRecord(m) ? m.id : m)))) throw bad('member ids must be numbers on Telegram and start with U or W on Slack');
}
export const CONNECTION_KINDS = ['telegram', 'slack'] as const;
const REQUIRED: Record<string, string[]> = { telegram: ['token'], slack: ['bot_token', 'app_token'] };
export function validateConnection(kind: string, config: ConnConfig, agentId: string | null | undefined, enabled: boolean): void {
  const missing = (REQUIRED[kind] ?? []).filter((k) => typeof config[k] !== 'string' || !(config[k] as string).trim());
  if (missing.length) throw bad(`Missing: ${missing.join(', ')}`);
  if (config.effort !== undefined && config.effort !== '' && !validEffort(config.effort)) throw bad(`effort must be empty or one of ${EFFORTS.join(', ')}`);
  if (config.on_silent !== undefined && !['notice', 'send_text', 'ignore'].includes(config.on_silent as string)) throw bad('on_silent must be notice, send_text or ignore');
  if (config.group_mode !== undefined && !['mention', 'open'].includes(config.group_mode as string)) throw bad('group_mode must be mention or open');
  if (config.vision !== undefined && config.vision !== null && !validVision(config.vision)) throw bad('vision must be { provider, model } or empty');
  if (config.chats !== undefined && (!Array.isArray(config.chats) || config.chats.length > MAX_CHATS)) throw bad(`chats must be a list of at most ${MAX_CHATS} groups`);
  if (Array.isArray(config.chats)) for (const c of config.chats) validateChat(kind, c);
  if (config.aliases !== undefined && (!Array.isArray(config.aliases) || config.aliases.length > 10)) throw bad('aliases must be a list of at most 10 names');
  if (agentId) {
    const a = agents.get(agentId); if (!a) throw bad('That agent no longer exists');
    if (enabled && a.effective.permission === 'plan') throw bad(`"${a.name}" is in Plan mode and cannot reply. Give it "Edit files" permission first.`);
  }
}
