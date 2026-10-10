// Text going to Telegram: emoji presentation and mentions of people. No model. Usage: npx tsx scripts/test-format.ts
import { emojiPresentation, mdToTelegramHtml } from '../src/connections/format.js';
import { findSecret } from '../src/connections/secrets.js';
import { TelegramAdapter } from '../src/connections/telegram.js';

let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); if (!ok) fail++; };
eq('the alarm clock gets the emoji selector', emojiPresentation('⏰ **13:43**'), '⏰️ **13:43**');
eq('hourglass, warning and check too', emojiPresentation('⏳ ⚠ ✔'), '⏳️ ⚠️ ✔️');
eq('it is not added twice', emojiPresentation('⏰️ ok'), '⏰️ ok');
eq('other emoji are untouched', emojiPresentation('🔔 ✨ 👍 hola'), '🔔 ✨️ 👍 hola');
eq('the HTML sent to Telegram carries it', mdToTelegramHtml('⏰ Recordatorio'), '⏰️ Recordatorio');
const adapter = new TelegramAdapter({ id: 'x', kind: 'telegram', name: 'x', agent_id: null, config: { token: 't' }, allowed: [], enabled: true, created_at: 0 } as any);
const mention = adapter.mention({ id: '8654594587', name: 'Hugo [QA]' });
eq('a mention is a link to the account', mention, '[Hugo QA](tg://user?id=8654594587)');
eq('it becomes an HTML link that notifies the person', mdToTelegramHtml(`${mention} revisa el servidor`), '<a href="tg://user?id=8654594587">Hugo QA</a> revisa el servidor');
eq('other tg:// links are not turned into links', mdToTelegramHtml('[x](tg://resolve?domain=bot)').includes('<a '), false);
eq('a mention does not trip the secrets filter', findSecret(`${mention} ya terminó el despliegue`), null);
console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
process.exit(fail ? 1 : 0);
