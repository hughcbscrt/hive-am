import type { Provider, StreamEvent, TurnOptions } from '../types.js';
import { runClaude } from './claude.js';
import { runOpencode } from './opencode.js';
import { runKiro } from './kiro.js';

/** What the runtime needs from a CLI: run one turn and stream what happens. Everything else (flags, parsing, sessions) stays inside the adapter. */
export interface ProviderAdapter {
  readonly id: Provider;
  run(o: TurnOptions): AsyncGenerator<StreamEvent>;
}

export const providers: Record<Provider, ProviderAdapter> = {
  claude: { id: 'claude', run: runClaude },
  opencode: { id: 'opencode', run: runOpencode },
  kiro: { id: 'kiro', run: runKiro },
};

/** The adapters as plain functions (what `runtime.ts` and the image reader call; tests may replace one). */
export const runners: Record<Provider, (o: TurnOptions) => AsyncGenerator<StreamEvent>> = {
  claude: (o) => providers.claude.run(o), opencode: (o) => providers.opencode.run(o), kiro: (o) => providers.kiro.run(o),
};
