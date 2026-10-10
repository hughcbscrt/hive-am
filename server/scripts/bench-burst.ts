// Several OpenCode agents with hive tools answer at once: how many servers run during the burst and how many stay up after. Usage:
//   HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=6040 npx tsx scripts/bench-burst.ts [agents]
import { agents } from '../src/db.js';
import { connections } from '../src/connections/store.js';
import { sendTurn } from '../src/runtime.js';
import { mcpCaps } from '../src/instructions.js';
import { execSync } from 'node:child_process';
const N = Number(process.argv[2] ?? 4);
const live = () => Number(execSync("ps -eo args | grep -c '[o]pencode.*serve --hostname' || true").toString().trim());
const ids: string[] = [];
for (let i = 0; i < N; i++) {
  const a = agents.create({ name: `b${i}`, role: 'worker', provider: 'opencode' as any, model: 'opencode-go/deepseek-v4.1-flash', cwd: '/tmp/cm', permission: 'acceptEdits' as any });
  connections.create({ kind: 'telegram' as any, name: `c${i}`, agent_id: a.id, allowed: [], config: {} });
  ids.push(a.id); if (i === 0) console.log('caps:', mcpCaps(agents.get(a.id)!));
}
let peak = 0; const t = setInterval(() => { peak = Math.max(peak, live()); }, 400);
const t0 = Date.now();
const rs = await Promise.all(ids.map(async (id) => { const r = await sendTurn(id, 'Responde solo: ok'); console.log(`  turn ${((Date.now() - t0) / 1000).toFixed(1)}s`, r.ok ? 'ok' : r.error); return r; }));
clearInterval(t);
await new Promise((r) => setTimeout(r, 1500));
console.log(`agents ${N} | servers peak during burst: ${peak} | right after the turns: ${live()} (limit ${process.env.HIVE_AM_OPENCODE_SERVERS ?? 2})`);
process.exit(0);
