import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const API_PORT = Number(process.env.HIVE_AM_PORT ?? 4400);
const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'dispatch.mjs');
const env = (agentId: string, caps: string[]) => ({ HIVE_AGENT_ID: agentId, HIVE_AM_API: `http://127.0.0.1:${API_PORT}`, HIVE_CAPS: caps.join(',') });

/** Claude Code --mcp-config shape (server name "hive" → tools prefixed mcp__hive__). */
export const dispatchMcpConfig = (agentId: string, caps: string[]) => ({
  mcpServers: { hive: { command: process.execPath, args: [script], env: env(agentId, caps) } },
});

/** OpenCode config (OPENCODE_CONFIG_CONTENT) shape. */
export const dispatchMcpConfigOpencode = (agentId: string, caps: string[]) => ({
  mcp: { hive: { type: 'local', command: [process.execPath, script], environment: env(agentId, caps), enabled: true } },
});

/** What a Kiro profile trusts and which paths it may write (`toolsSettings`, the format Kiro 2.x reads; `permissions.rules` is 3.x only). */
export interface KiroAccess { trusted: string[]; toolsSettings?: Record<string, unknown> }

/**
 * Kiro agent profile (~/.kiro/agents/<name>.json). Kiro only loads MCP servers from config files, so an agent with hive tools gets its
 * own profile; so does one with path limits. With a profile `--trust-tools` no longer applies: what is trusted is listed here.
 */
export const kiroProfile = (agentId: string, name: string, caps: string[], access: KiroAccess = { trusted: [] }) => ({
  name, description: 'hive-am agent profile (generated)', prompt: null,
  mcpServers: caps.length ? { hive: { command: process.execPath, args: [script], env: env(agentId, caps) } } : {},
  tools: ['*'], allowedTools: [...access.trusted, ...(caps.length ? ['@hive'] : [])], includeMcpJson: false,
  ...(access.toolsSettings ? { toolsSettings: access.toolsSettings } : {}),
});
