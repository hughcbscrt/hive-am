import { readFileSync, writeFileSync } from 'node:fs';
import { MAX_FILE_BYTES } from './files.js';
import { mdToTelegramHtml, splitMessage } from './format.js';
import { cursors } from './store.js';
import type { AdapterStatus, Attachment, ChannelAdapter, Connection, Inbound, Target } from './types.js';

const MAX_PART = 3500;          // Telegram allows 4096; leave room for the HTML tags added after splitting
const TYPING_EVERY_MS = 4500;   // «typing…» lasts ~5 s
const TYPING_MAX_MS = 20 * 60_000;   // safety net: never pulse for longer than this, whatever happens to the turn
const MIN_GAP_MS = 350;         // stay well under Telegram's ~1 message/second per chat
const ALBUM_WAIT_MS = 1200;     // the photos of an album arrive as separate messages: wait for the rest

class TelegramError extends Error {
  constructor(msg: string, public code: number, public retryAfter?: number) { super(msg); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The files of a Telegram message: photos (the biggest size), documents, audio, voice notes, videos and GIFs. Stickers are ignored. */
function attachmentsOf(msg: any): Attachment[] {
  const id = String(msg.message_id), out: Attachment[] = [];
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const p = msg.photo[msg.photo.length - 1];
    out.push({ id: p.file_id, name: `photo-${id}.jpg`, kind: 'image', mime: 'image/jpeg', size: p.file_size });
  }
  const d = msg.document;
  if (d) out.push({ id: d.file_id, name: d.file_name ?? `file-${id}`, kind: String(d.mime_type ?? '').startsWith('image/') ? 'image' : 'document', mime: d.mime_type, size: d.file_size });
  if (msg.voice) out.push({ id: msg.voice.file_id, name: `voice-${id}.ogg`, kind: 'voice', mime: msg.voice.mime_type ?? 'audio/ogg', size: msg.voice.file_size });
  if (msg.audio) out.push({ id: msg.audio.file_id, name: msg.audio.file_name ?? `${msg.audio.title ?? `audio-${id}`}.mp3`, kind: 'audio', mime: msg.audio.mime_type, size: msg.audio.file_size });
  if (msg.video) out.push({ id: msg.video.file_id, name: msg.video.file_name ?? `video-${id}.mp4`, kind: 'video', mime: msg.video.mime_type ?? 'video/mp4', size: msg.video.file_size });
  if (msg.video_note) out.push({ id: msg.video_note.file_id, name: `videonote-${id}.mp4`, kind: 'video', mime: 'video/mp4', size: msg.video_note.file_size });
  if (msg.animation && !msg.document) out.push({ id: msg.animation.file_id, name: msg.animation.file_name ?? `animation-${id}.mp4`, kind: 'video', mime: msg.animation.mime_type ?? 'video/mp4', size: msg.animation.file_size });
  return out;
}

/** The messages of one album as a single inbound message: the caption (usually on the first), all files, addressed if any part was. */
function mergeAlbum(parts: Inbound[]): Inbound {
  const first = parts[0];
  return { ...first, text: parts.map((p) => p.text).find((t) => t.trim()) ?? '', addressed: parts.some((p) => p.addressed !== false), attachments: parts.flatMap((p) => p.attachments ?? []) };
}

/** Telegram Bot API over plain `fetch`: long polling for updates, so no public URL is needed. */
export class TelegramAdapter implements ChannelAdapter {
  readonly kind = 'telegram' as const;
  private state: AdapterStatus = { state: 'connecting' };
  private me: { id: number; username: string; can_read_all_group_messages?: boolean } | null = null;
  private stopped = false;
  private abort = new AbortController();
  private typing = new Map<string, { timer: ReturnType<typeof setInterval>; refs: Set<string> }>();
  private typingWarned = 0;
  private lastSend = new Map<string, number>();
  private albums = new Map<string, { parts: Inbound[]; timer: ReturnType<typeof setTimeout> }>();

  constructor(private conn: Connection) {}

  private get base() { return `${(this.conn.config.api_base as string) || 'https://api.telegram.org'}/bot${this.conn.config.token}`; }

  private async call<T = any>(method: string, body: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`${this.base}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
    const j: any = await res.json().catch(() => ({}));
    if (!j.ok) throw new TelegramError(j.description ?? `Telegram ${method} failed (${res.status})`, j.error_code ?? res.status, j.parameters?.retry_after);
    return j.result as T;
  }

  async start(onMessage: (m: Inbound) => Promise<void>): Promise<void> {
    this.stopped = false;
    this.abort = new AbortController();
    try {
      this.me = await this.call('getMe');
    } catch (e) {
      this.state = { state: 'error', detail: e instanceof TelegramError && e.code === 401 ? 'Invalid bot token' : (e as Error).message };
      throw new Error(this.state.detail);
    }
    this.state = this.connected();
    void this.poll(onMessage);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.abort.abort();
    for (const t of this.typing.values()) clearInterval(t.timer);
    this.typing.clear();
    for (const a of this.albums.values()) clearTimeout(a.timer);
    this.albums.clear();
    this.state = { state: 'stopped' };
  }

  /** A link to the person's account: it notifies them in a group even without a @username. */
  mention(u: { id: string; name: string }): string { return `[${u.name.replace(/[\[\]]/g, '')}](tg://user?id=${u.id})`; }

  status() { return this.state; }

  /** «Connected», with a warning when the connection listens to whole groups but Telegram's privacy mode hides them. */
  private connected(): AdapterStatus {
    const blind = this.conn.config.group_mode === 'open' && this.me?.can_read_all_group_messages === false;
    return { state: 'connected', detail: `@${this.me?.username}${blind ? ' · privacy mode is on: in groups the bot only sees mentions and replies. Turn it off in @BotFather (/setprivacy → Disable), then remove and re-add the bot to each group.' : ''}` };
  }

  private async poll(onMessage: (m: Inbound) => Promise<void>) {
    let offset = Number(cursors.get(this.conn.id)) || 0;
    let wait = 1000;
    while (!this.stopped) {
      try {
        const updates = await this.call<any[]>('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, this.abort.signal);
        if (this.state.state === 'error') this.state = this.connected();
        wait = 1000;
        for (const u of updates) {
          offset = u.update_id + 1;
          cursors.set(this.conn.id, String(offset));       // moved forward as soon as it is handed over, so a restart never replays it
          const m = this.parse(u.message);
          if (!m) continue;
          this.state = { ...this.state, lastEventAt: Date.now() };
          const deliver = (x: Inbound) => void onMessage(x).catch((e) => console.error('[telegram] handler failed:', e));
          const group = u.message.media_group_id ? `${u.message.chat.id}:${u.message.media_group_id}` : '';
          if (!group) { deliver(m); continue; }
          // An album is one message to the person who sent it: gather its parts and hand them over together.
          const cur = this.albums.get(group);
          if (cur) { cur.parts.push(m); clearTimeout(cur.timer); }
          const entry = cur ?? { parts: [m], timer: undefined as unknown as ReturnType<typeof setTimeout> };
          entry.timer = setTimeout(() => { this.albums.delete(group); deliver(mergeAlbum(entry.parts)); }, ALBUM_WAIT_MS);
          this.albums.set(group, entry);
        }
      } catch (e) {
        if (this.stopped) return;
        const code = e instanceof TelegramError ? e.code : 0;
        this.state = { state: 'error', detail: code === 401 ? 'Invalid bot token' : code === 409 ? 'Another process is polling this bot' : (e as Error).message };
        if (code === 401) return;
        await sleep(code === 409 ? 10_000 : wait);
        wait = Math.min(wait * 2, 30_000);
      }
    }
  }

  /** A Telegram message → what the router understands; null when it is not for us. */
  private parse(msg: any): Inbound | null {
    if (!msg || msg.from?.is_bot || !this.me) return null;
    const attachments = attachmentsOf(msg);
    if (!msg.text && !msg.caption && !attachments.length) return null;
    const chat = msg.chat, isPrivate = chat.type === 'private';
    let text: string = msg.text ?? msg.caption ?? '';

    const cmd = /^\/(\w+)(?:@(\w+))?(?:\s+([\s\S]*))?$/.exec(text);
    if (cmd && cmd[2] && cmd[2].toLowerCase() !== this.me.username.toLowerCase()) return null;   // a command for another bot
    const mention = new RegExp(`@${this.me.username}\\b`, 'i');
    // In a forum topic every message carries a `reply_to_message` that is just the topic's first message (not a real reply to someone).
    const realReply = msg.reply_to_message && !msg.reply_to_message.forum_topic_created && !(msg.is_topic_message && msg.reply_to_message.message_id === msg.message_thread_id) ? msg.reply_to_message : undefined;
    const addressed = isPrivate || !!cmd || mention.test(text) || realReply?.from?.id === this.me.id;
    text = text.replace(mention, '').trim();
    if (!text && !attachments.length) return null;
    // Meant for another person of the chat: a reply to their message, or an @mention / text mention of them.
    const raw: string = msg.text ?? msg.caption ?? '';
    let directedAt: string | undefined;
    const to = realReply?.from;
    if (!isPrivate && to && !to.is_bot && to.id !== this.me.id && to.id !== msg.from?.id) directedAt = to.username ?? to.first_name ?? String(to.id);
    for (const e of (msg.entities ?? msg.caption_entities ?? []) as any[]) {
      if (directedAt || isPrivate) break;
      if (e.type === 'text_mention' && e.user && !e.user.is_bot && e.user.id !== this.me.id) directedAt = e.user.first_name ?? String(e.user.id);
      else if (e.type === 'mention') { const u = raw.slice(e.offset + 1, e.offset + e.length); if (u && u.toLowerCase() !== this.me.username.toLowerCase()) directedAt = u; }
    }

    const topic = msg.is_topic_message && msg.message_thread_id !== undefined ? String(msg.message_thread_id) : undefined;
    const from = msg.from ?? {};
    return {
      externalId: String(msg.message_id),
      externalKey: topic ? `${chat.id}:${topic}` : String(chat.id),
      userId: String(from.id ?? ''),
      userName: from.username ?? from.first_name ?? String(from.id ?? ''),
      text,
      target: { chat: String(chat.id), thread: topic },
      place: isPrivate ? 'DM' : (chat.title ?? String(chat.id)),
      command: cmd ? { name: cmd[1].toLowerCase(), args: (cmd[3] ?? '').trim() } : undefined,
      group: !isPrivate,
      addressed,
      ...(directedAt ? { directedAt } : {}),
      ...(attachments.length ? { attachments } : {}),
    };
  }

  /** Telegram methods that take a file are multipart, not JSON. */
  private async upload(method: string, form: FormData): Promise<any> {
    const res = await fetch(`${this.base}/${method}`, { method: 'POST', body: form });
    const j: any = await res.json().catch(() => ({}));
    if (!j.ok) throw new TelegramError(j.description ?? `Telegram ${method} failed (${res.status})`, j.error_code ?? res.status, j.parameters?.retry_after);
    return j.result;
  }

  async sendFile(to: Target, file: { path: string; name: string; kind: string; mime: string }, caption?: string): Promise<{ externalId: string }> {
    const bytes = readFileSync(file.path);
    const form = (field: string) => {
      const f = new FormData();
      f.set('chat_id', to.chat);
      if (to.thread) f.set('message_thread_id', to.thread);
      if (caption) f.set('caption', caption.slice(0, 1000));
      f.set(field, new Blob([bytes], { type: file.mime }), file.name);
      return f;
    };
    const method = file.kind === 'image' ? 'sendPhoto' : file.kind === 'video' ? 'sendVideo' : file.kind === 'audio' ? 'sendAudio' : 'sendDocument';
    const field = method.slice(4).toLowerCase();
    const sent = await this.withGap(to.chat, () => this.upload(method, form(field)).catch((e) => {
      // A picture Telegram will not show as a photo (too big or odd proportions) still goes as a document.
      if (method === 'sendPhoto' && e instanceof TelegramError && e.code === 400) return this.upload('sendDocument', form('document'));
      throw e;
    }));
    return { externalId: String(sent.message_id) };
  }

  async download(att: Attachment, dest: string): Promise<number> {
    let info: { file_path?: string; file_size?: number };
    try { info = await this.call('getFile', { file_id: att.id }); }
    catch (e) { throw new Error(e instanceof TelegramError && /too big/i.test(e.message) ? 'too big for Telegram bots (limit 20 MB)' : (e as Error).message); }
    if (!info.file_path) throw new Error('Telegram gave no path for the file');
    if ((info.file_size ?? 0) > MAX_FILE_BYTES) throw new Error('too big (limit 20 MB)');
    const base = (this.conn.config.api_base as string) || 'https://api.telegram.org';
    const res = await fetch(`${base}/file/bot${this.conn.config.token}/${info.file_path}`, { signal: this.abort.signal });
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_FILE_BYTES) throw new Error('too big (limit 20 MB)');
    writeFileSync(dest, buf);
    return buf.length;
  }

  async send(to: Target, text: string): Promise<{ externalId: string }> {
    let last = '';
    for (const part of splitMessage(text, MAX_PART)) {
      const base = { chat_id: to.chat, ...(to.thread ? { message_thread_id: Number(to.thread) } : {}), link_preview_options: { is_disabled: true } };
      const sent = await this.withGap(to.chat, () =>
        this.call('sendMessage', { ...base, text: mdToTelegramHtml(part), parse_mode: 'HTML' }).catch((e) => {
          if (e instanceof TelegramError && e.code === 400 && /parse entities/i.test(e.message)) return this.call('sendMessage', { ...base, text: part });
          throw e;
        }));
      last = String(sent.message_id);
    }
    if (this.typing.has(`${to.chat}:${to.thread ?? ''}`)) this.ping(to);   // a sent message cancels «typing…»; the agent is still working
    return { externalId: last };
  }

  /** Keeps one chat's messages spaced out and honours Telegram's `retry_after` when it pushes back. */
  private async withGap<T>(chat: string, fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const gap = MIN_GAP_MS - (Date.now() - (this.lastSend.get(chat) ?? 0));
      if (gap > 0) await sleep(gap);
      this.lastSend.set(chat, Date.now());
      try { return await fn(); }
      catch (e) {
        if (e instanceof TelegramError && e.code === 429 && attempt < 3) { await sleep(Math.min(e.retryAfter ?? 1, 30) * 1000); continue; }
        throw e;
      }
    }
  }

  /** One «typing…» pulse. A failure is logged (once a minute) instead of being swallowed, so a silent problem is visible. */
  private ping(to: Target): void {
    void this.call('sendChatAction', { chat_id: to.chat, action: 'typing', ...(to.thread ? { message_thread_id: Number(to.thread) } : {}) }).catch((e) => {
      if (Date.now() - this.typingWarned > 60_000) { this.typingWarned = Date.now(); console.warn(`[connections] ${this.conn.name}: «typing…» failed: ${(e as Error).message}`); }
    });
  }

  async busy(to: Target, state: 'working' | 'done' | 'failed', ref = ''): Promise<void> {
    const key = `${to.chat}:${to.thread ?? ''}`;
    const cur = this.typing.get(key);
    if (state === 'working') {
      if (cur) { cur.refs.add(ref); return; }
      this.ping(to);
      const since = Date.now();
      const timer = setInterval(() => {
        if (Date.now() - since > TYPING_MAX_MS) { clearInterval(timer); this.typing.delete(key); return; }
        this.ping(to);
      }, TYPING_EVERY_MS);
      this.typing.set(key, { timer, refs: new Set([ref]) });
      return;
    }
    if (!cur) return;
    cur.refs.delete(ref);
    if (!cur.refs.size) { clearInterval(cur.timer); this.typing.delete(key); }
  }

  async test(userIds: string[]): Promise<string> {
    const me = await this.call<{ username: string }>('getMe');
    const failed: string[] = [];
    for (const id of userIds) {
      try { await this.send({ chat: id }, `✅ hive-am is connected as @${me.username}.`); }
      catch (e) { failed.push(`${id}: ${(e as Error).message}`); }
    }
    const ok = userIds.length - failed.length;
    return `@${me.username} · greeted ${ok} of ${userIds.length}${failed.length ? ` (${failed.join('; ')})` : ''}`;
  }
}
