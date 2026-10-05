import type { Provider, StreamEvent, TurnOptions } from '../types.js';
import { runClaude } from './claude.js';
import { runOpencode } from './opencode.js';
import { runKiro } from './kiro.js';

export const runners: Record<Provider, (o: TurnOptions) => AsyncGenerator<StreamEvent>> = {
  claude: runClaude, opencode: runOpencode, kiro: runKiro,
};
