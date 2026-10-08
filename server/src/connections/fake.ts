import type { AdapterStatus, ChannelAdapter, Inbound, Target } from './types.js';

/** In-memory platform used by the simulation script: records what the agent sends and lets a test type as a user. */
export class FakeAdapter implements ChannelAdapter {
  readonly kind = 'fake' as const;
  sent: { to: Target; text: string }[] = [];
  cues: { to: Target; state: string }[] = [];
  private onMessage: ((m: Inbound) => Promise<void>) | null = null;
  private n = 0;

  async start(onMessage: (m: Inbound) => Promise<void>) { this.onMessage = onMessage; }
  async stop() { this.onMessage = null; }
  async send(to: Target, text: string) { this.sent.push({ to, text }); return { externalId: `out-${++this.n}` }; }
  async busy(to: Target, state: 'working' | 'done' | 'failed') { this.cues.push({ to, state }); }
  status(): AdapterStatus { return { state: this.onMessage ? 'connected' : 'stopped' }; }

  /** Types a message as `userId` in thread `key`; resolves when the agent's turn is over. */
  say(key: string, text: string, userId = 'u1', externalId = `in-${++this.n}`, opts: { group?: boolean; addressed?: boolean } = {}) {
    const [chat, thread] = key.split(':');
    const command = /^\/(\w+)(?:\s+(.*))?$/.exec(text);
    return this.onMessage!({
      externalId, externalKey: key, userId, userName: userId, text, place: `#${chat}`, target: { chat, thread },
      command: command ? { name: command[1], args: command[2] ?? '' } : undefined,
      group: opts.group, addressed: opts.addressed,
    });
  }
}
