export type Provider = 'claude' | 'opencode' | 'kiro';
export type Role = 'orchestrator' | 'worker';
export type Permission = 'plan' | 'acceptEdits' | 'bypassPermissions';
export type AgentStatus = 'idle' | 'running' | 'error';

export interface AgentType {
  id: string;
  name: string;
  description: string;
  role: Role;
  provider: Provider;
  model: string;
  system_prompt: string;
  permission: Permission;
  color: string;
  skill_ids: string[];
  created_at: number;
}

/** Fields a colony can lend to its agents. Provider and model are never inherited. */
export type InheritField = 'cwd' | 'permission' | 'skills' | 'prompt';
export type InheritFlags = Record<InheritField, boolean>;

export interface Colony {
  id: string;
  name: string;
  color: string;
  cwd: string;
  permission: Permission;
  /** Shared context, placed before each member's own prompt. */
  system_prompt: string;
  skill_ids: string[];
  /** Which fields members follow by default. A member can opt out per field. */
  inherit: InheritFlags;
  agent_ids: string[];
  created_at: number;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  role: Role;
  type_id: string | null;
  provider: Provider;
  model: string;
  system_prompt: string;
  permission: Permission;
  cwd: string;
  colony_id: string | null;
  /** Fields where this agent ignores its colony and uses its own value. */
  overrides: InheritField[];
  /** What actually runs: own values merged with the colony's according to inherit/overrides. */
  effective: { cwd: string; permission: Permission; system_prompt: string; skill_ids: string[]; inherited: InheritField[] };
  /** Native session pointer — the conversation itself lives in the CLI's own store. */
  session_id: string | null;
  /** Folder the session was created in; resuming from another folder would fail. */
  session_cwd: string | null;
  /** Fingerprint of the instructions the current session last received (CLIs without a system-prompt flag only see them in messages). */
  instr_hash: string | null;
  status: AgentStatus;
  skill_ids: string[];
  /** Workers this orchestrator may dispatch to (only meaningful for orchestrators). */
  worker_ids: string[];
  created_at: number;
  updated_at: number;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
  created_at: number;
  updated_at: number;
}

/** What every provider adapter emits while a turn runs. */
export type StreamEvent =
  | { t: 'session'; sessionId: string }
  | { t: 'text'; delta: string }
  | { t: 'thinking'; delta: string }
  | { t: 'tool'; id: string; name: string; input: unknown }
  | { t: 'tool_result'; id: string; output: string; error?: boolean }
  | { t: 'usage'; usage: Partial<Usage>; cost?: number; model?: string; durationMs?: number }
  | { t: 'done'; ok: boolean; summary?: string }
  | { t: 'error'; message: string };

export interface Usage {
  input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number;
  /** Kiro bills in credits rather than tokens. */
  credits?: number;
  /** Kiro reports how full the context window is. */
  contextPct?: number;
}
export interface MsgMeta { model?: string; usage?: Usage; /** USD; estimated unless the CLI reports it. */ cost?: number; costEstimated?: boolean; endTs?: number }

export type Block =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; id: string; name: string; input: unknown; output?: string; error?: boolean; durationMs?: number };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  ts: number | null;
  blocks: Block[];
  meta?: MsgMeta;
}

export interface TurnOptions {
  agent: Agent;
  prompt: string;
  /** Composed system prompt (agent prompt + skills). */
  instructions: string;
  /** The session already received older instructions; send the new ones before this message. */
  refreshInstructions?: boolean;
  /** Hive MCP tool groups this agent gets (`dispatch`, `channel`); empty means no hive MCP at all. */
  mcpCaps: string[];
  signal: AbortSignal;
}
