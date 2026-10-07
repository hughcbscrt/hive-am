// Runs the Telegram adapter against a fake Bot API (no real token needed) with a REAL agent behind it. Usage:
//   HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4430 npx tsx scripts/sim-telegram.ts [provider] [model]
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agents } from '../src/db.js';
import '../src/index.js';
import { splitMessage, mdToTelegramHtml } from '../src/connections/format.js';
import { cursors } from '../src/connections/store.js';

const [provider = 'opencode', model = 'opencode-go/deepseek-v4-flash'] = process.argv.slice(2);
const API = `http://127.0.0.1:${process.env.HIVE_AM_PORT}`;
const FAKE = 4431;
let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 120_000) => { const t = Date.now(); while (!f() && Date.now() - t < ms) await sleep(200); return f(); };

// ---- a tiny Telegram Bot API ----
const updates: any[] = []; const sent: any[] = []; const actions: any[] = []; let uid = 100, mid = 500; const polls: number[] = [];
createServer(async (req, res) => {
  const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  const [, token, method] = /^\/bot([^/]+)\/(\w+)/.exec(req.url ?? '') ?? [];
  const out = (o: unknown, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (!token?.startsWith('GOOD')) return out({ ok: false, error_code: 401, description: 'Unauthorized' }, 401);
  if (method === 'getMe') return out({ ok: true, result: { id: 999, username: 'hivebot', is_bot: true } });
  if (method === 'getUpdates') {
    polls.push(body.offset ?? 0);
    for (let i = 0; i < 8; i++) { const f = updates.filter((u) => u.update_id >= (body.offset ?? 0)); if (f.length) return out({ ok: true, result: f }); await sleep(250); }
    return out({ ok: true, result: [] });
  }
  if (method === 'sendMessage') {
    if (body.parse_mode === 'HTML' && String(body.text).includes('FORCEFAIL')) return out({ ok: false, error_code: 400, description: "Bad Request: can't parse entities" }, 400);
    sent.push(body); return out({ ok: true, result: { message_id: ++mid } });
  }
  if (method === 'sendChatAction') { actions.push(body); return out({ ok: true, result: true }); }
  out({ ok: false, error_code: 404, description: 'no such method' }, 404);
}).listen(FAKE);

const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) as any };
};
const real = () => sent.filter((s) => !String(s.text).startsWith('⏳'));
const say = (o: { chat?: any; from?: number; text: string; topic?: number; replyToBot?: boolean }) => updates.push({ update_id: ++uid, message: {
  message_id: ++mid, text: o.text, from: { id: o.from ?? 42, username: 'maria', first_name: 'Maria' },
  chat: o.chat ?? { id: 42, type: 'private' },
  ...(o.topic ? { is_topic_message: true, message_thread_id: o.topic } : {}),
  ...(o.replyToBot ? { reply_to_message: { from: { id: 999 } } } : {}),
} });

// ---- pure functions ----
check(splitMessage('a'.repeat(9000), 3500).every((p) => p.length <= 3500) && splitMessage('a'.repeat(9000), 3500).join('').length === 9000, 'long text is split under the limit without losing characters');
check(mdToTelegramHtml('**hi** `x<y` [l](https://a.b)') === '<b>hi</b> <code>x&lt;y</code> <a href="https://a.b">l</a>', 'markdown → Telegram HTML');
check(mdToTelegramHtml('```js\nif (a<b) {}\n```') === '<pre>if (a&lt;b) {}</pre>', 'code fence → <pre> with escaping');

// ---- agent + permission rule ----
const planAgent = agents.create({ name: 'readonly', role: 'worker', provider: provider as any, model, cwd: mkdtempSync(join(tmpdir(), 'tg-')), permission: 'plan' });
const agent = agents.create({ name: 'tgbot', role: 'worker', provider: provider as any, model, cwd: mkdtempSync(join(tmpdir(), 'tg-')), permission: 'acceptEdits' });

let r = await api('POST', '/api/connections', { kind: 'telegram', name: 'bad', agent_id: agent.id, config: { token: 'WRONG', api_base: `http://127.0.0.1:${FAKE}` }, allowed: [{ id: '42' }] });
check(r.status === 200 && r.json.status.state === 'error' && /token/i.test(r.json.status.detail), 'invalid token → connection saved but status error');
await api('DELETE', `/api/connections/${r.json.id}`);

r = await api('POST', '/api/connections', { kind: 'telegram', name: 'plan', agent_id: planAgent.id, config: { token: 'GOOD-secret-7777' }, allowed: [{ id: '42' }] });
check(r.status === 400 && /Plan mode/.test(r.json.error), 'linking an agent in Plan mode is rejected');
r = await api('POST', '/api/connections', { kind: 'telegram', name: 'notoken', agent_id: agent.id, config: {} });
check(r.status === 400, 'missing token is rejected');

r = await api('POST', '/api/connections', { kind: 'telegram', name: 'tg', agent_id: agent.id, config: { token: 'GOOD-secret-7777', api_base: `http://127.0.0.1:${FAKE}`, lang: 'en' }, allowed: [{ id: '42', admin: true }] });
const connId = r.json.id;
check(r.status === 200, 'connection created');
await until(() => polls.length > 0, 10_000);
r = await api('GET', '/api/connections');
check(r.json[0].status.state === 'connected' && r.json[0].status.detail === '@hivebot', 'status connected as @hivebot');
check(JSON.stringify(r.json).indexOf('secret') === -1 && r.json[0].config.token.hint === '••••7777', 'token is never returned, only a hint');

r = await api('PATCH', `/api/agents/${agent.id}`, { permission: 'plan' });
check(r.status === 400 && agents.get(agent.id)!.permission === 'acceptEdits', 'switching a linked agent to Plan is rejected and rolled back');

r = await api('POST', `/api/connections/${connId}/test`);
check(r.status === 200 && /greeted 1 of 1/.test(r.json.detail) && sent.some((s) => String(s.text).includes('connected as @hivebot')), 'test greets the allowed user');
sent.length = 0;

// ---- real turns ----
say({ from: 7, chat: { id: 7, type: 'private' }, text: 'hi' }); say({ from: 7, chat: { id: 7, type: 'private' }, text: 'hi again' });
await until(() => sent.length >= 1, 10_000); await sleep(1500);
check(sent.length === 1 && String(sent[0].text).includes('7'), 'stranger gets their id once');
sent.length = 0;

say({ text: 'Please reply with channel_reply: say hello and include the word BANANA.' });
await until(() => real().length >= 1);
check(sent.some((s) => s.chat_id === '42' && /banana/i.test(s.text) && s.parse_mode === 'HTML' && !s.message_thread_id), 'private chat: agent replies through channel_reply (HTML, no topic)');
check(actions.some((a) => a.chat_id === '42' && a.action === 'typing'), 'typing indicator was shown');
sent.length = 0;

say({ chat: { id: -100, type: 'supergroup', title: 'Team' }, text: 'no mention, should be ignored' });
say({ chat: { id: -100, type: 'supergroup', title: 'Team' }, topic: 77, text: '@hivebot what was the word I asked you to include before? Use channel_reply, one word.' });
await until(() => real().length >= 1);
check(real().every((s) => s.chat_id === '-100' && s.message_thread_id === 77), 'group topic: reply goes to topic 77');
console.log('   topic reply was:', JSON.stringify(sent.map((s) => s.text)));
check(real().some((s) => /banana/i.test(s.text)), 'topic reply shares the private chat session (remembers BANANA)');
check(!sent.some((s) => /ignored/i.test(s.text)), 'unaddressed group message was ignored');
sent.length = 0;

say({ text: '/status@otherbot' }); say({ text: '/status@hivebot' });
await until(() => sent.length >= 1, 15_000); await sleep(1000);
check(sent.length === 1 && String(sent[0].text).includes('tgbot'), '/status@hivebot answered, /status@otherbot ignored');

// ---- restart does not replay ----
const before = sent.length; const off = cursors.get(connId);
await api('POST', `/api/connections/${connId}/restart`); await sleep(2500);
check(Number(off) > 0 && sent.length === before && polls[polls.length - 1] === Number(off), `restart resumes at offset ${off} without replaying`);

// ---- plain-text fallback when Telegram rejects the HTML ----
const { TelegramAdapter } = await import('../src/connections/telegram.js');
const direct = new TelegramAdapter({ id: 'x', kind: 'telegram', name: 'x', agent_id: null, allowed: [], enabled: true, created_at: 0, config: { token: 'GOOD-x', api_base: `http://127.0.0.1:${FAKE}` } });
sent.length = 0;
await direct.send({ chat: '42', thread: '5' }, 'hello **FORCEFAIL**');
check(sent.length === 1 && !sent[0].parse_mode && sent[0].text === 'hello **FORCEFAIL**' && sent[0].message_thread_id === 5, 'HTML rejected → retried as plain text in the same topic');
r = await api('GET', `/api/connections/${connId}/threads`);
check(r.json.length === 2, `threads recorded: private chat and the topic (${r.json.length})`);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
