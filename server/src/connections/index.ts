import { registerFactory } from './manager.js';
import { SlackAdapter } from './slack.js';
import { TelegramAdapter } from './telegram.js';

registerFactory('telegram', (c) => new TelegramAdapter(c));
registerFactory('slack', (c) => new SlackAdapter(c));
