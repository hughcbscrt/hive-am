// Time to first reply through a channel, per provider. Usage:
//   HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4440 npx tsx scripts/bench-latency.ts <claude|opencode|kiro> [model] [rounds] [effort]
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agents } from '../src/db.js';
import '../src/index.js';
import { FakeAdapter } from '../src/connections/fake.js';
import { registerFactory, startConnection } from '../src/connections/manager.js';
import { connections } from '../src/connections/store.js';

const [provider = 'claude', model = '', rounds = '3', effort = ''] = process.argv.slice(2);
const adapter = new FakeAdapter();
registerFactory('fake', () => adapter);
const agent = agents.create({ name: `bench-${provider}`, role: 'worker', provider: provider as any, model, cwd: mkdtempSync(join(tmpdir(), 'bench-')), permission: 'acceptEdits' });
const conn = connections.create({ kind: 'fake', name: 'bench', agent_id: agent.id, allowed: [{ id: 'maria', admin: true }], config: { lang: 'en', ...(effort ? { effort } : {}) } });
await startConnection(conn.id);

const times: string[] = [];
for (let i = 0; i < Number(rounds); i++) {
  adapter.sent.length = 0;
  const t0 = Date.now();
  let first = 0;
  const poll = setInterval(() => { if (!first && adapter.sent.length) first = Date.now() - t0; }, 50);
  await adapter.say('chat:T', 'What day of the week is it today? Answer with channel_reply, one short sentence.', 'maria');
  clearInterval(poll);
  times.push(`#${i + 1}: «${adapter.sent[0]?.text.replace(/\s+/g, " ").slice(0, 50)}» first reply ${(first / 1000).toFixed(1)}s, turn ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
console.log(`RESULT ${provider} ${model} effort=${effort || 'default'}\n` + times.join('\n'));
process.exit(0);
