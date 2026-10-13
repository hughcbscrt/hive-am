import { colonies } from '../../db.js';
import { createColony, removeColony, updateColony } from '../../services/colonies.js';
import { body } from '../body.js';
import { route } from '../router.js';
import { validateColony } from '../validate.js';

route('GET', '/api/colonies', () => colonies.list());
route('POST', '/api/colonies', async ({ req }) => createColony(validateColony(await body(req))));
route('PATCH', '/api/colonies/:id', async ({ req, params }) => updateColony(params[0], validateColony(await body(req), true)));
route('DELETE', '/api/colonies/:id', ({ params }) => { removeColony(params[0]); return { ok: true }; });
