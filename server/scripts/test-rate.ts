// The sliding-window limit on wake-ups (no model). Usage: npx tsx scripts/test-rate.ts
import { allow, forgetRate } from '../src/connections/rate.js';
let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); if (!ok) fail++; };
const t0 = 1_000_000;
const burst = (key: string, n: number, limit: number, at: number) => Array.from({ length: n }, (_, i) => allow(key, limit, 60_000, at + i));
eq('the first 10 in a minute pass, the rest do not', burst('a', 14, 10, t0), [...Array(10).fill(true), ...Array(4).fill(false)]);
eq('still blocked 59 s after the first', allow('a', 10, 60_000, t0 + 59_000), false);
eq('as the window slides, room opens up again', allow('a', 10, 60_000, t0 + 61_000), true);
eq('each key has its own count', allow('b', 10, 60_000, t0 + 5), true);
eq('0 turns the limit off', burst('c', 50, 0, t0).every(Boolean), true);
eq('a limit of 3 lets 3 through', burst('d', 5, 3, t0), [true, true, true, false, false]);
forgetRate('d');
eq('forgetting a key starts it over', allow('d', 3, 60_000, t0 + 10), true);
console.log(fail ? `${fail} FAILED` : 'ALL PASSED'); process.exit(fail ? 1 : 0);
