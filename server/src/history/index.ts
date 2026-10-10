import type { Agent, ChatMessage } from '../types.js';
import { claudeSig, readClaude } from './claude.js';
import { opencodeSig, readOpencode } from './opencode.js';
import { kiroSig, readKiro } from './kiro.js';

/** The conversation lives in each CLI's own store; hive-am only keeps the pointer. */
export function readHistory(a: Pick<Agent, 'provider' | 'cwd' | 'session_id'>, sessionId = a.session_id): ChatMessage[] {
  if (!sessionId) return [];
  try {
    switch (a.provider) {
      case 'claude': return readClaude(a.cwd, sessionId);
      case 'opencode': return readOpencode(sessionId);
      case 'kiro': return readKiro(sessionId);
    }
  } catch (e) {
    console.error('[history]', a.provider, sessionId, e);
    return [];
  }
}

/** A cheap fingerprint of a conversation: it only changes when something was added to it. `null` when it cannot be found. */
export function historySig(a: Pick<Agent, 'provider' | 'cwd'>, sessionId: string): string | null {
  try {
    switch (a.provider) {
      case 'claude': return claudeSig(a.cwd, sessionId);
      case 'opencode': return opencodeSig(sessionId);
      case 'kiro': return kiroSig(sessionId);
    }
  } catch { return null; }
}
