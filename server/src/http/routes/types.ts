import { types } from '../../db.js';
import { spawnFromType } from '../../services/agents.js';
import { body } from '../body.js';
import { bad, notFound } from '../errors.js';
import { route } from '../router.js';
import { defaultModel, isProvider } from '../../services/providers.js';
import { checkEffort } from '../../efforts.js';
import { requireName, text, validateAgentInput } from '../validate.js';

route('GET', '/api/types', () => types.list());
route('POST', '/api/types', async ({ req }) => {
  const p = await body(req);
  const name = requireName(p.name);
  if (!isProvider(p.provider)) throw bad('Pick a provider');
  if (p.model === undefined) p.model = defaultModel(p.provider);
  const why = checkEffort(p.provider, text(p.model), p.effort); if (why) throw bad(why);
  try { return types.create({ ...p, name } as Parameters<typeof types.create>[0]); } catch { throw bad(`A type named "${text(p.name)}" already exists`); }
});
route('PATCH', '/api/types/:id', async ({ req, params }) => {
  const cur = types.get(params[0]); if (!cur) throw notFound('Type not found');
  const p = await body(req);
  // The effort has to apply to the provider and model the type will have; one that no longer does is cleared.
  const provider = isProvider(p.provider) ? p.provider : cur.provider, model = p.model !== undefined ? text(p.model) : cur.model;
  if (p.effort !== undefined) { const why = checkEffort(provider, model, p.effort); if (why) throw bad(why); }
  else if (cur.effort && checkEffort(provider, model, cur.effort) !== null) p.effort = '';
  const t = types.update(params[0], p); if (!t) throw notFound('Type not found'); return t;
});
route('DELETE', '/api/types/:id', ({ params }) => { if (!types.remove(params[0])) throw notFound('Type not found'); return { ok: true }; });
route('POST', '/api/types/:id/spawn', async ({ req, params }) => {
  const t = types.get(params[0]); if (!t) throw notFound('Type not found');
  const p = await body(req);
  validateAgentInput({ name: p.name, cwd: p.cwd, colony_id: p.colony_id });
  return spawnFromType(t, p as Parameters<typeof spawnFromType>[1]);
});
