// What hive-am keeps of its own record stops growing: old thread messages, delegations and known conversations are aged out, and nothing recent is.
//   HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-retention.ts
import './_guard.js';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// The Claude reader looks for transcripts under ~/.claude: point it at a folder of our own before anything loads.
process.env.HOME = mkdtempSync(join(tmpdir(), 'ret-home-'));
const { agents, db } = await import('../src/db.js');
const { connections, threads } = await import('../src/connections/store.js');
const { retentionPass, KEEP_THREAD_MESSAGES, KEEP_DISPATCHES, KEEP_DELEGATIONS, MESSAGE_DAYS, SESSION_FORGET_DAYS } = await import('../src/retention.js');
const { RETENTION_DAYS } = await import('../src/connections/files.js');

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const DAY = 86_400_000;
const now = Date.now();
const ago = (days: number) => now - days * DAY;
const count = (sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { n: number }).n;

const agent = agents.create({ name: 'ret', role: 'worker', provider: 'claude', model: '', cwd: '/tmp/ret-proj', permission: 'acceptEdits' });
const other = agents.create({ name: 'ret-other', role: 'worker', provider: 'claude', model: '', cwd: '/tmp/ret-proj', permission: 'acceptEdits' });
const conn = connections.create({ kind: 'telegram', name: 'ret-bot', agent_id: agent.id, config: {}, allowed: [] });
const thread = (key: string) => threads.touch(conn.id, key, { title: key, target: { chat: key } as never, user: 'u' }).id;
const addMsg = db.prepare('INSERT INTO thread_messages (thread_id, direction, external_id, text, ts, files) VALUES (?,?,?,?,?,?)');

// ---- thread messages: the newest 500, and anything inside the window ----
const big = thread('big');
db.transaction(() => {
  for (let i = 0; i < 600; i++) addMsg.run(big, 'in', `m${i}`, `message ${i}`, ago(60) + i, null);            // 600 messages, all older than the window
})();
const ids = (t: string) => (db.prepare('SELECT external_id AS e FROM thread_messages WHERE thread_id=? ORDER BY id').all(t) as { e: string }[]).map((r) => r.e);
let r = retentionPass({ now });
check(r.messages === 100 && count('SELECT COUNT(*) n FROM thread_messages WHERE thread_id=?', big) === KEEP_THREAD_MESSAGES, 'a thread of 600 old messages keeps its newest 500');
check(ids(big)[0] === 'm100' && ids(big).at(-1) === 'm599', 'and it is the oldest 100 that went');

const recent = thread('recent');                                                                             // 600 messages, but all inside the window
db.transaction(() => { for (let i = 0; i < 600; i++) addMsg.run(recent, 'in', `r${i}`, `message ${i}`, ago(MESSAGE_DAYS - 1) + i, null); })();
r = retentionPass({ now });
check(count('SELECT COUNT(*) n FROM thread_messages WHERE thread_id=?', recent) === 600, 'messages beyond the cap but inside the window stay');

const few = thread('few');                                                                                   // 5 messages, all old: among the newest 500
db.transaction(() => { for (let i = 0; i < 5; i++) addMsg.run(few, 'in', `f${i}`, 'old but few', ago(400) + i, null); })();
r = retentionPass({ now });
check(count('SELECT COUNT(*) n FROM thread_messages WHERE thread_id=?', few) === 5, 'old messages among the newest 500 of a thread stay');

// ---- the record of a file goes with the file ----
const withFiles = thread('files');
addMsg.run(withFiles, 'in', 'old', 'old file', ago(RETENTION_DAYS + 6), JSON.stringify([{ path: '/gone', name: 'a', kind: 'document', size: 1 }]));
addMsg.run(withFiles, 'in', 'new', 'new file', ago(1), JSON.stringify([{ path: '/here', name: 'b', kind: 'document', size: 1 }]));
r = retentionPass({ now });
const files = (e: string) => (db.prepare("SELECT files FROM thread_messages WHERE thread_id=? AND external_id=?").get(withFiles, e) as { files: string | null }).files;
check(r.files >= 1 && files('old') === null && files('new') !== null, 'the files of a message past the inbox retention are emptied and a fresh one keeps them');

// ---- dispatches: the newest 200 ----
const addDisp = db.prepare("INSERT INTO dispatches (id, from_id, to_id, task, status, created_at) VALUES (?,?,?,?,?,?)");
db.transaction(() => { for (let i = 0; i < 300; i++) addDisp.run(`d${String(i).padStart(3, '0')}`, agent.id, other.id, `task ${i}`, 'done', ago(1) + i); })();
addDisp.run('running-old', agent.id, other.id, 'still going', 'running', ago(500));
r = retentionPass({ now });
check(count('SELECT COUNT(*) n FROM dispatches WHERE id LIKE ?', 'd%') === KEEP_DISPATCHES, 'of 300 dispatches the newest 200 stay');
check(count("SELECT COUNT(*) n FROM dispatches WHERE id='d299'") === 1 && count("SELECT COUNT(*) n FROM dispatches WHERE id='d000'") === 0, 'and the oldest ones are the ones that went');
check(count("SELECT COUNT(*) n FROM dispatches WHERE id='running-old'") === 1, 'a dispatch that is still running is never removed');

// ---- delegated conversations: past the newest 50 AND older than the window ----
const addSess = db.prepare("INSERT INTO agent_sessions (agent_id, provider, session_id, cwd, first_seen, last_seen, kind) VALUES (?,?,?,?,?,?,?)");
db.transaction(() => {
  for (let i = 0; i < 80; i++) addSess.run(agent.id, 'claude', `del-old-${i}`, '/tmp/ret-proj', ago(200) + i, ago(200) + i, 'delegation');   // 80 old ones
  for (let i = 0; i < 70; i++) addSess.run(other.id, 'claude', `del-new-${i}`, '/tmp/ret-proj', ago(1) + i, ago(1) + i, 'delegation');   // 70 recent ones
})();
r = retentionPass({ now });
check(count("SELECT COUNT(*) n FROM agent_sessions WHERE agent_id=? AND kind='delegation'", agent.id) === KEEP_DELEGATIONS, 'of 80 old delegated conversations the newest 50 stay');
check(count("SELECT COUNT(*) n FROM agent_sessions WHERE agent_id=? AND session_id='del-old-79'", agent.id) === 1 && count("SELECT COUNT(*) n FROM agent_sessions WHERE agent_id=? AND session_id='del-old-0'", agent.id) === 0, 'the oldest ones are the ones that went');
check(count("SELECT COUNT(*) n FROM agent_sessions WHERE agent_id=? AND kind='delegation'", other.id) === 70, 'delegated conversations beyond the cap but recent stay');

// ---- direct conversations: old AND the CLI no longer has them ----
const direct = (sid: string, daysAgo: number, who = agent.id) => addSess.run(who, 'claude', sid, '/tmp/ret-proj', ago(daysAgo), ago(daysAgo), 'direct');
direct('old-gone', SESSION_FORGET_DAYS + 30);          // old, no transcript
direct('recent-gone', 5);                              // recent, no transcript (a failed read must not lose it)
direct('old-kept', SESSION_FORGET_DAYS + 30);          // old, but the CLI still has it
direct('old-current', SESSION_FORGET_DAYS + 30);       // old, no transcript, but it is the agent's current conversation
const projDir = join(process.env.HOME!, '.claude', 'projects', '-tmp-ret-proj');
mkdirSync(projDir, { recursive: true });
writeFileSync(join(projDir, 'old-kept.jsonl'), JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'hello' } }) + '\n');
db.prepare('UPDATE agents SET session_id=? WHERE id=?').run('old-current', agent.id);
r = retentionPass({ now });
const has = (sid: string) => count('SELECT COUNT(*) n FROM agent_sessions WHERE session_id=?', sid) === 1;
check(!has('old-gone'), 'an old conversation the CLI no longer has is forgotten');
check(has('recent-gone'), 'a recent one with no transcript stays');
check(has('old-kept'), 'an old one the CLI still has stays');
check(has('old-current'), 'the agent\'s current conversation is never forgotten');

// ---- a second pass finds nothing more, and an empty database is fine ----
r = retentionPass({ now });
check(r.messages + r.dispatches + r.sessions === 0, 'a second pass removes nothing more');
check(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_dispatches_created'").get() !== undefined, 'the index that the dispatch cleanup orders by exists');

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
