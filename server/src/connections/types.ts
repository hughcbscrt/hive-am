export type ChannelKind = 'telegram' | 'slack' | 'fake';

/** Where a reply goes, in the platform's own terms. Stored per thread so replies survive a restart. */
export interface Target { chat: string; thread?: string }

export interface Inbound {
  /** Platform id of this message (Slack ts, Telegram message_id): used to drop duplicates. */
  externalId: string;
  /** Identifies the thread: `channel:thread_ts`, `chat:topic`, `chat`. */
  externalKey: string;
  userId: string;
  userName: string;
  text: string;
  target: Target;
  /** Human label of the place the message came from (`#deploys`, `DM`). */
  place: string;
  /** Slash command typed by the user, when the message is one. */
  command?: { name: string; args: string };
}

export interface AdapterStatus { state: 'connecting' | 'connected' | 'error' | 'stopped'; detail?: string; lastEventAt?: number }

/** The only thing a platform has to implement. Everything else (agents, sessions, permissions) is hive-am's. */
export interface ChannelAdapter {
  readonly kind: ChannelKind;
  /** Begin receiving. `onMessage` may run for a whole agent turn: call it without awaiting. */
  start(onMessage: (m: Inbound) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
  /** Send markdown-ish text; the adapter formats it for the platform and splits it when too long. */
  send(to: Target, text: string): Promise<{ externalId: string }>;
  /** Progress cue for the message being handled: «typing…» / a reaction. */
  busy(to: Target, state: 'working' | 'done' | 'failed'): Promise<void>;
  status(): AdapterStatus;
  /** Checks the credentials and greets the allowed users; returns a one-line description (e.g. the bot's name). */
  test?(userIds: string[]): Promise<string>;
}

export interface AllowedUser { id: string; name?: string; admin?: boolean }
export type OnSilent = 'notice' | 'send_text' | 'ignore';

export interface Connection {
  id: string;
  kind: ChannelKind;
  name: string;
  agent_id: string | null;
  /** Tokens and options. Never returned by the API as-is. */
  config: Record<string, any>;
  allowed: AllowedUser[];
  enabled: boolean;
  created_at: number;
}

export interface Thread {
  id: string; connection_id: string; external_key: string; title: string;
  target: Target; last_user: string | null; created_at: number; last_activity: number;
}

/** The message a turn is answering; lets `channel_reply` find the right thread without the agent copying ids. */
export interface Origin {
  connectionId: string; threadId: string; externalKey: string;
  platform: ChannelKind; place: string; userName: string;
  /** Set once the agent has sent something back, so a silent turn can be noticed. */
  replied: boolean;
}
