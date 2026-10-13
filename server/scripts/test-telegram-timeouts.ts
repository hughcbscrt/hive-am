// A Telegram call that never answers (a half-open connection) fails with a clear error instead of hanging forever.
//   HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-telegram-timeouts.ts
import './_guard.js';
process.env.HIVE_AM_TELEGRAM_TIMEOUT_MS = '300';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
const { TelegramAdapter } = await import('../src/connections/telegram.js');

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };

const hung: import('node:http').ServerResponse[] = [];
const srv = createServer((req, res) => {
  const method = (req.url ?? '').split('/').pop();
  if (method === 'getMe') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, result: { id: 1, username: 'testbot' } })); }
  else if (method === 'getUpdates') hung.push(res);       // a long poll that is simply waiting
  else hung.push(res);                                    // sendMessage: never answers
});
await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
const tg = new TelegramAdapter({ id: 'tg-t', kind: 'telegram', name: 'tg', agent_id: null, allowed: [], enabled: true, created_at: 0, config: { token: 'T', api_base: base } });
await tg.start(async () => {});
check(tg.status().state === 'connected', 'it connects');
const t0 = Date.now();
let msg = '';
try { await tg.send({ chat: '1' }, 'hello'); } catch (e) { msg = (e as Error).message; }
check(/did not answer in time/.test(msg) && Date.now() - t0 < 3000, `a send that gets no answer fails fast (${Date.now() - t0} ms): ${msg}`);
await tg.stop();
check(tg.status().state === 'stopped', 'stopping works while calls were hanging');
for (const r of hung) r.destroy();
srv.close();
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
