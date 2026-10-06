export type Provider = 'claude' | 'opencode' | 'kiro';
export type Role = 'orchestrator' | 'worker';
export type Permission = 'plan' | 'acceptEdits' | 'bypassPermissions';

export type InheritField = 'cwd' | 'permission' | 'skills' | 'prompt';
export type InheritFlags = Record<InheritField, boolean>;
export interface Colony {
  id: string; name: string; color: string; cwd: string; permission: Permission; system_prompt: string;
  skill_ids: string[]; inherit: InheritFlags; agent_ids: string[]; created_at: number;
}
export interface Agent {
  id: string; name: string; description: string; role: Role; type_id: string | null;
  provider: Provider; model: string; system_prompt: string; permission: Permission; cwd: string;
  colony_id: string | null; overrides: InheritField[];
  effective: { cwd: string; permission: Permission; system_prompt: string; skill_ids: string[]; inherited: InheritField[] };
  session_id: string | null; status: 'idle' | 'running' | 'error';
  skill_ids: string[]; worker_ids: string[]; created_at: number; updated_at: number;
  queued?: number; live?: boolean;
}
export interface AgentType {
  id: string; name: string; description: string; role: Role; provider: Provider; model: string;
  system_prompt: string; permission: Permission; color: string; skill_ids: string[]; created_at: number;
}
export interface Skill { id: string; name: string; description: string; content: string; created_at: number; updated_at: number }
export interface ProviderInfo { id: Provider; label: string; installed: boolean; version: string }
export interface ModelInfo { id: string; label: string }

export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; credits?: number; contextPct?: number }
export interface MsgMeta { model?: string; usage?: Usage; cost?: number; costEstimated?: boolean; endTs?: number }
export type Block =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; id: string; name: string; input: unknown; output?: string; error?: boolean; durationMs?: number; startedAt?: number };
export interface ChatMessage { id: string; role: 'user' | 'assistant'; ts: number | null; blocks: Block[]; meta?: MsgMeta }
export interface SessionStats {
  usage: Usage; cost: number | null; costEstimated: boolean; turns: number; toolCalls: number; toolErrors: number; toolTimeMs: number; durationMs: number;
  tools: { name: string; count: number; errors: number; totalMs: number }[];
  models: { model: string; messages: number; output: number }[];
  lastContext: number; contextPct: number | null;
  timeline: { ts: number | null; prompt: string; tokens: number; cost: number | null; durationMs: number; tools: number }[];
}

export type StreamEvent =
  | { t: 'session'; sessionId: string }
  | { t: 'text'; delta: string }
  | { t: 'thinking'; delta: string }
  | { t: 'tool'; id: string; name: string; input: unknown }
  | { t: 'tool_result'; id: string; output: string; error?: boolean }
  | { t: 'usage'; usage: Partial<Usage>; cost?: number; model?: string; durationMs?: number }
  | { t: 'done'; ok: boolean; summary?: string }
  | { t: 'error'; message: string };

export interface SessionRow {
  agent_id: string; agent_name: string; agent_role: Role; provider: Provider; session_id: string; cwd: string;
  first_seen: number; last_seen: number; current: boolean; message_count: number; preview: string;
  usage: Usage; cost: number | null; tool_calls: number; model: string | null;
  kind: 'direct' | 'delegation'; from_name: string | null; task: string | null;
}
export interface Dispatch { id: string; from_id: string; to_id: string; task: string; status: string; result: string | null; created_at: number; finished_at: number | null }

// ---- read-only git explorer ----
export type GitChangeStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict' | 'typechange';
export interface GitChange {
  path: string; oldPath?: string; status: GitChangeStatus; staged: boolean; unstaged: boolean;
  additions: number | null; deletions: number | null; binary: boolean;
}
export type GitStatus =
  | { isRepo: false; reason: 'no-git' | 'not-repo' | 'error'; message: string; cwd: string }
  | {
      isRepo: true; cwd: string; root: string; scope: string; branch: string | null; detached: boolean;
      head: { sha: string; subject: string; when: string; author: string } | null;
      upstream: { ahead: number; behind: number } | null;
      changes: GitChange[]; truncated: boolean; generatedAt: number; state: 'merge' | 'rebase' | 'stash' | null; mergeMsg: string; stash: { ref: string; sha: string; from: string; to: string } | null;
    };
export type GitTree = { isRepo: false; reason: string; message: string } | { isRepo: true; root: string; scope: string; files: string[]; truncated: boolean };
export interface GitDiffResult { path: string; diff: string; truncated: boolean; binary: boolean }
export interface GitFileResult { path: string; size: number; binary: boolean; truncated: boolean; content: string; source: 'worktree' | 'head' }

export interface GitCommitInfo { sha: string; short: string; author: string; date: string; subject: string; refs: string[]; merge: boolean }
export interface GitCommitFile { path: string; oldPath?: string; status: 'modified' | 'added' | 'deleted' | 'renamed' | 'typechange'; additions: number | null; deletions: number | null }
export interface GitCommitDetail { sha: string; author: string; email: string; date: string; message: string; files: GitCommitFile[]; truncated: boolean }
export interface GitBranches { current: string | null; local: { name: string; upstream: string | null; date: string; subject: string }[]; remote: { name: string; date: string; subject: string }[] }
export interface GitBlame { path: string; commits: Record<string, { short: string; author: string; time: number; summary: string; uncommitted: boolean }>; lines: string[]; truncated: boolean }

export interface SwitchPlan { from: string; to: string; carried: number; overlap: string[]; collisions: string[]; others: { id: string; name: string }[]; selfRunning: boolean }
export interface StashItem { sha: string; message: string; branch: string; date: string; smart: boolean }
export interface StashDetail { sha: string; untrackedSha: string | null; untracked: string[] }
