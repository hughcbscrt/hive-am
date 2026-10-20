import { readFileSync, writeFileSync } from 'node:fs';
import WebSocket from 'ws';
import { MAX_FILE_BYTES } from './files.js';
import { mdToSlackMrkdwn, splitMessage } from './format.js';
import { threads } from './store.js';
import type { AdapterStatus, Attachment, ChannelAdapter, Connection, FileKind, Inbound, Target } from './types.js';

const MAX_PART = 3500;            // Slack takes far more, but long messages are cut in the timeline: keep each part readable
const MIN_GAP_MS = 1000;          // Slack allows about one message per second per channel
const CALL_TIMEOUT_MS = Number(process.env.HIVE_AM_SLACK_TIMEOUT_MS) || 30_000;
const UPLOAD_TIMEOUT_MS = 120_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const HELLO_TIMEOUT_MS = 15_000;  // a socket that does not say hello in this long is not going to
const PING_EVERY_MS = 30_000;     // a half-open socket never errors by itself: ping it, and drop it when it does not answer
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const within = (ms: number, signal?: AbortSignal) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));
const timedOut = (e: unknown) => e instanceof Error && e.name === 'TimeoutError';

/**
 * The emoji the agent may react with on Slack, and the name Slack knows each one by (`reactions.add` takes names, not characters).
 * Slack accepts any standard emoji; this list is the useful ones, without the rude.
 */
export const SLACK_REACTION_NAMES: Record<string, string> = {
  '👍': '+1', '👎': '-1', '❤': 'heart', '🔥': 'fire', '👏': 'clap', '😁': 'grin', '😂': 'joy', '🤣': 'rolling_on_the_floor_laughing', '😅': 'sweat_smile',
  '🤔': 'thinking_face', '🤯': 'exploding_head', '😱': 'scream', '😢': 'cry', '😭': 'sob', '🎉': 'tada', '🤩': 'star-struck', '🙏': 'pray', '👌': 'ok_hand',
  '😍': 'heart_eyes', '💯': '100', '⚡': 'zap', '🏆': 'trophy', '💔': 'broken_heart', '😐': 'neutral_face', '😴': 'sleeping', '👀': 'eyes', '🙈': 'see_no_evil',
  '😇': 'innocent', '🤝': 'handshake', '✍': 'writing_hand', '🤗': 'hugging_face', '🫡': 'saluting_face', '😎': 'sunglasses', '🤷': 'shrug', '🤓': 'nerd_face',
  '✅': 'white_check_mark', '☑': 'ballot_box_with_check', '✔': 'heavy_check_mark', '❌': 'x', '⚠': 'warning', '🚀': 'rocket', '👋': 'wave', '🙌': 'raised_hands',
  '💪': 'muscle', '⏳': 'hourglass_flowing_sand', '🐛': 'bug', '📌': 'pushpin', '⭐': 'star', '🙂': 'slightly_smiling_face', '😊': 'blush', '😉': 'wink', '🆗': 'ok',
  '➕': 'heavy_plus_sign', '🧐': 'face_with_monocle', '💡': 'bulb', '📝': 'memo', '🔍': 'mag', '🛠': 'hammer_and_wrench', '🥳': 'partying_face', '😬': 'grimacing',
  // The rest of Telegram's list, so an agent that learnt that list is never refused on Slack.
  '🥰': 'smiling_face_with_3_hearts', '🕊': 'dove_of_peace', '🤡': 'clown_face', '🥱': 'yawning_face', '🥴': 'woozy_face', '🐳': 'whale', '❤‍🔥': 'heart_on_fire',
  '🌚': 'new_moon_with_face', '🌭': 'hotdog', '🍌': 'banana', '🤨': 'face_with_raised_eyebrow', '🍓': 'strawberry', '🍾': 'champagne', '💋': 'kiss', '😈': 'smiling_imp',
  '👻': 'ghost', '👨‍💻': 'male-technologist', '🎃': 'jack_o_lantern', '😨': 'fearful', '🎅': 'santa', '🎄': 'christmas_tree', '☃': 'snowman', '💅': 'nail_care',
  '🤪': 'zany_face', '🗿': 'moyai', '🆒': 'cool', '💘': 'cupid', '🙉': 'hear_no_evil', '🦄': 'unicorn_face', '😘': 'kissing_heart', '💊': 'pill', '🙊': 'speak_no_evil',
  '👾': 'space_invader', '🤷‍♂': 'man-shrugging', '🤷‍♀': 'woman-shrugging',
};
export const SLACK_REACTIONS = Object.keys(SLACK_REACTION_NAMES);
const NAME_OF = new Map(Object.entries(SLACK_REACTION_NAMES).map(([e, n]) => [e.replace(/️/g, ''), n]));
const KNOWN_NAMES = new Set([...Object.values(SLACK_REACTION_NAMES), 'thumbsup', 'thumbsdown']);

/** The commands hive-am understands (router.ts). On Slack they may come as their own slash command, as `/hive-status`, or as `/hive status`. */
const COMMANDS = new Set(['new', 'clear', 'reset', 'stop', 'status', 'mute', 'unmute', 'help', 'id']);
export function slashToCommand(command: string, text: string): { name: string; args: string } {
  const name = command.replace(/^\//, '').toLowerCase(), args = text.trim();
  if (COMMANDS.has(name)) return { name, args };
  const suffix = /[-_](\w+)$/.exec(name)?.[1];
  if (suffix && COMMANDS.has(suffix)) return { name: suffix, args };
  const [first = 'help', ...rest] = args ? args.split(/\s+/) : [];
  return { name: first.replace(/^\//, '').toLowerCase(), args: rest.join(' ') };
}

class SlackError extends Error {
  constructor(msg: string, public code: string, public method: string, public retryAfter?: number) { super(msg); }
}
const AUTH_ERRORS = new Set(['invalid_auth', 'not_authed', 'account_inactive', 'token_revoked', 'token_expired']);

/** What a Slack API error means to the person setting up the connection. */
function readable(e: SlackError, method = e.method): string {
  if (AUTH_ERRORS.has(e.code)) return method === 'apps.connections.open' ? 'Invalid app token' : 'Invalid bot token';
  if (e.code === 'not_allowed_token_type') return method === 'apps.connections.open' ? 'The app token must be an app-level token (xapp-…) with connections:write' : 'The bot token must be a bot token (xoxb-…)';
  if (e.code === 'missing_scope') return `The Slack app lacks a permission for ${method}: add the scopes from the manual and reinstall it`;
  if (e.code === 'not_in_channel') return 'The app is not in this channel: invite it with /invite @your-app';
  if (e.code === 'channel_not_found') return 'Slack does not know this channel (or the app cannot see it)';
  return e.message;
}

/** The files of a Slack message (they come in the event itself, so there is nothing to assemble). The download URL is the attachment's id. */
function attachmentsOf(ev: any): Attachment[] {
  const out: Attachment[] = [];
  for (const f of (Array.isArray(ev.files) ? ev.files : []) as any[]) {
    const url = f.url_private_download ?? f.url_private;
    if (!url || f.mode === 'tombstone' || f.file_access === 'check_file_info') continue;
    const mime = String(f.mimetype ?? '');
    const kind: FileKind = f.subtype === 'slack_audio' ? 'voice' : mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : 'document';
    out.push({ id: url, name: f.name ?? f.title ?? `file-${f.id}`, kind, mime: mime || undefined, size: f.size });
  }
  return out;
}

/** Slack Web API over plain `fetch` and Socket Mode over a WebSocket: events come through a socket this machine opens, so no public URL is needed. */
export class SlackAdapter implements ChannelAdapter {
  readonly kind = 'slack' as const;
  private state: AdapterStatus = { state: 'connecting' };
  private me: { user_id: string; user: string; team: string } | null = null;
  private stopped = false;
  private abort = new AbortController();
  private ws: WebSocket | null = null;
  private reconnecting = false;
  private pinger: ReturnType<typeof setInterval> | undefined;
  private alive = true;
  private onMessage: ((m: Inbound) => Promise<void>) | null = null;
  private order: Promise<void> = Promise.resolve();   // events are parsed one after another, so they reach the router in the order they came
  private lastSend = new Map<string, number>();
  private names = new Map<string, string>();     // user id → display name
  private places = new Map<string, string>();    // channel id → `#name`

  constructor(private conn: Connection) {}

  private get base() { return ((this.conn.config.api_base as string) || 'https://slack.com/api').replace(/\/$/, ''); }

  /** One Web API call, form-encoded (every method takes it; objects go as JSON, as Slack expects). */
  private async api<T = any>(method: string, params: Record<string, unknown> = {}, token = this.conn.config.bot_token as string): Promise<T> {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    let res: Response;
    try { res = await fetch(`${this.base}/${method}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' }, body, signal: within(CALL_TIMEOUT_MS, this.abort.signal) }); }
    catch (e) { throw timedOut(e) ? new SlackError(`Slack ${method} did not answer in time`, 'timeout', method) : e; }
    if (res.status === 429) throw new SlackError(`Slack ${method} is rate limited`, 'ratelimited', method, Number(res.headers.get('retry-after')) || 1);
    const j: any = await res.json().catch(() => ({}));
    if (!j.ok) throw new SlackError(j.error ? `Slack ${method}: ${j.error}` : `Slack ${method} failed (${res.status})`, j.error ?? String(res.status), method);
    return j as T;
  }

  async start(onMessage: (m: Inbound) => Promise<void>): Promise<void> {
    this.stopped = false;
    this.abort = new AbortController();
    this.onMessage = onMessage;
    clearInterval(this.pinger);
    this.pinger = setInterval(() => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (!this.alive) { ws.terminate(); return; }   // `close` follows and reconnects
      this.alive = false;
      ws.ping();
    }, PING_EVERY_MS);
    this.pinger.unref?.();
    try {
      this.me = await this.api('auth.test');
      await this.connect();
    } catch (e) {
      this.state = { state: 'error', detail: e instanceof SlackError ? readable(e) : (e as Error).message };
      if (!(e instanceof SlackError && AUTH_ERRORS.has(e.code))) this.reconnect();   // a network problem at start: keep trying, like Telegram's polling does
      throw new Error(this.state.detail);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.abort.abort();
    clearInterval(this.pinger);
    const ws = this.ws;
    this.ws = null;
    ws?.terminate();
    this.onMessage = null;
    this.state = { state: 'stopped' };
  }

  status() { return this.state; }

  private connected(): AdapterStatus { return { state: 'connected', detail: `@${this.me?.user} · ${this.me?.team}`, lastEventAt: this.state.lastEventAt }; }

  /** Opens a socket (`apps.connections.open` gives its URL) and resolves on Slack's `hello`. The previous socket, if any, is closed only then, so a refresh loses nothing. */
  private async connect(): Promise<void> {
    const { url } = await this.api<{ url: string }>('apps.connections.open', {}, this.conn.config.app_token as string);
    if (this.stopped) return;
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      let hello = false;
      const timer = setTimeout(() => { ws.terminate(); reject(new Error('Slack did not open the socket in time')); }, HELLO_TIMEOUT_MS);
      ws.on('message', (data) => {
        let f: any;
        try { f = JSON.parse(String(data)); } catch { return; }
        if (f.type === 'hello') {
          hello = true; clearTimeout(timer);
          const old = this.ws;
          this.ws = ws; this.alive = true; this.state = this.connected();
          if (old && old !== ws) old.close();
          resolve();
          return;
        }
        this.frame(ws, f);
      });
      ws.on('pong', () => { this.alive = true; });
      ws.on('error', (e) => { if (!hello) { clearTimeout(timer); reject(e); } else console.warn(`[slack] ${this.conn.name}: socket error: ${e.message}`); });
      ws.on('close', () => {
        if (!hello) { clearTimeout(timer); reject(new Error('Slack closed the socket before it opened')); return; }
        if (this.ws === ws) { this.ws = null; this.reconnect(); }   // a socket replaced by a newer one closes quietly
      });
    });
    if (this.stopped) ws.terminate();
  }

  /** Opens a new socket, waiting longer after each failure. A rejected token stops it: retrying will not fix that. */
  private reconnect(): void {
    if (this.stopped || this.reconnecting) return;
    this.reconnecting = true;
    void (async () => {
      let wait = 1000;
      while (!this.stopped) {
        try {
          if (!this.me) this.me = await this.api('auth.test');
          await this.connect();
          break;
        } catch (e) {
          if (this.stopped) break;
          this.state = { state: 'error', detail: e instanceof SlackError ? readable(e) : (e as Error).message };
          if (e instanceof SlackError && AUTH_ERRORS.has(e.code)) break;
          await sleep(e instanceof SlackError && e.retryAfter ? e.retryAfter * 1000 : wait);
          wait = Math.min(wait * 2, 30_000);
        }
      }
      this.reconnecting = false;
    })();
  }

  /** One frame of the socket. Acknowledged first, so a slow turn never makes Slack send it again. */
  private frame(ws: WebSocket, f: any): void {
    if (f.envelope_id) ws.send(JSON.stringify({ envelope_id: f.envelope_id }));
    if (f.type === 'disconnect') { if (this.ws === ws) this.reconnect(); return; }   // Slack refreshes the socket every few hours
    const parsed = f.type === 'events_api' ? () => this.parseEvent(f.payload?.event) : f.type === 'slash_commands' ? () => this.parseCommand(f.payload) : null;
    if (!parsed) return;
    this.order = this.order.then(async () => {
      const m = await parsed();
      if (!m || !this.onMessage) return;
      this.state = { ...this.state, lastEventAt: Date.now() };
      void this.onMessage(m).catch((e) => console.error('[slack] handler failed:', e));
    }).catch((e) => console.error(`[slack] ${this.conn.name}: could not read an event:`, e));
  }

  private async userName(id: string): Promise<string> {
    if (!id) return '';
    const known = this.names.get(id);
    if (known) return known;
    try {
      const { user } = await this.api('users.info', { user: id });
      const name = user?.profile?.display_name || user?.real_name || user?.name || id;
      this.names.set(id, name);
      return name;
    } catch { return id; }
  }

  private async placeOf(channel: string, type: string): Promise<string> {
    if (type === 'im') return 'DM';
    const known = this.places.get(channel);
    if (known) return known;
    let place = type === 'mpim' ? 'group DM' : `#${channel}`;
    try { const { channel: c } = await this.api('conversations.info', { channel }); if (c?.name && type !== 'mpim') place = `#${c.name}`; }
    catch { /* without channels:read the id has to do */ }
    this.places.set(channel, place);
    return place;
  }

  /** Slack's markup the agent should read as plain text: `<@U1>` → `@name`, `<#C1|deploys>` → `#deploys`, `<url|label>` → `label (url)`. */
  private async plain(text: string): Promise<string> {
    const ids = [...new Set([...text.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g)].map((x) => x[1]))];
    const named = new Map(await Promise.all(ids.map(async (id) => [id, await this.userName(id)] as const)));
    return text
      .replace(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g, (_m, id) => `@${named.get(id) ?? id}`)
      .replace(/<#[CG][A-Z0-9]+\|([^>]*)>/g, '#$1').replace(/<#([CG][A-Z0-9]+)>/g, '#$1')
      .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, '@$1').replace(/<!subteam\^[A-Z0-9]+\|([^>]*)>/g, '$1')
      .replace(/<((?:https?|mailto):[^|>]+)\|([^>]+)>/g, '$2 ($1)').replace(/<((?:https?|mailto):[^>]+)>/g, '$1')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }

  /** A Slack message event → what the router understands; null when it is not for us. */
  private async parseEvent(ev: any): Promise<Inbound | null> {
    if (!ev || !this.me || (ev.type !== 'message' && ev.type !== 'app_mention')) return null;
    if (ev.bot_id || ev.user === this.me.user_id || !ev.user || ev.hidden) return null;
    if (ev.subtype && ev.subtype !== 'file_share' && ev.subtype !== 'thread_broadcast') return null;   // edits, deletions, joins…
    const channel = String(ev.channel ?? '');
    const type: string = ev.channel_type ?? (channel.startsWith('D') ? 'im' : 'channel');
    const dm = type === 'im';
    const raw: string = ev.text ?? '';
    const self = new RegExp(`<@${this.me.user_id}(?:\\|[^>]*)?>`, 'g');
    const mentioned = ev.type === 'app_mention' || self.test(raw);
    const attachments = attachmentsOf(ev);
    const text = (await this.plain(raw.replace(self, ''))).trim();
    if (!text && !attachments.length) return null;

    // One conversation is one Slack thread: a message in the timeline is the root of its own thread.
    const root = String(ev.thread_ts ?? ev.ts);
    const key = dm ? channel : `${channel}:${root}`;
    const inThread = !!ev.thread_ts && ev.thread_ts !== ev.ts;
    const cmd = /^\/(\w+)(?:\s+([\s\S]*))?$/.exec(text);
    const ownThread = inThread && (ev.parent_user_id === this.me.user_id || threads.answered(this.conn.id, key));
    const addressed = dm || mentioned || !!cmd || ownThread;
    // Meant for another person of the channel: an @mention of somebody else (and not of the agent).
    let directedAt: string | undefined;
    if (!dm && !mentioned) {
      const other = [...raw.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g)].map((x) => x[1]).find((id) => id !== ev.user && id !== this.me!.user_id);
      if (other) directedAt = await this.userName(other);
    }
    return {
      externalId: String(ev.ts),
      externalKey: key,
      userId: String(ev.user),
      userName: await this.userName(String(ev.user)),
      text,
      target: dm ? { chat: channel } : { chat: channel, thread: root },
      place: await this.placeOf(channel, type),
      command: cmd ? { name: cmd[1].toLowerCase(), args: (cmd[2] ?? '').trim() } : undefined,
      group: !dm,
      addressed,
      ...(directedAt ? { directedAt } : {}),
      ...(attachments.length ? { attachments } : {}),
    };
  }

  /** A slash command. Slack sends no thread with it, so the answer goes to the channel (or the DM) it was typed in. */
  private async parseCommand(p: any): Promise<Inbound | null> {
    if (!p?.command || !p.channel_id || !p.user_id) return null;
    const channel = String(p.channel_id), dm = channel.startsWith('D');
    const type = dm ? 'im' : p.channel_name === 'mpdm' || String(p.channel_name ?? '').startsWith('mpdm-') ? 'mpim' : 'channel';
    const command = slashToCommand(String(p.command), String(p.text ?? ''));
    return {
      externalId: `cmd-${p.trigger_id ?? Date.now()}`,
      externalKey: channel,
      userId: String(p.user_id),
      userName: await this.userName(String(p.user_id)),
      text: `/${command.name}${command.args ? ` ${command.args}` : ''}`,
      target: { chat: channel },
      place: dm ? 'DM' : p.channel_name && p.channel_name !== 'privategroup' && type === 'channel' ? `#${p.channel_name}` : await this.placeOf(channel, type),
      command,
      group: !dm,
      addressed: true,
    };
  }

  /** Keeps one channel's messages spaced out and honours Slack's `Retry-After` when it pushes back. */
  private async withGap<T>(chat: string, fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const gap = MIN_GAP_MS - (Date.now() - (this.lastSend.get(chat) ?? 0));
      if (gap > 0) await sleep(gap);
      this.lastSend.set(chat, Date.now());
      try { return await fn(); }
      catch (e) {
        if (e instanceof SlackError && e.code === 'ratelimited' && attempt < 3) { await sleep(Math.min(e.retryAfter ?? 1, 30) * 1000); continue; }
        throw e instanceof SlackError ? new Error(readable(e)) : e;
      }
    }
  }

  async send(to: Target, text: string): Promise<{ externalId: string }> {
    let last = '';
    for (const part of splitMessage(text, MAX_PART)) {
      const sent = await this.withGap(to.chat, () => this.api<{ ts: string }>('chat.postMessage', { channel: to.chat, thread_ts: to.thread, text: mdToSlackMrkdwn(part), unfurl_links: false, unfurl_media: false }));
      last = String(sent.ts);
    }
    return { externalId: last };
  }

  /** Slack has no «typing…» for bots, and a reaction on every message would be noise: nothing is shown while a turn runs. */
  async busy(): Promise<void> {}

  /** Scheduled messages and notices go to the channel's timeline, not into the thread they were asked from. A DM has no threads. */
  proactive(to: Target): Target { return { chat: to.chat }; }

  /** `<@U123>` notifies the person. */
  mention(u: { id: string; name: string }): string { return `<@${u.id}>`; }

  /** What the agent may react with on Slack; each emoji goes to `reactions.add` by its name. `:name:` is accepted too. */
  readonly reactions = SLACK_REACTIONS;
  async react(to: Target, ref: string, emoji: string): Promise<void> {
    const wanted = emoji.replace(/️/g, '').trim();
    const byName = /^:?([a-z0-9_+-]+):?$/.exec(wanted)?.[1];
    const name = byName && KNOWN_NAMES.has(byName) ? byName : NAME_OF.get(wanted);
    if (!name) throw new Error(`“${emoji}” is not one of the reactions hive-am uses on Slack. The ones you can use: ${SLACK_REACTIONS.join(' ')}`);
    if (!ref || ref.startsWith('sched-') || ref.startsWith('cmd-')) throw new Error('There is no message to react to.');
    try { await this.api('reactions.add', { channel: to.chat, timestamp: ref, name }); }
    catch (e) {
      if (e instanceof SlackError && e.code === 'already_reacted') return;
      if (e instanceof SlackError && e.code === 'invalid_name') throw new Error(`Slack does not know the emoji “${emoji}”. Try another one, or answer with text.`);
      throw e instanceof SlackError ? new Error(readable(e)) : e;
    }
  }

  /** Slack's upload in three steps: ask for an upload URL, send the bytes there, then share the file in the channel (and thread) with the caption. */
  async sendFile(to: Target, file: { path: string; name: string; kind: string; mime: string }, caption?: string): Promise<{ externalId: string }> {
    const bytes = readFileSync(file.path);
    try {
      const up = await this.api<{ upload_url: string; file_id: string }>('files.getUploadURLExternal', { filename: file.name, length: bytes.length });
      const res = await fetch(up.upload_url, { method: 'POST', headers: { 'content-type': file.mime || 'application/octet-stream' }, body: bytes, signal: within(UPLOAD_TIMEOUT_MS, this.abort.signal) });
      if (!res.ok) throw new Error(`Slack did not take the file (${res.status})`);
      await this.withGap(to.chat, () => this.api('files.completeUploadExternal', {
        files: [{ id: up.file_id, title: file.name }], channel_id: to.chat, thread_ts: to.thread, initial_comment: caption ? mdToSlackMrkdwn(caption) : undefined,
      }));
      return { externalId: up.file_id };
    } catch (e) {
      throw e instanceof SlackError ? new Error(readable(e)) : timedOut(e) ? new Error('Slack did not take the file in time') : e;
    }
  }

  /** Files are private: the URL needs the bot token (and the `files:read` scope; without it Slack answers with a login page). */
  async download(att: Attachment, dest: string): Promise<number> {
    const res = await fetch(att.id, { headers: { authorization: `Bearer ${this.conn.config.bot_token}` }, signal: within(DOWNLOAD_TIMEOUT_MS, this.abort.signal) });
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    if (/text\/html/i.test(res.headers.get('content-type') ?? '') && !/html/i.test(att.mime ?? '')) throw new Error('Slack answered with a login page: the app needs the files:read scope');
    if (Number(res.headers.get('content-length') ?? 0) > MAX_FILE_BYTES) throw new Error('too big (limit 20 MB)');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_FILE_BYTES) throw new Error('too big (limit 20 MB)');
    writeFileSync(dest, buf);
    return buf.length;
  }

  /** Checks the bot token and greets each allowed person by DM. */
  async test(userIds: string[]): Promise<string> {
    let me: { user: string; team: string };
    try { me = await this.api('auth.test'); }
    catch (e) { throw e instanceof SlackError ? new Error(readable(e)) : e; }
    const failed: string[] = [];
    for (const id of userIds) {
      try {
        const { channel } = await this.api<{ channel: { id: string } }>('conversations.open', { users: id });
        await this.send({ chat: channel.id }, `✅ hive-am is connected as @${me.user} in ${me.team}.`);
      } catch (e) { failed.push(`${id}: ${e instanceof SlackError ? readable(e) : (e as Error).message}`); }
    }
    const ok = userIds.length - failed.length;
    return `@${me.user} · ${me.team} · greeted ${ok} of ${userIds.length}${failed.length ? ` (${failed.join('; ')})` : ''}`;
  }
}
