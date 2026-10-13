import { listModels } from '../../models.js';
import { isProvider, providerStatus } from '../../services/providers.js';
import { notFound } from '../errors.js';
import { route } from '../router.js';

route('GET', '/api/health', () => ({ ok: true }));
route('GET', '/api/providers', () => providerStatus());
route('GET', '/api/providers/:p/models', async ({ params }) => {
  if (!isProvider(params[0])) throw notFound('Unknown provider');
  return listModels(params[0]);
});
