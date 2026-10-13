import { channelMute, channelReact, channelReply, channelSendFile } from '../../connections/manager.js';
import { scheduleWake } from '../../wake.js';
import { createWatch } from '../../watch.js';
import { body } from '../body.js';
import { route } from '../router.js';
import { text } from '../validate.js';

// What an agent does in the chat it is answering, and its timers (`from` is the agent id). The domain errors become 400 in http/errors.ts.
route('POST', '/api/channel/reply', async ({ req }) => { const { from, text: t } = await body(req); return channelReply(text(from), text(t)); });
route('POST', '/api/channel/send-file', async ({ req }) => {
  const { from, path, caption } = await body(req);
  return channelSendFile(text(from), text(path), caption === undefined ? undefined : String(caption));
});
route('POST', '/api/channel/react', async ({ req }) => { const { from, emoji } = await body(req); return channelReact(text(from), emoji as string); });
route('POST', '/api/channel/mute', async ({ req }) => { const { from, muted } = await body(req); return channelMute(text(from), muted !== false); });
route('POST', '/api/wake', async ({ req }) => { const { from, minutes, note } = await body(req); return scheduleWake(text(from), minutes as number, note as string); });
route('POST', '/api/wake-when-done', async ({ req }) => { const b = await body(req); return createWatch(text(b.from), b); });
