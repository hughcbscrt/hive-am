import type { Agent, ChatMessage } from '../types.js';
import { readClaude } from './claude.js';
import { readOpencode } from './opencode.js';
import { readKiro } from './kiro.js';

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
