// A stand-in for the Telegram Bot API for manual UI tests. Usage: npx tsx scripts/fake-telegram.ts [port]
//   POST /_say {"text":"hi","from":42,"chat":42,"topic":7}   → queue a user message
//   GET  /_sent                                              → what the bot has sent
import { createServer } from 'node:http';
const port = Number(process.argv[2] ?? 4450);
const updates: any[] = []; const sent: any[] = []; let uid = 100, mid = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
createServer(async (req, res) => {
  const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  const out = (o: unknown, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.url === '/_sent') return out(sent);
  if (req.url === '/_say') {
    const chat = body.chat ?? body.from ?? 42;
    updates.push({ update_id: ++uid, message: { message_id: ++mid, text: body.text, from: { id: body.from ?? 42, username: body.user ?? 'maria', first_name: 'Maria' },
      chat: body.group ? { id: chat, type: 'supergroup', title: body.group } : { id: chat, type: 'private' },
      ...(body.topic ? { is_topic_message: true, message_thread_id: body.topic } : {}) } });
    return out({ ok: true });
  }
  const [, token, method] = /^\/bot([^/]+)\/(\w+)/.exec(req.url ?? '') ?? [];
  if (!token?.startsWith('GOOD')) return out({ ok: false, error_code: 401, description: 'Unauthorized' }, 401);
  if (method === 'getMe') return out({ ok: true, result: { id: 999, username: 'hivedemo_bot', is_bot: true } });
  if (method === 'getUpdates') {
    for (let i = 0; i < 40; i++) { const f = updates.filter((u) => u.update_id >= (body.offset ?? 0)); if (f.length) return out({ ok: true, result: f }); await sleep(250); }
    return out({ ok: true, result: [] });
  }
  if (method === 'sendMessage') { sent.push({ chat: body.chat_id, thread: body.message_thread_id, text: body.text }); return out({ ok: true, result: { message_id: ++mid } }); }
  if (method === 'sendChatAction') return out({ ok: true, result: true });
  out({ ok: false, error_code: 404, description: 'no such method' }, 404);
}).listen(port, () => console.log(`fake telegram on ${port}`));
