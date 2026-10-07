import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { agents, colonies, skills, dispatches, resolved } from './db.js';
import { runners } from './providers/index.js';
import { connections } from './connections/store.js';
import type { Origin } from './connections/types.js';
import type { Agent, StreamEvent } from './types.js';

export type BusMessage =
  | { kind: 'event'; agentId: string; turnId: string; event: StreamEvent }
  | { kind: 'turn_start'; agentId: string; turnId: string; prompt: string; source: 'user' | 'dispatch'; from?: string; channel?: { platform: string; place: string; user: string } }
  | { kind: 'status'; agentId: string; status: 'idle' | 'running' | 'error' | 'queued'; queued: number }
  | { kind: 'agents_changed' };

export const bus = new EventEmitter();
bus.setMaxListeners(0);
const emit = (m: BusMessage) => bus.emit('msg', m);
export const notifyAgentsChanged = () => emit({ kind: 'agents_changed' });

interface Live { turnId: string; prompt: string; events: StreamEvent[]; source: 'user' | 'dispatch'; origin?: Origin }
interface State { chain: Promise<unknown>; controller: AbortController | null; queued: number; live: Live | null }
const states = new Map<string, State>();
const st = (id: string): State => {
  let s = states.get(id);
  if (!s) states.set(id, (s = { chain: Promise.resolve(), controller: null, queued: 0, live: null }));
  return s;
};

export const liveTurn = (id: string) => states.get(id)?.live ?? null;
export const queueDepth = (id: string) => states.get(id)?.queued ?? 0;
/** The channel message the agent is answering right now, if the running turn came from one. */
export const liveOrigin = (id: string) => states.get(id)?.live?.origin;

/** Which hive tools an agent gets: `dispatch` (orchestrator with a team) and `channel` (linked to an external connection). */
export function mcpCaps(a: Agent): string[] {
  const caps: string[] = [];
  if (a.role === 'orchestrator' && a.worker_ids.length > 0) caps.push('dispatch');
  if (connections.forAgent(a.id).length > 0) caps.push('channel');
  return caps;
}

/** How each CLI names the hive delegation tools. OpenCode exposes MCP tools through `tools.<server>.<tool>`. */
function toolNames(provider: Agent['provider']) {
  return provider === 'opencode'
    ? { dispatch: 'tools.hive.dispatch', list: 'tools.hive.list_agents', reply: 'tools.hive.channel_reply' }
    : provider === 'kiro'
      ? { dispatch: '@hive/dispatch', list: '@hive/list_agents', reply: '@hive/channel_reply' }
      : { dispatch: 'mcp__hive__dispatch', list: 'mcp__hive__list_agents', reply: 'mcp__hive__channel_reply' };
}

export function composeInstructions(a: Agent, delegated = false): string {
  const parts: string[] = [];

  // Identity first: the underlying CLI has its own persona, but inside hive-am this agent has a name and a place.
  const col = a.colony_id ? colonies.get(a.colony_id) : undefined;
  const id: string[] = [
    `## Who you are`,
    `You are **${a.name}**, ${a.role === 'orchestrator' ? 'an orchestrator' : 'a worker'} agent in a hive-am colony of coding agents.${a.description ? ` Your purpose: ${a.description}` : ''}`,
    `If someone asks who you are, answer as ${a.name} (${a.role}) and describe your purpose. Do not introduce yourself as the underlying CLI or model.`,
    `Your working folder is \`${a.cwd}\`. Everything you read, write or run happens there unless you are told otherwise.`,
  ];
  if (col) id.push(`You belong to the colony "${col.name}"${col.cwd ? `, whose shared folder is \`${col.cwd}\`` : ''}. Colony-wide rules appear below when they apply.`);
  if (delegated) id.push('This request was delegated to you by an orchestrator. Do the task fully and finish with a short, self-contained report: what you did, what you found, what is left.');
  parts.push(id.join('\n'));

  if (a.system_prompt.trim()) parts.push(a.system_prompt.trim());
  for (const sid of a.skill_ids) {
    const s = skills.get(sid);
    if (s?.content.trim()) parts.push(`## Skill: ${s.name}\n${s.description ? `_${s.description}_\n\n` : ''}${s.content.trim()}`);
  }

  if (a.role === 'orchestrator') {
    const tn = toolNames(a.provider);
    const team = a.worker_ids.map((wid) => agents.get(wid)).filter(Boolean);
    if (team.length) {
      const roster = team.map((w) => `- **${w!.name}**${w!.description ? `: ${w!.description}` : ''}`).join('\n');
      parts.push(`## Your team\nThese are your subagents — the ONLY agents you can delegate to:\n${roster}\n\nDelegate with the \`dispatch\` tool (${tn.dispatch}) instead of doing their work yourself, then synthesize their answers. Always use it: never play a subagent's role yourself, and never use a generic built-in subagent in its place — a subagent is a separate real agent with its own session. Each delegation starts a fresh conversation for that subagent, so put all the context it needs in the task. Your team can change at any time: when asked which agents you have or can delegate to, call the \`list_agents\` tool (${tn.list}) and report exactly what it returns, never an older list from memory. Never mention or try to use agents outside that list.`);
    } else {
      parts.push('## Your team\nYou currently have no subagents connected to you, so you cannot delegate. If asked, say so; do not claim to know other agents.');
    }
  }

  const links = connections.forAgent(a.id);
  if (links.length) {
    const names = [...new Set(links.map((c) => ({ telegram: 'Telegram', slack: 'Slack', fake: 'Test' })[c.kind]))].join(' / ');
    parts.push(`## Messages from ${names}\nPeople can write to you from ${names}. Those messages start with a header line \`[hive:channel] …\` that says the platform, place, thread and sender. **Your normal text is not delivered to them**: to answer, call the \`channel_reply\` tool (${toolNames(a.provider).reply}) with the text; it goes to the thread of the message you are handling. You can call it more than once (e.g. a short heads-up before long work, then the result). Keep replies short and conversational, use plain Markdown, and never use interactive question tools. Messages in other threads share this same conversation, so answer only the message you are handling now.`);
  }
  return parts.join('\n\n');
}

export interface TurnResult { ok: boolean; text: string; error?: string }

/** Queue a prompt for an agent. Turns for one agent run strictly one at a time. */
export function sendTurn(agentId: string, prompt: string, source: 'user' | 'dispatch' = 'user', from?: string, dispatchId?: string, origin?: Origin): Promise<TurnResult> {
  const s = st(agentId);
  s.queued++;
  emit({ kind: 'status', agentId, status: s.live ? 'running' : 'queued', queued: s.queued });
  const job = s.chain.then(() => execute(agentId, prompt, source, from, dispatchId, origin));
  s.chain = job.catch(() => undefined);
  return job;
}

async function execute(agentId: string, prompt: string, source: 'user' | 'dispatch', from?: string, dispatchId?: string, origin?: Origin): Promise<TurnResult> {
  const s = st(agentId);
  s.queued--;
  const raw = agents.get(agentId);
  if (!raw) return { ok: false, text: '', error: 'Agent no longer exists' };
  const agent = resolved(raw);
  if (!agent.cwd) return { ok: false, text: '', error: 'This agent has no working folder. Set one on the agent or on its colony.' };
  const delegated = source === 'dispatch';
  if (delegated) {
    // Every delegation gets its own native session, so the agent's direct conversation never fills up with delegated work.
    agent.session_id = null;
  } else if (raw.session_id && raw.session_cwd && raw.session_cwd !== agent.cwd) {
    // Native sessions are tied to the folder they started in; if the folder changed, start a fresh one.
    agents.setSession(raw, null); agent.session_id = null; emit({ kind: 'agents_changed' });
  }

  const turnId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const controller = new AbortController();
  s.controller = controller;
  s.live = { turnId, prompt, events: [], source, origin };
  agents.setStatus(agentId, 'running');
  emit({ kind: 'turn_start', agentId, turnId, prompt, source, from, channel: origin && { platform: origin.platform, place: origin.place, user: origin.userName } });
  emit({ kind: 'status', agentId, status: 'running', queued: s.queued });

  const instructions = composeInstructions(agent, delegated);
  const hash = createHash('sha1').update(instructions).digest('hex').slice(0, 16);
  const refreshInstructions = !delegated && !!agent.session_id && raw.instr_hash !== hash;

  let text = '';
  let summary: string | undefined;
  let error: string | undefined;
  const push = (event: StreamEvent) => { s.live?.events.push(event); emit({ kind: 'event', agentId, turnId, event }); };

  try {
    const stream = runners[agent.provider]({
      agent, prompt, signal: controller.signal,
      instructions, refreshInstructions,
      mcpCaps: mcpCaps(agent),
    });
    for await (const ev of stream) {
      if (ev.t === 'session') {
        if (delegated) { agents.recordSession(agent, ev.sessionId, 'delegation', from, prompt); if (dispatchId) dispatches.setSession(dispatchId, ev.sessionId); }
        else { agents.setSession(agent, ev.sessionId); agent.session_id = ev.sessionId; }
        emit({ kind: 'agents_changed' });
      }
      else if (ev.t === 'text') text += ev.delta;
      else if (ev.t === 'tool') text = '';           // keep only the text after the last tool call as the "final answer"
      else if (ev.t === 'done') { summary = ev.summary; }
      else if (ev.t === 'error') error = ev.message;
      push(ev);
    }
  } catch (e) {
    if (!controller.signal.aborted) { error = e instanceof Error ? e.message : String(e); push({ t: 'error', message: error }); }
  }

  if (controller.signal.aborted && !error) push({ t: 'done', ok: false, summary: 'Stopped' });
  s.controller = null;
  s.live = null;
  if (!error && !delegated && !controller.signal.aborted) agents.setInstrHash(agentId, hash);
  agents.setStatus(agentId, error ? 'error' : 'idle');
  emit({ kind: 'status', agentId, status: error ? 'error' : 'idle', queued: s.queued });
  return { ok: !error && !controller.signal.aborted, text: (summary ?? text).trim(), error: error ?? (controller.signal.aborted ? 'Stopped' : undefined) };
}

export function stopAgent(agentId: string, clearQueue = true): boolean {
  const s = states.get(agentId);
  if (!s?.controller) return false;
  s.controller.abort();
  return true;
}

/** Orchestrator → worker delegation. Enforces the explicit assignment rule. */
export async function dispatch(fromId: string, workerName: string, task: string): Promise<TurnResult> {
  const from = agents.get(fromId);
  if (!from) throw new Error('Unknown orchestrator');
  const worker = agents.byName(workerName);
  if (!worker) throw new Error(`No agent named "${workerName}"`);
  if (!from.worker_ids.includes(worker.id)) throw new Error(`"${worker.name}" is not assigned to ${from.name}`);
  const id = dispatches.start(from.id, worker.id, task);
  const res = await sendTurn(worker.id, task, 'dispatch', from.id, id);
  dispatches.finish(id, res.ok ? 'done' : 'failed', res.text || res.error || '');
  return res;
}
