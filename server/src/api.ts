import type { IncomingMessage, ServerResponse } from 'node:http';
import { toHttpError } from './http/errors.js';
import { match } from './http/router.js';
// Each module registers its routes when imported (see http/router.ts). Within a method and a segment count no pattern overlaps, so the order is only for reading.
import './http/routes/meta.js';
import './http/routes/agents.js';
import './http/routes/git.js';
import './http/routes/resources.js';
import './http/routes/terminals.js';
import './http/routes/skills.js';
import './http/routes/types.js';
import './http/routes/colonies.js';
import './http/routes/agent-colonies.js';
import './http/routes/connections.js';
import './http/routes/orchestration.js';
import './http/routes/notebook.js';
import './http/routes/channel.js';
import './http/routes/schedules.js';
import './http/routes/fs.js';

function json(res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(data));
}

/**
 * TODO(security): the API answers any origin (`*`) and the endpoints that act on the machine (git writes, resources, notebook edits,
 * terminals) only check the browser's Origin (see http/guards.ts). Pinning Host/Origin for every route (DNS rebinding, a foreign page
 * reading GETs) is NOT applied: it has to be proven against the Next rewrite (/api/* on the UI's origin, forwarded with whatever Host
 * and Origin Next sends) and the MCP clients in server/mcp before it ships. Candidate: refuse a Host that is not loopback or the
 * configured UI host, and reply `access-control-allow-origin` only to loopback origins.
 */
export async function handle(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const hit = match(req.method ?? '', url.pathname);
    if (!hit) return json(res, 404, { error: 'No such route' });
    const out = await hit.route.handler({ req, res, params: hit.params, url });
    if (res.headersSent) return; // the handler streamed its own response
    return json(res, 200, out ?? null);
  } catch (e) {
    const h = toHttpError(e);
    if (h) return res.headersSent ? res.end() : json(res, h.status, { error: h.message }, h.status === 413 ? { connection: 'close' } : {});
    console.error('[api]', e);
    return res.headersSent ? res.end() : json(res, 500, { error: 'Unexpected server error' });
  }
}
