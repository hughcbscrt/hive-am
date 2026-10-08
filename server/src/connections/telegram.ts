import { mdToTelegramHtml, splitMessage } from './format.js';
import { cursors } from './store.js';
import type { AdapterStatus, ChannelAdapter, Connection, Inbound, Target } from './types.js';

const MAX_PART = 3500;          // Telegram allows 4096; leave room for the HTML tags added after splitting
const TYPING_EVERY_MS = 4500;   // «typing…» lasts ~5 s
const MIN_GAP_MS = 350;         // stay well under Telegram's ~1 message/second per chat

class TelegramError extends Error {
  constructor(msg: string, public code: number, public retryAfter?: number) { super(msg); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Telegram Bot API over plain `fetch`: long polling for updates, so no public URL is needed. */
export class TelegramAdapter implements ChannelAdapter {
  readonly kind = 'telegram' as const;
  private state: AdapterStatus = { state: 'connecting' };
  private me: { id: number; username: string; can_read_all_group_messages?: boolean } | null = null;
  private stopped = false;
  private abort = new AbortController();
  private typing = new Map<string, ReturnType<typeof setInterval>>();
  private lastSend = new Map<string, number>();

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
    for (const t of this.typing.values()) clearInterval(t);
    this.typing.clear();
    this.state = { state: 'stopped' };
  }

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
          if (m) { this.state = { ...this.state, lastEventAt: Date.now() }; void onMessage(m).catch((e) => console.error('[telegram] handler failed:', e)); }
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
    if (!msg?.text || msg.from?.is_bot || !this.me) return null;
    const chat = msg.chat, isPrivate = chat.type === 'private';
    let text: string = msg.text;

    const cmd = /^\/(\w+)(?:@(\w+))?(?:\s+([\s\S]*))?$/.exec(text);
    if (cmd && cmd[2] && cmd[2].toLowerCase() !== this.me.username.toLowerCase()) return null;   // a command for another bot
    const mention = new RegExp(`@${this.me.username}\\b`, 'i');
    const addressed = isPrivate || !!cmd || mention.test(text) || msg.reply_to_message?.from?.id === this.me.id;
    text = text.replace(mention, '').trim();
    if (!text) return null;

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
    };
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

  async busy(to: Target, state: 'working' | 'done' | 'failed'): Promise<void> {
    const key = `${to.chat}:${to.thread ?? ''}`;
    const old = this.typing.get(key); if (old) { clearInterval(old); this.typing.delete(key); }
    if (state !== 'working') return;
    const ping = () => void this.call('sendChatAction', { chat_id: to.chat, action: 'typing', ...(to.thread ? { message_thread_id: Number(to.thread) } : {}) }).catch(() => undefined);
    ping();
    this.typing.set(key, setInterval(ping, TYPING_EVERY_MS));
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
