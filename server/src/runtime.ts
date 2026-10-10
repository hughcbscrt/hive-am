import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { agents, dispatches, resolved } from './db.js';
import { composeInstructions, mcpCaps, notebookBlock } from './instructions.js';
import { runners } from './providers/index.js';
import { notebooks } from './skills/notebook.js';
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
export const liveSource = (id: string) => states.get(id)?.live?.source;
/** Whether the turn running now is the agent's own conversation (not work delegated to it by an orchestrator). */
export const liveIsDirect = (id: string) => states.get(id)?.live?.source === 'user';


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

  const base = composeInstructions(agent, delegated);
  const nbVersion = notebooks.get(agentId).version;
  const instructions = [base, notebookBlock(agent)].filter(Boolean).join('\n\n');
  const hash = createHash('sha1').update(base).digest('hex').slice(0, 16);
  // The conversation is re-sent the instructions when its configuration changed, or when the notes were edited behind its back (by the user, or in another conversation).
  const refreshInstructions = !delegated && !!agent.session_id && (raw.instr_hash !== hash || notebooks.get(agentId).seen < nbVersion);

  let text = '';
  let summary: string | undefined;
  let error: string | undefined;
  const push = (event: StreamEvent) => { s.live?.events.push(event); emit({ kind: 'event', agentId, turnId, event }); };

  try {
    const stream = runners[agent.provider]({
      agent, prompt, signal: controller.signal,
      instructions, refreshInstructions,
      mcpCaps: mcpCaps(agent), effort: origin?.effort,
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
  if (!error && !delegated && !controller.signal.aborted) { agents.setInstrHash(agentId, hash); notebooks.markSeen(agentId, nbVersion); }
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
