// Runs the Telegram adapter against a fake Bot API (no real token needed) with a REAL agent behind it. Usage:
//   HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4430 npx tsx scripts/sim-telegram.ts [provider] [model]
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agents } from '../src/db.js';
import '../src/index.js';
import { splitMessage, mdToTelegramHtml } from '../src/connections/format.js';
import { cursors } from '../src/connections/store.js';
import { bus } from '../src/runtime.js';

const [provider = 'opencode', model = 'opencode-go/deepseek-v4-flash'] = process.argv.slice(2);
const API = `http://127.0.0.1:${process.env.HIVE_AM_PORT}`;
const FAKE = 4431;
const prompts: string[] = [];
bus.on('msg', (m: any) => { if (m.kind === 'turn_start') prompts.push(m.prompt); });
let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 120_000) => { const t = Date.now(); while (!f() && Date.now() - t < ms) await sleep(200); return f(); };

// ---- a tiny Telegram Bot API ----
const uploads: any[] = [];                 // files the bot sent
const blobs = new Map<string, Buffer>();   // file_path → bytes, served for downloads
const updates: any[] = []; const sent: any[] = []; const actions: any[] = []; let uid = 100, mid = 500; const polls: number[] = [];
createServer(async (req, res) => {
  const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
  const isForm = String(req.headers['content-type'] ?? '').startsWith('multipart/');
  const body = chunks.length && !isForm ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  const dl = /^\/file\/bot[^/]+\/(.+)$/.exec(req.url ?? '');
  if (dl) { const b = blobs.get(dl[1]); if (!b) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': 'application/octet-stream' }); return res.end(b); }
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
  if (/^send(Photo|Document|Video|Audio)$/.test(method ?? '') && isForm) {
    const raw = Buffer.concat(chunks).toString('latin1');
    const field = (n: string) => new RegExp(`name="${n}"\\r\\n\\r\\n([^\\r]*)`).exec(raw)?.[1];
    const file = /filename="([^"]+)"\r\nContent-Type: ([^\r]+)\r\n\r\n([\s\S]*?)\r\n--/.exec(raw);
    uploads.push({ method, chat_id: field('chat_id'), thread: field('message_thread_id'), caption: field('caption'), filename: file?.[1], mime: file?.[2], bytes: file?.[3]?.length ?? 0, content: file?.[3] });
    return out({ ok: true, result: { message_id: ++mid } });
  }
  if (method === 'getFile') {
    if (body.file_id === 'BIG') return out({ ok: false, error_code: 400, description: 'Bad Request: file is too big' }, 400);
    const b = blobs.get(String(body.file_id)); return b ? out({ ok: true, result: { file_id: body.file_id, file_path: String(body.file_id), file_size: b.length } }) : out({ ok: false, error_code: 400, description: 'Bad Request: wrong file_id' }, 400);
  }
  if (method === 'sendChatAction') { actions.push(body); return out({ ok: true, result: true }); }
  out({ ok: false, error_code: 404, description: 'no such method' }, 404);
}).listen(FAKE);

const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) as any };
};
const real = () => sent.filter((s) => !String(s.text).startsWith('⏳'));
const say = (o: { chat?: any; from?: number; text?: string; caption?: string; media?: Record<string, any>; album?: string; topic?: number; replyToBot?: boolean }) => updates.push({ update_id: ++uid, message: {
  message_id: ++mid, ...(o.text !== undefined ? { text: o.text } : {}), ...(o.caption !== undefined ? { caption: o.caption } : {}), ...(o.media ?? {}), ...(o.album ? { media_group_id: o.album } : {}), from: { id: o.from ?? 42, username: 'maria', first_name: 'Maria' },
  chat: o.chat ?? { id: 42, type: 'private' },
  ...(o.topic ? { is_topic_message: true, message_thread_id: o.topic } : {}),
  ...(o.replyToBot ? { reply_to_message: { from: { id: 999 } } } : {}),
} });

// ---- pure functions ----
check(splitMessage('a'.repeat(9000), 3500).every((p) => p.length <= 3500) && splitMessage('a'.repeat(9000), 3500).join('').length === 9000, 'long text is split under the limit without losing characters');
check(mdToTelegramHtml('**hi** `x<y` [l](https://a.b)') === '<b>hi</b> <code>x&lt;y</code> <a href="https://a.b">l</a>', 'markdown → Telegram HTML');
check(mdToTelegramHtml('```js\nif (a<b) {}\n```') === '<pre>if (a&lt;b) {}</pre>', 'code fence → <pre> with escaping');

const { safeName, cleanInbox } = await import('../src/connections/files.js');
check(safeName('../../etc/passwd') === 'passwd' && safeName('.bashrc') === 'bashrc' && safeName('a/b\\c:d*e?.TXT') === 'c_d_e_.TXT' && safeName('') === 'file' && safeName('x'.repeat(300) + '.pdf').length <= 84, 'file names are made safe (no folders, never hidden, not endless)');
{
  const { mkdirSync, writeFileSync, utimesSync, existsSync } = await import('node:fs');
  const dir = join(process.env.HIVE_AM_HOME!, 'inbox', 'old-agent', '2020-01-01'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'old.txt'), 'x'); utimesSync(join(dir, 'old.txt'), new Date('2020-01-01'), new Date('2020-01-01'));
  check(cleanInbox(14) >= 1 && !existsSync(dir), 'received files older than 14 days are deleted with their empty folders');
}

// ---- what an agent may send back ----
{
  const { mkdirSync, writeFileSync, symlinkSync } = await import('node:fs');
  const { resolveSendable } = await import('../src/connections/outbound.js');
  const cwd = mkdtempSync(join(tmpdir(), 'send-'));
  const ag = agents.create({ name: 'sender', role: 'worker', provider: 'claude', cwd, permission: 'acceptEdits' });
  writeFileSync(join(cwd, 'report.pdf'), 'x'); writeFileSync(join(cwd, '.env'), 'SECRET=1'); writeFileSync(join(cwd, 'server.pem'), 'k'); writeFileSync(join(cwd, 'app.db'), 'd');
  mkdirSync(join(cwd, '.git')); writeFileSync(join(cwd, '.git', 'config'), 'c'); symlinkSync('/etc/passwd', join(cwd, 'link.txt'));
  const bad = (p: string) => { try { resolveSendable(ag, p); return false; } catch { return true; } };
  check(resolveSendable(ag, join(cwd, 'report.pdf')).kind === 'document', 'a file in the working folder can be sent');
  check(bad(join(cwd, '.env')) && bad(join(cwd, 'server.pem')) && bad(join(cwd, 'app.db')) && bad(join(cwd, '.git', 'config')), 'credentials, keys, databases and git internals are never sent');
  check(bad('/etc/passwd') && bad(join(cwd, 'link.txt')) && bad(join(process.env.HIVE_AM_HOME!, 'hive-am.db')) && bad(cwd) && bad(join(cwd, 'missing.txt')), 'files outside the working folder (also through a symlink), hive-am\'s own data, folders and missing files are refused');
}

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
// ...and it stops by itself once the turn is over (nothing pulses for a finished turn).
await until(() => agents.get(agent.id)!.status !== 'running');
await sleep(1500);
const pulses = actions.length;
await sleep(5500);
check(actions.length === pulses, 'typing stops when the turn ends');
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

// ---- files ----
// earlier turns may still be answering (slow providers): start from a quiet agent so their replies are not mistaken for ours
await until(() => agents.get(agent.id)!.status !== 'running', 180_000); await sleep(2000);
const files = (await import('node:fs')).readdirSync;
const inbox = join(process.env.HIVE_AM_HOME!, 'inbox', agent.id);
blobs.set('docs/vault.txt', Buffer.from('Meeting notes.\nThe meeting room is 7391-ALPHA.\nPlease be on time.\n'));
blobs.set('photos/p1.jpg', Buffer.from('JPEGDATA-1')); blobs.set('photos/p2.jpg', Buffer.from('JPEGDATA-2'));
sent.length = 0; const turns0 = prompts.length;
say({ caption: 'Read the attached file and tell me the meeting room with channel_reply. Only the room.', media: { document: { file_id: 'docs/vault.txt', file_name: 'vault.txt', mime_type: 'text/plain', file_size: 60 } } });
await until(() => real().length >= 1);
console.log('   file reply was:', JSON.stringify(real().map((s) => s.text)));
check(prompts.length === turns0 + 1 && /\[hive:files\]/.test(prompts[prompts.length - 1]) && /vault\.txt/.test(prompts[prompts.length - 1]), 'a document becomes ONE turn whose message lists the saved file');
check(real().some((s) => /7391-ALPHA/.test(s.text)), 'the agent opened the file and answered from its content');
const saved = (() => { try { return files(inbox, { recursive: true } as any).map(String); } catch { return []; } })();
check(saved.some((n) => /vault\.txt$/.test(n)), `the file was saved in the agent's inbox (${saved.length} entries)`);

sent.length = 0; const turns1 = prompts.length;
say({ caption: 'Two photos for you: just answer with channel_reply, one word: received.', album: 'A1', media: { photo: [{ file_id: 'photos/p1.jpg', file_size: 10 }] } });
say({ album: 'A1', media: { photo: [{ file_id: 'photos/p2.jpg', file_size: 10 }] } });
await until(() => real().length >= 1);
check(prompts.length === turns1 + 1 && (prompts[prompts.length - 1].match(/photo-\d+\.jpg/g) ?? []).length >= 2, 'an album of two photos is ONE message with both files');

// The agent sends a file back (it must use the tool, not the bot token).
writeFileSync(join(agent.cwd, 'summary.txt'), 'Quarterly summary: all good.\n');
sent.length = 0; uploads.length = 0;
say({ text: 'Send me the file summary.txt from your working folder using channel_send_file, with the caption "here you go". Then reply with channel_reply: sent.' });
await until(() => uploads.length >= 1 && real().length >= 1);
console.log('   uploads:', JSON.stringify(uploads.map((u) => ({ ...u, content: String(u.content ?? '').slice(0, 40) }))), 'replies:', JSON.stringify(real().map((x) => x.text)));
check(uploads.some((u) => u.method === 'sendDocument' && u.chat_id === '42' && u.filename === 'summary.txt' && /Quarterly summary/.test(u.content ?? '') && /here you go/.test(u.caption ?? '')), 'the agent sent the file to the chat with its caption, through the tool');
await until(() => agents.get(agent.id)!.status !== 'running', 60_000); await sleep(800);

// An image model describes pictures for agents that cannot see (the connection names one).
const { deflateSync, crc32 } = await import('node:zlib') as any;
const png = (rgb: number[]) => {
  const w = 120, h = 120, raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())])));
  const ch = (t: string, d: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const body = Buffer.concat([Buffer.from(t), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32 ? crc32(body) >>> 0 : 0); return Buffer.concat([len, body, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ch('IHDR', ihdr), ch('IDAT', deflateSync(raw)), ch('IEND', Buffer.alloc(0))]);
};
if (typeof crc32 === 'function') {
  blobs.set('photos/red.png', png([220, 20, 20]));
  r = await api('PATCH', `/api/connections/${connId}`, { config: { vision: { provider: 'claude', model: 'haiku' } } });
  check(r.status === 200 && r.json.config.vision.provider === 'claude', 'the connection stores which image model to use');
  sent.length = 0; const turns2 = prompts.length;
  say({ caption: 'What color is this picture? Answer with channel_reply, one word.', media: { photo: [{ file_id: 'photos/red.png', file_size: 600 }] } });
  await until(() => real().length >= 1);
  const last = prompts[prompts.length - 1];
  console.log('   description line:', (/What the picture shows[^\n]*/.exec(last) ?? [''])[0].slice(0, 160));
  check(prompts.length === turns2 + 1 && /What the picture shows/.test(last) && /red/i.test(last), 'the picture arrives with a description made by the image model');
  r = await api('PATCH', `/api/connections/${connId}`, { config: { vision: { provider: 'claude' } } });
  check(r.status === 400, 'a malformed image model is rejected');
  await api('PATCH', `/api/connections/${connId}`, { config: { vision: null } });
  await until(() => agents.get(agent.id)!.status !== 'running', 60_000); await sleep(1000);
} else console.log('   (node without zlib.crc32: skipping the image-model check)');

sent.length = 0;
say({ caption: 'here is a huge file', media: { document: { file_id: 'BIG', file_name: 'huge.zip', mime_type: 'application/zip', file_size: 999 } } });
await until(() => sent.length >= 1, 20_000);
check(sent.some((s) => /huge\.zip/.test(s.text) && /too big/i.test(s.text)), 'a file Telegram will not give is reported to the person');
// the caption is still a message for the agent: let that turn finish before the next checks
await until(() => agents.get(agent.id)!.status !== 'running' && real().length >= 1, 120_000); await sleep(1500);
sent.length = 0;
say({ chat: { id: -100, type: 'supergroup', title: 'Team' }, media: { document: { file_id: 'docs/vault.txt', file_name: 'quiet.txt', mime_type: 'text/plain', file_size: 60 } }, caption: 'nobody called the bot' });
await sleep(2500);
check(sent.length === 0 && !saved.concat(files(inbox, { recursive: true } as any).map(String)).some((n) => /quiet\.txt/.test(n)), 'files sent to the group without calling the bot are not downloaded (connection is not open to chatter)');

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
