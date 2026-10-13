import type { IncomingMessage } from 'node:http';
import { forbidden } from './errors.js';

const LOOPBACK = ['localhost', '127.0.0.1', '[::1]', '::1'];
const loop = (h: string) => LOOPBACK.includes(h.replace(/:\d+$/, '').toLowerCase());
const hostOf = (origin: string) => { try { const h = new URL(origin).hostname; return h === '::1' ? '[::1]' : h; } catch { return null; } };

/** The browser's origin (when it sends one) is this machine, or the same name the request was addressed to. Programs (curl, the MCP) send no origin. */
export function originIsLocal(req: IncomingMessage): boolean {
  const origin = req.headers.origin; if (!origin) return true;
  const host = hostOf(origin); if (host === null) return false;
  const own = String(req.headers.host ?? '').replace(/:\d+$/, '');
  return loop(host) || host === own;
}

/**
 * Only a page or a program of this machine: the Host must be a loopback name (a page that reached us through another name, DNS rebinding,
 * is refused) and a browser's origin must be loopback too. Used by terminals (REST and WebSocket).
 */
export function isLocalRequest(req: IncomingMessage): boolean {
  if (!loop(String(req.headers.host ?? ''))) return false;
  const origin = req.headers.origin;
  if (origin) { const h = hostOf(origin); if (h === null || !loop(h)) return false; }
  return true;
}

/**
 * The single guard for endpoints that act on the machine. The API answers any origin (`*`, it is a local tool), so these check the
 * request itself. `strict` also pins the Host (terminals); otherwise only the origin is checked, as git actions and resources always did.
 */
export function requireLocal(req: IncomingMessage, message: string, opts: { strict?: boolean } = {}): void {
  if (!(opts.strict ? isLocalRequest(req) : originIsLocal(req))) throw forbidden(message);
}
