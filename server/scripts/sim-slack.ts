// The Slack adapter against a fake Slack (Web API + Socket Mode, see fake-slack.ts): threads, commands, reactions, files and reconnection. No model, no network.
//   HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/sim-slack.ts
import './_guard.js';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeSlack, BOT_USER } from './fake-slack.js';
const { SlackAdapter, slashToCommand } = await import('../src/connections/slack.js');
const { agents } = await import('../src/db.js');
await import('../src/connections/index.js');
const { connections, threads } = await import('../src/connections/store.js');
const { startConnection, stopConnection, connectionStatus } = await import('../src/connections/manager.js');
import type { Inbound } from '../src/connections/types.js';

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 5000) => { const t = Date.now(); while (!f() && Date.now() - t < ms) await sleep(20); return f(); };

const slack = await fakeSlack();
const conn = (config: Record<string, unknown>) => ({ id: `s-${Math.random()}`, kind: 'slack' as const, name: 'slack', agent_id: null, allowed: [], enabled: true, created_at: 0, config: { api_base: slack.base, ...config } });
const startError = async (config: Record<string, unknown>) => { const a = new SlackAdapter(conn(config)); try { await a.start(async () => {}); return 'started'; } catch (e) { return (e as Error).message; } finally { await a.stop(); } };

// ---- credentials ----
check(await startError({ bot_token: 'bad', app_token: 'GOODxapp' }) === 'Invalid bot token', 'a wrong bot token says so');
check(await startError({ bot_token: 'GOODxoxb', app_token: 'bad' }) === 'Invalid app token', 'a wrong app token says so');
check((await startError({ bot_token: 'GOODxoxb', app_token: 'GOODxoxb' })).includes('app-level token (xapp-'), 'the bot token in the app token field is explained');

// ---- the adapter on its own: what reaches the router ----
const got: Inbound[] = [];
const a = new SlackAdapter(conn({ bot_token: 'GOODxoxb', app_token: 'GOODxapp' }));
await a.start(async (m) => { got.push(m); });
check(a.status().state === 'connected' && a.status().detail === '@hivebot · Acme', `it connects over the socket (${JSON.stringify(a.status())})`);
const next = async (n = got.length + 1) => { await until(() => got.length >= n); return got[n - 1]; };

const acked = slack.acks.length;
slack.message({ text: 'hola', channel: 'D42' });
let m = await next();
check(m.externalKey === 'D42' && m.target.chat === 'D42' && m.target.thread === undefined && !m.group && m.addressed && m.place === 'DM' && m.userName === 'maria', 'a DM is flat, addressed, from the person by name');
check(await until(() => slack.acks.length === acked + 1 && slack.acks.at(-1)!.startsWith('env-')), 'each event is acknowledged with its envelope_id');

const root = slack.message({ text: `<@${BOT_USER}> revisa el deploy`, channel: 'C1' });
m = await next();
check(m.externalKey === `C1:${root}` && m.target.thread === root && m.group && m.addressed && m.text === 'revisa el deploy' && m.place === '#deploys', 'a mention in the channel is its own thread root: the reply opens a thread on it');
slack.message({ text: 'y la base?', channel: 'C1', thread_ts: root, parent_user_id: BOT_USER });
m = await next();
check(m.externalKey === `C1:${root}` && m.target.thread === root && m.addressed, 'a reply inside the thread lands on the same key and answers there');
slack.message({ text: 'otra cosa', channel: 'C1' });
m = await next();
check(m.addressed === false, 'channel chatter without a mention is not addressed');
slack.message({ text: `<@U7> mira esto`, channel: 'C1' });
m = await next();
check(m.directedAt === 'pedro' && m.text === '@pedro mira esto', 'a mention of another person is readable and marks the message as theirs');
const before = got.length;
slack.message({ text: 'soy un bot', channel: 'C1', bot_id: 'B9' });
slack.message({ text: 'editado', channel: 'C1', subtype: 'message_changed' });
slack.message({ text: 'yo mismo', channel: 'C1', user: BOT_USER });
slack.message({ text: 'marca', channel: 'D42' });
await next(before + 1);
check(got.length === before + 1 && got.at(-1)!.text === 'marca', 'bot messages, edits and the bot itself are ignored');

slack.push('slash_commands', { command: '/hive', text: 'status', user_id: 'U42', channel_id: 'C1', channel_name: 'deploys', trigger_id: 't1' });
m = await next();
check(m.command?.name === 'status' && m.target.thread === undefined && m.externalKey === 'C1' && m.addressed, 'a slash command reaches the router as a command, answered in the channel');
check(JSON.stringify([slashToCommand('/new', 'confirm'), slashToCommand('/hive-mute', ''), slashToCommand('/hive', '')]) === JSON.stringify([{ name: 'new', args: 'confirm' }, { name: 'mute', args: '' }, { name: 'help', args: '' }]), 'commands as their own slash command, as /hive-<cmd> or as /hive <cmd>');

slack.blobs.set('report.pdf', Buffer.from('%PDF-1.4 hello'));
const fileUrl = slack.base.replace('/api', '/files/report.pdf');
slack.message({ text: '', channel: 'D42', subtype: 'file_share', files: [{ id: 'F9', name: 'report.pdf', mimetype: 'application/pdf', size: 14, url_private_download: fileUrl }, { id: 'F8', name: 'pic.png', mimetype: 'image/png', size: 3, url_private_download: fileUrl }] });
m = await next();
check(m.attachments?.length === 2 && m.attachments[0].kind === 'document' && m.attachments[1].kind === 'image' && m.attachments[0].id === fileUrl, 'files come in the same event');
const dir = mkdtempSync(join(tmpdir(), 'slack-'));
const size = await a.download!(m.attachments![0], join(dir, 'r.pdf'));
check(size === 14 && readFileSync(join(dir, 'r.pdf'), 'utf8') === '%PDF-1.4 hello', 'a file is downloaded with the bot token');
const noScope = new SlackAdapter(conn({ bot_token: 'GOODxoxbNOPE', app_token: 'GOODxapp' }));
check(await noScope.download(m.attachments![0], join(dir, 'x')).then(() => 'ok', (e) => e.message).then((e) => e.includes('files:read')), 'a login page instead of the file says which scope is missing');

// ---- sending ----
await a.send({ chat: 'C1', thread: root }, `**Listo** y \`x<y\` [docs](https://a.b) <@U42>\n\n${'palabra '.repeat(600)}`);
const parts = slack.posted.slice(-2);
check(parts.length === 2 && parts.every((p) => p.channel === 'C1' && p.thread_ts === root && p.text.length <= 3600), 'a long reply is split, every part in the thread');
check(parts[0].text.startsWith('*Listo* y `x&lt;y` <https://a.b|docs> <@U42>'), `markdown is sent as mrkdwn (${parts[0].text.slice(0, 60)})`);
const target = a.proactive({ chat: 'C1', thread: root });
check(target.chat === 'C1' && target.thread === undefined, 'scheduled and proactive messages go to the channel, not the thread');
check(a.mention({ id: 'U42', name: 'maria' }) === '<@U42>', 'a mention is <@id>');
slack.failNext('chat.postMessage', '429');
const t0 = Date.now();
await a.send({ chat: 'C9' }, 'after a 429');
check(slack.posted.at(-1).text === 'after a 429' && Date.now() - t0 >= 900, 'a 429 waits Retry-After and sends again');
slack.failNext('chat.postMessage', 'not_in_channel');
check(await a.send({ chat: 'C9' }, 'x').then(() => 'ok', (e) => e.message).then((e) => e.includes('/invite')), 'not being in the channel is explained');

// ---- reactions ----
await a.react!({ chat: 'C1', thread: root }, root, '👍');
await a.react!({ chat: 'C1' }, root, '❤️');
await a.react!({ chat: 'C1' }, root, ':tada:');
check(JSON.stringify(slack.reactions.map((r) => r.name)) === JSON.stringify(['+1', 'heart', 'tada']) && slack.reactions[0].timestamp === root && slack.reactions[0].channel === 'C1', 'reactions.add gets the emoji name and the message ts');
const refused = await a.react!({ chat: 'C1' }, root, '🖕').then(() => 'ok', (e) => e.message);
check(refused.includes('you can use') && refused.includes('👍') && slack.reactions.length === 3, 'an emoji outside the list is refused before calling Slack, with the list');
slack.failNext('reactions.add', 'already_reacted');
check(await a.react!({ chat: 'C1' }, root, '👍').then(() => 'ok', (e) => e.message) === 'ok', 'reacting twice is not an error');

// ---- files out ----
writeFileSync(join(dir, 'out.txt'), 'hello slack');
const sent = await a.sendFile!({ chat: 'C1', thread: root }, { path: join(dir, 'out.txt'), name: 'out.txt', kind: 'document', mime: 'text/plain' }, 'el **reporte**');
const up = slack.uploads.at(-1);
check(sent.externalId === up.file_id && up.length === 11 && up.bytes === 11 && up.shared && up.channel_id === 'C1' && up.thread_ts === root && up.initial_comment === 'el *reporte*', 'a file goes up in three steps, into the thread, with its caption');

// ---- the socket is refreshed ----
const opened = slack.opened();
slack.disconnect();
await until(() => slack.opened() === opened + 1 && slack.open() === 1);
check(slack.opened() === opened + 1 && slack.open() === 1 && a.status().state === 'connected', 'a disconnect opens a new socket and closes the old one');
slack.message({ text: 'tras reconectar', channel: 'D42' });
m = await next();
check(m.text === 'tras reconectar', 'messages keep arriving after the refresh');

check((await a.test!(['U42'])).includes('greeted 1 of 1') && slack.posted.at(-1).channel === 'D42', 'the test greets each allowed person by DM');
await a.stop();
check(a.status().state === 'stopped', 'it stops');

// ---- through the manager and the router (commands only: no model runs) ----
const agent = agents.create({ name: 'slacky', role: 'worker', provider: 'claude', model: '', cwd: dir, permission: 'acceptEdits' });
const c = connections.create({ kind: 'slack', name: 'acme', agent_id: agent.id, allowed: [{ id: 'U42', admin: true }], config: { api_base: slack.base, bot_token: 'GOODxoxb', app_token: 'GOODxapp', lang: 'en' } });
await startConnection(c.id);
check(connectionStatus(c.id).state === 'connected', 'the manager starts a Slack connection');
const posts = () => slack.posted.length;
let n = posts();
slack.message({ text: 'hello', channel: 'D99', user: 'U99' });
await until(() => posts() > n);
check(slack.posted.at(-1).text.includes('U99') && slack.posted.at(-1).channel === 'D99', 'a stranger is told their Slack id');
n = posts();
const r2 = slack.message({ text: `<@${BOT_USER}> /help`, channel: 'C1' });
await until(() => posts() > n);
check(slack.posted.at(-1).thread_ts === r2 && slack.posted.at(-1).text.includes('/unmute'), '/help in the channel answers in a thread opened on the message');
n = posts();
slack.message({ text: `<@${BOT_USER}> /id`, channel: 'C1', thread_ts: r2 });
await until(() => posts() > n);
check(slack.posted.at(-1).thread_ts === r2 && slack.posted.at(-1).text.includes('U42') && slack.posted.at(-1).text.includes('C1'), '/id inside the thread answers there with both ids');
n = posts();
slack.message({ text: '/mute', channel: 'C1', thread_ts: r2, ts: '1800000000.000001' });
slack.message({ text: '/mute', channel: 'C1', thread_ts: r2, ts: '1800000000.000001' });
await until(() => posts() > n); await sleep(300);
check(posts() === n + 1 && threads.forConnection(c.id).find((t) => t.external_key === `C1:${r2}`)?.muted === true, 'a redelivered message (same ts) is handled once; /mute mutes that thread');
n = posts();
slack.push('slash_commands', { command: '/hive', text: 'reset', user_id: 'U42', channel_id: 'C1', channel_name: 'deploys', trigger_id: 't2' });
await until(() => posts() > n);
check(slack.posted.at(-1).thread_ts === undefined && slack.posted.at(-1).text.includes('/new confirm'), '/reset is /new: it asks for confirmation, in the channel');
await stopConnection(c.id);

await slack.close();
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
