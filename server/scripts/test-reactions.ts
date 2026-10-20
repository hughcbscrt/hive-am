// Reactions of an agent in a chat: only the emoji Telegram allows (and Slack's emoji → name table), the error that says which ones, and the skill that explains them. No model, no network. Usage: HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-reactions.ts
import './_guard.js';
import { TELEGRAM_REACTIONS, TelegramAdapter } from '../src/connections/telegram.js';
import { REACTIONS_SECTION, DEFAULT_SKILLS } from '../src/skills/defaults.js';

let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); if (!ok) fail++; };

const sent: any[] = [];
let reply: any = { ok: true, result: true };
(globalThis as any).fetch = async (url: string, init: any) => { sent.push({ url, body: JSON.parse(init.body) }); return { status: 200, json: async () => reply } as any; };
const adapter = new TelegramAdapter({ id: 'x', kind: 'telegram', name: 'x', agent_id: null, config: { token: 't' }, allowed: [], enabled: true, created_at: 0 } as any);
const to = { chat: '-100', thread: '7' } as any;
const tryReact = async (emoji: string) => { try { await adapter.react(to, '42', emoji); return 'ok'; } catch (e) { return (e as Error).message; } };

eq('a thumbs-up goes to setMessageReaction on that message', [await tryReact('👍'), sent.at(-1).url.endsWith('/setMessageReaction'), sent.at(-1).body.message_id, sent.at(-1).body.reaction], ['ok', true, 42, [{ type: 'emoji', emoji: '👍' }]]);
eq('a heart written with the variation selector is sent as Telegram spells it', [await tryReact('❤️'), sent.at(-1).body.reaction[0].emoji], ['ok', '❤']);
const n = sent.length;
const bad = await tryReact('✅');
eq('an emoji Telegram does not allow is refused before calling it, and the error lists the allowed ones', [sent.length, bad.includes('does not allow') && bad.includes('👍') && bad.includes('🫡')], [n, true]);
eq('so is a laughing face that is not in the list', (await tryReact('😂')).includes('does not allow'), true);
eq('the rude ones are left out', ['🖕', '🤬', '💩', '🤮', '😡'].some((e) => (TELEGRAM_REACTIONS as readonly string[]).includes(e)), false);
reply = { ok: false, error_code: 400, description: 'Bad Request: REACTION_INVALID' };
eq('a group that limits reactions gives a readable error', (await tryReact('🔥')).includes('does not accept'), true);
eq('without a message there is nothing to react to', await (async () => { try { await adapter.react(to, '', '👍'); return 'ok'; } catch (e) { return (e as Error).message; } })(), 'There is no message to react to.');

// Slack reacts by name: every emoji of its list has one, and none of the rude ones is there.
const { SLACK_REACTION_NAMES, SLACK_REACTIONS } = await import('../src/connections/slack.js');
eq('slack: every allowed emoji has a Slack name', SLACK_REACTIONS.filter((e) => !/^[a-z0-9_+-]+$/.test(SLACK_REACTION_NAMES[e] ?? '')), []);
eq('slack: thumbs up, heart and tada by their names', [SLACK_REACTION_NAMES['👍'], SLACK_REACTION_NAMES['❤'], SLACK_REACTION_NAMES['🎉']], ['+1', 'heart', 'tada']);
eq('slack: everything Telegram allows works on Slack too', TELEGRAM_REACTIONS.filter((e) => !SLACK_REACTIONS.includes(e)), []);
eq('slack: the rude ones are left out', ['🖕', '🤬', '💩', '🤮', '😡'].some((e) => SLACK_REACTIONS.includes(e)), false);

const skill = DEFAULT_SKILLS.find((s) => s.slug === 'channels')!.content;
eq('the Chat channels skill carries the section', skill.includes(REACTIONS_SECTION) && skill.indexOf('## Reactions') < skill.indexOf('## Keeping quiet'), true);
eq('every emoji the skill lists for Telegram is really allowed', [...REACTIONS_SECTION.match(/this list: ([^.]*)\./)![1].split(' ')].filter((e) => !(TELEGRAM_REACTIONS as readonly string[]).includes(e)), []);
// A library that already had the skill (without the section, maybe edited by the person) learns about reactions once.
import { skills } from '../src/db.js';
import { addReactionsToChannelSkill } from '../src/connections/channel-skill.js';
skills.seedDefaults(DEFAULT_SKILLS);
const old = skills.get('default-channels')!.content.replace(REACTIONS_SECTION, '').replace('## Answering', '## Answering\n(my own rule)');
skills.update('default-channels', { content: old });
addReactionsToChannelSkill();
const after = skills.get('default-channels')!.content;
eq('the section is added before "Keeping quiet" and the person\'s edit stays', [after.includes('(my own rule)'), after.indexOf('## Reactions') > 0 && after.indexOf('## Reactions') < after.indexOf('## Keeping quiet')], [true, true]);
skills.update('default-channels', { content: old });
addReactionsToChannelSkill();
eq('it is done once: a later edit is not overwritten', skills.get('default-channels')!.content.includes('## Reactions'), false);
console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
process.exit(fail ? 1 : 0);
