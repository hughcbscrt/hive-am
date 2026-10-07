import { registerFactory } from './manager.js';
import { TelegramAdapter } from './telegram.js';

registerFactory('telegram', (c) => new TelegramAdapter(c));
