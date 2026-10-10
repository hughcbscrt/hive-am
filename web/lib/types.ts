export type Provider = 'claude' | 'opencode' | 'kiro';
export type Role = 'orchestrator' | 'worker';
export type Permission = 'plan' | 'acceptEdits' | 'bypassPermissions';

export type InheritField = 'cwd' | 'permission' | 'skills' | 'prompt';
export type InheritFlags = Record<InheritField, boolean>;
export interface Colony {
  id: string; name: string; color: string; cwd: string; permission: Permission; system_prompt: string;
  skill_ids: string[]; skill_loads: Record<string, SkillLoad>; inherit: InheritFlags; agent_ids: string[]; created_at: number;
}
export interface Agent {
  id: string; name: string; description: string; role: Role; type_id: string | null;
  provider: Provider; model: string; system_prompt: string; permission: Permission; cwd: string;
  colony_id: string | null; overrides: InheritField[];
  effective: { cwd: string; permission: Permission; system_prompt: string; skill_ids: string[]; skill_loads: Record<string, SkillLoad>; inherited: InheritField[] };
  session_id: string | null; status: 'idle' | 'running' | 'error';
  skill_ids: string[]; skill_loads: Record<string, SkillLoad>; worker_ids: string[]; created_at: number; updated_at: number;
  queued?: number; live?: boolean;
}
export interface AgentType {
  id: string; name: string; description: string; role: Role; provider: Provider; model: string;
  system_prompt: string; permission: Permission; color: string; skill_ids: string[]; skill_loads: Record<string, SkillLoad>; created_at: number;
}
export type SkillLoad = 'always' | 'on_demand';
export interface Skill { id: string; name: string; description: string; content: string; load: SkillLoad; created_at: number; updated_at: number }
export interface NotebookInfo { content: string; version: number; size: number; max: number; updated_at: number; updated_by: string; enabled: boolean; /** The skill that switches the notebook on for an agent. */ skill_id: string }
export interface ProviderInfo { id: Provider; label: string; installed: boolean; version: string }
export type ChannelKind = 'telegram' | 'slack';
export interface ConnectionStatus { state: 'connecting' | 'connected' | 'error' | 'stopped'; detail?: string; lastEventAt?: number }
export interface AllowedUser { id: string; name?: string; admin?: boolean }
/** A connection as the server sends it: credentials arrive as `{ set, hint }`, never as the value. */
export interface Connection {
  id: string; kind: ChannelKind; name: string; agent_id: string | null; enabled: boolean; created_at: number;
  config: Record<string, any>; allowed: AllowedUser[]; status: ConnectionStatus; thread_count: number;
}
export interface AllowedChat { id: string; name?: string }
export interface ConnectionThread { id: string; external_key: string; title: string; last_user: string | null; last_activity: number; created_at: number; muted: boolean }
export type ScheduleRunStatus = 'delivered' | 'failed' | 'skipped_muted' | 'skipped_busy' | 'skipped_missed' | 'skipped_disabled' | 'skipped_reassigned';
/** A recurring schedule (`cron`, `every`) or a pending one-shot wake-up (`once`) an agent set for itself. */
export interface ScheduleItem {
  id: string; agent_id: string; agent_name: string; connection_id: string | null; thread_id: string | null; place: string;
  kind: 'cron' | 'every' | 'once' | 'watch'; expr: string; tz: string; description: string; note: string; enabled: boolean; next_due: number | null;
  created_at: number; last_fired_at: number | null; fire_count: number; last_status: ScheduleRunStatus | null; last_detail: string | null;
}
export interface ScheduleRun { id: number; fired_at: number; status: ScheduleRunStatus; detail: string | null; duration_ms: number | null }
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
  first_seen: number; last_seen: number; current: boolean; /** still being read in the background: size and cost may be missing or old */ pending?: boolean; message_count: number; preview: string;
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
export type GitTree = { isRepo: false; reason: string; message: string } | { isRepo: true; root: string; scope: string; files: string[]; truncated: boolean; ignored: string[] };
export interface GitDiffResult { path: string; diff: string; truncated: boolean; binary: boolean }
export interface GitFileResult { path: string; size: number; binary: boolean; truncated: boolean; content: string; source: 'worktree' | 'head' | 'tag' | 'ref' }

export interface RefInfo { name: string; sha: string; date: string; subject: string }
export interface GitRefs { current: string | null; branches: RefInfo[]; remotes: RefInfo[]; tags: RefInfo[] }
export interface GitCompare {
  base: { ref: string; sha: string }; head: { ref: string; sha: string }; ahead: number; behind: number;
  commits: { sha: string; short: string; author: string; date: string; subject: string }[]; commitsTruncated: boolean;
  files: GitCommitFile[]; truncated: boolean;
}
export interface GrepHit { path: string; line: number; text: string }
export interface GitTagInfo { name: string; sha: string; date: string; subject: string; annotated: boolean }
export interface GitCommitInfo { sha: string; short: string; author: string; date: string; subject: string; refs: string[]; merge: boolean }
export interface GitCommitFile { path: string; oldPath?: string; status: 'modified' | 'added' | 'deleted' | 'renamed' | 'typechange'; additions: number | null; deletions: number | null }
export interface GitCommitDetail { sha: string; author: string; email: string; date: string; message: string; files: GitCommitFile[]; truncated: boolean }
export interface GitBranches { current: string | null; local: { name: string; upstream: string | null; date: string; subject: string }[]; remote: { name: string; date: string; subject: string }[] }
export interface GitBlame { path: string; commits: Record<string, { short: string; author: string; time: number; summary: string; uncommitted: boolean }>; lines: string[]; truncated: boolean }

export interface SwitchPlan { from: string; to: string; carried: number; overlap: string[]; collisions: string[]; others: { id: string; name: string }[]; selfRunning: boolean }
export interface StashItem { sha: string; message: string; branch: string; date: string; smart: boolean }
export interface StashDetail { sha: string; untrackedSha: string | null; untracked: string[] }
export interface GitListing { path: string; entries: { name: string; dir: boolean }[]; truncated: boolean }

// ---- colony objects (servers and Docker containers) ----
export type ObjectKind = 'server' | 'docker' | 'http' | 'boss';
export type ObjectStatus = 'running' | 'starting' | 'stopped' | 'error' | 'unknown' | 'ready';
export interface ServerConfig { cwd: string; start: string; stop?: string; env?: Record<string, string>; port?: number }
export interface DockerConfig {
  mode: 'container' | 'compose' | 'existing';
  image?: string; ports?: string[]; volumes?: string[]; env?: Record<string, string>; restart?: 'no' | 'always' | 'unless-stopped' | 'on-failure'; command?: string;
  file?: string; project?: string; services?: string[]; container?: string;
}
export interface HttpConfig { folder: string; env?: string }
export interface BossConfig { members: string[] }
export interface ObjectState { status: ObjectStatus; detail?: string; pid?: number; since?: number }
export interface ObjectView { id: string; colony_id: string | null; kind: ObjectKind; name: string; config: ServerConfig | DockerConfig | HttpConfig | BossConfig; state: ObjectState; created_at: number; updated_at: number }

// ---- HTTP-requests objects ----
export interface HttpRequestItem { id: string; index: number; name: string; method: string; url: string; headers: { name: string; value: string }[]; body?: string; line: number; variables: string[] }
export interface HttpFile { relFile: string; requests: HttpRequestItem[]; fileVariables: Record<string, string> }
export interface HttpScan { folder: string; files: HttpFile[]; environments: string[]; envFiles: string[]; truncated: boolean }
export interface HttpRun {
  request: { method: string; url: string; headers: { name: string; value: string }[]; body?: string };
  status: number; statusText: string; durationMs: number; size: number; headers: { name: string; value: string }[]; body: string; truncated: boolean; binary: boolean; contentType: string;
}
