// An OpenCode conversation keeps the tools it started with: the agent is flagged when its permission changed after the conversation began.
//   HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-session-permission.ts
import './_guard.js';
const { agents, colonies, db } = await import('../src/db.js');
const { permissionStale, resumeSession, updateAgent } = await import('../src/services/agents.js');
const { updateColony } = await import('../src/services/colonies.js');

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const mk = (name: string, provider: 'opencode' | 'claude' | 'kiro', extra: Record<string, unknown> = {}) =>
  agents.create({ name, role: 'worker', provider, model: '', cwd: '/tmp', permission: 'acceptEdits', ...extra } as any);
const cur = (id: string) => agents.get(id)!;

const a = mk('oc', 'opencode');
agents.setSession(cur(a.id), 'ses_1');
check(!permissionStale(cur(a.id)), 'a new conversation is not stale');
updateAgent(a.id, { permission: 'bypassPermissions' } as any);
check(permissionStale(cur(a.id)), 'changing the permission flags the conversation');
agents.setSession(cur(a.id), 'ses_1');
check(permissionStale(cur(a.id)), 'a second turn on the same conversation keeps the flag (the stored permission is not overwritten)');
agents.setSession(cur(a.id), null);
check(!permissionStale(cur(a.id)), 'no conversation, nothing to flag');
agents.setSession(cur(a.id), 'ses_2');
check(!permissionStale(cur(a.id)), 'a conversation started under the new permission is not stale');
resumeSession(cur(a.id), 'ses_1');
check(permissionStale(cur(a.id)), 'making the old conversation current brings the flag back');

const c = mk('cl', 'claude');
agents.setSession(cur(c.id), 'cl_1');
updateAgent(c.id, { permission: 'bypassPermissions' } as any);
check(!permissionStale(cur(c.id)), 'a Claude agent is never flagged');
const k = mk('ki', 'kiro');
agents.setSession(cur(k.id), 'ki_1');
updateAgent(k.id, { permission: 'bypassPermissions' } as any);
check(!permissionStale(cur(k.id)), 'a Kiro agent is never flagged');

const legacy = mk('old', 'opencode');
agents.setSession(cur(legacy.id), 'old_1');
db.prepare('UPDATE agent_sessions SET permission=NULL WHERE session_id=?').run('old_1');
updateAgent(legacy.id, { permission: 'bypassPermissions' } as any);
check(!permissionStale(cur(legacy.id)), 'a session recorded before the column existed is not flagged (unknown)');

const col = colonies.create({ name: 'inh', permission: 'acceptEdits' } as any);
const m = mk('member', 'opencode', { colony_id: col.id });
check(cur(m.id).effective.permission === 'acceptEdits', 'the member inherits the colony permission');
agents.setSession(cur(m.id), 'm_1');
updateColony(col.id, { permission: 'bypassPermissions' } as any);
check(permissionStale(cur(m.id)), 'changing the colony permission flags an agent that inherits it');

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
