import { connectionStatus } from './manager.js';
import { threads } from './store.js';
import type { Connection } from './types.js';

/** Config keys that are credentials: stored, used, but never sent back to the browser. */
export const SECRET_KEYS = ['token', 'bot_token', 'app_token'];

const hint = (v: string) => `••••${v.slice(-4)}`;

/** The connection as the browser sees it: secrets reduced to «set» + last four characters, plus live status. */
export function publicConnection(c: Connection) {
  const config: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c.config)) {
    config[k] = SECRET_KEYS.includes(k) ? (typeof v === 'string' && v ? { set: true, hint: hint(v) } : { set: false }) : v;
  }
  return { ...c, config, status: connectionStatus(c.id), thread_count: threads.forConnection(c.id).length };
}

/** Merges an incoming config over the stored one; a blank or missing secret keeps the stored value. */
export function mergeConfig(current: Record<string, any>, incoming: Record<string, any> | undefined) {
  const next = { ...current };
  for (const [k, v] of Object.entries(incoming ?? {})) {
    if (SECRET_KEYS.includes(k) && (typeof v !== 'string' || !v.trim())) continue;
    next[k] = typeof v === 'string' ? v.trim() : v;
  }
  return next;
}
