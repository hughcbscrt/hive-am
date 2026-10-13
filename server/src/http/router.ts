import type { IncomingMessage, ServerResponse } from 'node:http';
import { bad } from './errors.js';

export interface Ctx { req: IncomingMessage; res: ServerResponse; params: string[]; url: URL }
export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;
export interface Route { method: string; pattern: string; re: RegExp; handler: Handler }

/** The route table: the modules in ./routes fill it when they are imported (see api.ts for the order). */
export const routes: Route[] = [];

/** `:name` matches one path segment; its decoded text reaches the handler in `params`, in order. */
export const route = (method: string, pattern: string, handler: Handler): void => {
  routes.push({ method, pattern, re: new RegExp('^' + pattern.replace(/:[^/]+/g, '([^/]+)') + '$'), handler });
};

/** The first route that answers this method and path, with its (decoded) parameters. A malformed %-escape is a 400. */
export function match(method: string, pathname: string): { route: Route; params: string[] } | null {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(pathname); if (!m) continue;
    try { return { route: r, params: m.slice(1).map(decodeURIComponent) }; } catch { throw bad('Malformed URL'); }
  }
  return null;
}
