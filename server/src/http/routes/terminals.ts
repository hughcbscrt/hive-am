import { closeTerminal, createTerminal, listTerminals, terminalsEnabled } from '../../terminals.js';
import { body } from '../body.js';
import { notFound } from '../errors.js';
import { requireLocal } from '../guards.js';
import { route } from '../router.js';

// Real shells shown in the bottom panel (see terminals.ts). Strict: the Host must be loopback too. TerminalError becomes a 400 in http/errors.ts.
const MSG = 'Terminals can only be used from this machine';
route('GET', '/api/terminals', ({ req }) => { requireLocal(req, MSG, { strict: true }); return { enabled: terminalsEnabled(), terminals: listTerminals() }; });
route('POST', '/api/terminals', async ({ req }) => {
  requireLocal(req, MSG, { strict: true });
  return createTerminal(await body(req));
});
route('DELETE', '/api/terminals/:id', ({ req, params }) => {
  requireLocal(req, MSG, { strict: true });
  if (!closeTerminal(params[0])) throw notFound('Terminal not found');
  return { ok: true };
});
