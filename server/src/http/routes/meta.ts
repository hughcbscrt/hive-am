import { DATA_DIR } from '../../db.js';
import { effortOptions, learnedEfforts } from '../../efforts.js';
import { listModels } from '../../models.js';
import { learnOpencodeWindows } from '../../providers/opencode-server.js';
import { isProvider, providerStatus } from '../../services/providers.js';
import { notFound } from '../errors.js';
import { route } from '../router.js';

route('GET', '/api/health', () => ({ ok: true }));
route('GET', '/api/providers', () => providerStatus());
route('GET', '/api/providers/:p/models', async ({ params }) => {
  if (!isProvider(params[0])) throw notFound('Unknown provider');
  return listModels(params[0]);
});
// The reasoning levels the agent form offers for a provider and model. OpenCode's depend on the model: when they are not known yet its catalog is read first.
route('GET', '/api/providers/:p/efforts', async ({ params, url }) => {
  if (!isProvider(params[0])) throw notFound('Unknown provider');
  const model = url.searchParams.get('model') ?? '';
  if (params[0] === 'opencode' && model && !learnedEfforts('opencode', model)) await learnOpencodeWindows(DATA_DIR, null);
  return effortOptions(params[0], model);
});
