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

/** Kiro agent profile (~/.kiro/agents/<name>.json): Kiro only loads MCP servers from config files, so each orchestrator gets its own profile. */
export const dispatchKiroProfile = (agentId: string, name: string, caps: string[]) => ({
  name, description: 'hive-am orchestrator profile (generated)', prompt: null,
  mcpServers: { hive: { command: process.execPath, args: [script], env: env(agentId, caps) } },
  tools: ['*'], allowedTools: ['@hive'], includeMcpJson: false,
});
