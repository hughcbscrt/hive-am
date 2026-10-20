// Text going to Telegram and Slack: emoji presentation, mrkdwn and mentions of people. No model. Usage: npx tsx scripts/test-format.ts
import './_guard.js';
import { emojiPresentation, mdToSlackMrkdwn, mdToTelegramHtml } from '../src/connections/format.js';
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
// Slack's mrkdwn
eq('slack: bold, italic and strike', mdToSlackMrkdwn('**bold** *it* _it2_ ~~gone~~'), '*bold* _it_ _it2_ ~gone~');
eq('slack: inline code and blocks are kept, escaped', mdToSlackMrkdwn('`a<b` y\n```ts\nif (a && b > c) {}\n```'), '`a&lt;b` y\n```\nif (a &amp;&amp; b &gt; c) {}\n```');
eq('slack: links become <url|label>', mdToSlackMrkdwn('ver [la guía](https://x.io/a?b=1&c=2)'), 'ver <https://x.io/a?b=1&c=2|la guía>');
eq('slack: headings are bold lines', mdToSlackMrkdwn('## Estado del **deploy**\nok'), '*Estado del deploy*\nok');
eq('slack: quotes and lists', mdToSlackMrkdwn('> cita\n- uno\n* dos'), '> cita\n• uno\n• dos');
eq('slack: & < > are escaped in plain text', mdToSlackMrkdwn('a < b & c > d'), 'a &lt; b &amp; c &gt; d');
eq("slack: its own tokens are kept", mdToSlackMrkdwn('<@U012AB3CD> mira <#C1|deploys> <!here> <https://a.b|x>'), '<@U012AB3CD> mira <#C1|deploys> <!here> <https://a.b|x>');
eq('slack: the emoji selector too', mdToSlackMrkdwn('⏰ ya'), '⏰️ ya');
eq('slack: a token does not trip the secrets filter but a real one does', [findSecret('<@U012AB3CD> listo'), findSecret('xapp-1-A0123456789-1234567890123-abcdef0123456789')], [null, 'a Slack token']);
console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
process.exit(fail ? 1 : 0);
