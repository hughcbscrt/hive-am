import { agents, resolved } from '../db.js';
import { mcpCaps } from '../instructions.js';
import { liveOrigin } from '../runtime.js';
import { NOTEBOOK_MAX, notebooks } from '../skills/notebook.js';
import { NOTEBOOK_SKILL_ID } from '../skills/defaults.js';
import type { Agent } from '../types.js';
import { bad } from '../http/errors.js';

/**
 * Who a note came from, so it can be audited: the date plus, for chat turns, where and who. In a notebook that several agents share it also
 * says which agent wrote it: "who wrote this" is what tells a useful note from a mystery.
 */
export function noteSource(agentId: string): string {
  const day = new Date().toISOString().slice(0, 10), o = liveOrigin(agentId);
  const who = notebooks.sharedWith(agentId).length ? agents.get(agentId)?.name : undefined;
  return [day, who, o ? `${o.platform}: ${o.userName}` : ''].filter(Boolean).join(' · ');
}
/** The agent behind a notebook tool call: it must exist and have the Notebook skill. */
export function notebookAgent(from: unknown): Agent {
  const agent = agents.get(String(from ?? '')); if (!agent) throw bad('Unknown agent');
  if (!mcpCaps(resolved(agent)).includes('memory')) throw bad('This agent does not have the Notebook skill.');
  return agent;
}
export const nbView = (n: { content: string; version: number }) => ({ content: n.content, version: n.version, size: n.content.length, max: NOTEBOOK_MAX });
export const notebookEnabled = (a: Agent) => resolved(a).skill_ids.includes(NOTEBOOK_SKILL_ID);
