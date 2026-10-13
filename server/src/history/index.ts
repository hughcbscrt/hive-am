import type { Agent, ChatMessage, Provider } from '../types.js';
import { claudeSig, readClaude } from './claude.js';
import { opencodeSig, readOpencode } from './opencode.js';
import { kiroSig, readKiro } from './kiro.js';

/** How a CLI's own transcript store is read. The conversation lives there; hive-am only keeps the pointer. */
export interface HistoryReader {
  read(cwd: string, sessionId: string): ChatMessage[];
  /** A cheap fingerprint of a conversation: it only changes when something was added to it. `null` when it cannot be found. */
  sig(cwd: string, sessionId: string): string | null;
}

export const historyReaders: Record<Provider, HistoryReader> = {
  claude: { read: readClaude, sig: claudeSig },
  opencode: { read: (_cwd, id) => readOpencode(id), sig: (_cwd, id) => opencodeSig(id) },
  kiro: { read: (_cwd, id) => readKiro(id), sig: (_cwd, id) => kiroSig(id) },
};

export function readHistory(a: Pick<Agent, 'provider' | 'cwd' | 'session_id'>, sessionId = a.session_id): ChatMessage[] {
  if (!sessionId) return [];
  try { return historyReaders[a.provider].read(a.cwd, sessionId); }
  catch (e) {
    console.error('[history]', a.provider, sessionId, e);
    return [];
  }
}

export function historySig(a: Pick<Agent, 'provider' | 'cwd'>, sessionId: string): string | null {
  try { return historyReaders[a.provider].sig(a.cwd, sessionId); } catch { return null; }
}
