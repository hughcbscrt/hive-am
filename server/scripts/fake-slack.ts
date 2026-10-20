// A stand-in for Slack (Web API + Socket Mode) for tests and manual UI tests. Imported by sim-slack.ts; on its own: npx tsx scripts/fake-slack.ts [port]
// Use `api_base: http://127.0.0.1:<port>/api` in the connection config, with tokens that start with GOOD (`GOODxoxb`, `GOODxapp`).
//   POST /_say {"text":"hi","user":"U42","channel":"D42"}            → a DM (channels starting with C are channels; add "thread_ts")
//   POST /_command {"command":"/hive","text":"status","user":"U42"}   → a slash command
//   GET  /_sent                                                       → what the bot has posted
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';

export const BOT_USER = 'UBOT';

export interface FakeSlack {
  base: string;
  posted: any[]; reactions: any[]; uploads: any[]; acks: string[]; calls: string[];
  /** Bytes served at `${base.replace('/api','')}/files/<name>` (for downloads). */
  blobs: Map<string, Buffer>;
  /** Sockets opened by the adapter so far, and how many are open now. */
  opened: () => number; open: () => number;
  push(type: 'events_api' | 'slash_commands', payload: any): string;
  message(o: { text?: string; user?: string; channel?: string; channel_type?: string; ts?: string; thread_ts?: string; parent_user_id?: string; files?: any[]; bot_id?: string; subtype?: string }): string;
  disconnect(reason?: string): void;
  /** Answers the next calls of `method` with this error (Slack's `ok:false`) or an HTTP 429. */
  failNext(method: string, error: string, times?: number): void;
  close(): Promise<void>;
}

export async function fakeSlack(port = 0): Promise<FakeSlack> {
  const posted: any[] = [], reactions: any[] = [], uploads: any[] = [], acks: string[] = [], calls: string[] = [];
  const blobs = new Map<string, Buffer>();
  const failing = new Map<string, { error: string; times: number }>();
  const sockets = new Set<WebSocket>();
  let opened = 0, ts = 1_700_000_000, env = 0, fileN = 0;
  const nextTs = () => `${++ts}.000100`;

  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url ?? '/', 'http://x');
    const out = (o: unknown, code = 200, headers: Record<string, string> = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(o)); };
    if (url.pathname.startsWith('/files/')) {
      if (req.headers.authorization !== 'Bearer GOODxoxb') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>login</html>'); }
      const b = blobs.get(url.pathname.slice(7)); if (!b) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/octet-stream' }); return res.end(b);
    }
    if (url.pathname.startsWith('/upload/')) { const u = uploads.find((x) => x.file_id === url.pathname.slice(8)); if (u) u.bytes = raw.length; res.writeHead(200); return res.end('OK'); }
    if (url.pathname === '/_sent') return out(posted);
    if (url.pathname === '/_say') { const b = JSON.parse(raw.toString() || '{}'); return out({ ts: api.message({ ...b, channel_type: String(b.channel ?? 'D42').startsWith('D') ? 'im' : 'channel' }) }); }
    if (url.pathname === '/_command') { const b = JSON.parse(raw.toString() || '{}'); api.push('slash_commands', { command: b.command ?? '/hive', text: b.text ?? '', user_id: b.user ?? 'U42', user_name: 'maria', channel_id: b.channel ?? 'D42', channel_name: 'directmessage', trigger_id: `t${++env}` }); return out({ ok: true }); }

    const method = url.pathname.replace(/^\/api\//, '');
    calls.push(method);
    const p = Object.fromEntries(new URLSearchParams(raw.toString()));
    const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
    const f = failing.get(method);
    if (f && f.times > 0) { f.times--; return f.error === '429' ? out({ ok: false, error: 'ratelimited' }, 429, { 'retry-after': '1' }) : out({ ok: false, error: f.error }); }
    if (method === 'apps.connections.open') {
      if (token.startsWith('GOODxoxb')) return out({ ok: false, error: 'not_allowed_token_type' });
      if (!token.startsWith('GOODxapp')) return out({ ok: false, error: 'invalid_auth' });
      return out({ ok: true, url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/socket?ticket=t${++env}` });
    }
    if (!token.startsWith('GOODxoxb')) return out({ ok: false, error: 'invalid_auth' });
    switch (method) {
      case 'auth.test': return out({ ok: true, user_id: BOT_USER, user: 'hivebot', team: 'Acme', team_id: 'T1', bot_id: 'BBOT' });
      case 'users.info': return out({ ok: true, user: { id: p.user, name: p.user.toLowerCase(), profile: { display_name: p.user === 'U42' ? 'maria' : p.user === 'U7' ? 'pedro' : '' } } });
      case 'conversations.info': return out({ ok: true, channel: { id: p.channel, name: p.channel === 'C1' ? 'deploys' : p.channel.toLowerCase() } });
      case 'conversations.open': return out({ ok: true, channel: { id: `D${p.users.slice(1)}` } });
      case 'chat.postMessage': { const t = nextTs(); posted.push({ ...p, ts: t }); return out({ ok: true, channel: p.channel, ts: t }); }
      case 'reactions.add': reactions.push(p); return out({ ok: true });
      case 'files.getUploadURLExternal': { const id = `F${++fileN}`; uploads.push({ file_id: id, filename: p.filename, length: Number(p.length) }); return out({ ok: true, file_id: id, upload_url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/upload/${id}` }); }
      case 'files.completeUploadExternal': { const files = JSON.parse(p.files); const u = uploads.find((x) => x.file_id === files[0].id); Object.assign(u, { shared: true, channel_id: p.channel_id, thread_ts: p.thread_ts, initial_comment: p.initial_comment }); return out({ ok: true, files }); }
      default: return out({ ok: false, error: 'unknown_method' });
    }
  });
  const wss = new WebSocketServer({ server, path: '/socket' });
  wss.on('connection', (ws) => {
    opened++; sockets.add(ws);
    ws.on('close', () => sockets.delete(ws));
    ws.on('message', (d) => { try { const j = JSON.parse(String(d)); if (j.envelope_id) acks.push(j.envelope_id); } catch { /* not ours */ } });
    ws.send(JSON.stringify({ type: 'hello', num_connections: sockets.size, debug_info: { approximate_connection_time: 18060 } }));
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  const api: FakeSlack = {
    base, posted, reactions, uploads, acks, calls, blobs,
    opened: () => opened, open: () => [...sockets].filter((s) => s.readyState === s.OPEN).length,
    push(type, payload) {
      const id = `env-${++env}`;
      const last = [...sockets].filter((s) => s.readyState === s.OPEN).at(-1);
      last?.send(JSON.stringify({ type, envelope_id: id, payload: type === 'events_api' ? { type: 'event_callback', event: payload } : payload, accepts_response_payload: false }));
      return id;
    },
    message(o) {
      const t = o.ts ?? nextTs(), channel = o.channel ?? 'D42';
      api.push('events_api', { type: 'message', user: o.user ?? 'U42', text: o.text ?? '', ts: t, channel, channel_type: o.channel_type ?? (channel.startsWith('D') ? 'im' : 'channel'), ...(o.thread_ts ? { thread_ts: o.thread_ts } : {}), ...(o.parent_user_id ? { parent_user_id: o.parent_user_id } : {}), ...(o.files ? { files: o.files } : {}), ...(o.bot_id ? { bot_id: o.bot_id } : {}), ...(o.subtype ? { subtype: o.subtype } : {}) });
      return t;
    },
    disconnect(reason = 'refresh_requested') { for (const s of sockets) s.send(JSON.stringify({ type: 'disconnect', reason })); },
    failNext(method, error, times = 1) { failing.set(method, { error, times }); },
    close: () => new Promise<void>((r) => { for (const s of sockets) s.terminate(); wss.close(); server.close(() => r()); }),
  };
  return api;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const f = await fakeSlack(Number(process.argv[2] ?? 4460));
  console.log(`fake slack on ${f.base} (bot token GOODxoxb, app token GOODxapp)`);
}
