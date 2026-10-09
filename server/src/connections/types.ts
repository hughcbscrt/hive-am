export type ChannelKind = 'telegram' | 'slack' | 'fake';

/** Where a reply goes, in the platform's own terms. Stored per thread so replies survive a restart. */
export interface Target { chat: string; thread?: string }

export type FileKind = 'image' | 'document' | 'audio' | 'voice' | 'video';
/** A file that came with a message, as the platform describes it (not downloaded yet). */
export interface Attachment { id: string; name: string; kind: FileKind; mime?: string; size?: number }
/** A downloaded attachment: where it is on this machine. */
export interface SavedFile {
  path: string; name: string; kind: FileKind; mime?: string; size: number;
  /** What an image model saw in the picture (see vision.ts), and which one; or why it could not. */
  description?: string; describedBy?: string; descriptionError?: string;
}

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
  /** Sent in a group/channel rather than a private chat. */
  group?: boolean;
  /** False for group chatter nobody aimed at the agent (no mention, reply or command). Missing means addressed. */
  addressed?: boolean;
  /** Files that came with the message; the router downloads them (after the sender is authorized) and fills `files`. */
  attachments?: Attachment[];
  files?: SavedFile[];
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
  /** Sends a file (checked beforehand by outbound.ts) to a chat. */
  sendFile?(to: Target, file: { path: string; name: string; kind: FileKind; mime: string }, caption?: string): Promise<{ externalId: string }>;
  /** Downloads one attachment to `dest` and returns its size in bytes; throws when it is too big or gone. */
  download?(att: Attachment, dest: string): Promise<number>;
  /** Checks the credentials and greets the allowed users; returns a one-line description (e.g. the bot's name). */
  test?(userIds: string[]): Promise<string>;
}

export interface AllowedUser { id: string; name?: string; admin?: boolean }
/** A group the whole membership of which may talk to the agent (no need to list each person). */
export interface AllowedChat { id: string; name?: string }
export type GroupMode = 'mention' | 'open';
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
  /** The agent was asked to keep quiet here: it only hears messages aimed at it. */
  muted: boolean;
  /** Highest inbound message id the agent has been shown, so the rest can be handed over as context. */
  seen_id: number;
}

/** The message a turn is answering; lets `channel_reply` find the right thread without the agent copying ids. */
export interface Origin {
  connectionId: string; threadId: string; externalKey: string;
  platform: ChannelKind; place: string; userName: string;
  /** False when the message was group chatter: staying silent is then a normal outcome. */
  addressed: boolean;
  /** Set once the agent has sent something back, so a silent turn can be noticed. */
  replied: boolean;
}
