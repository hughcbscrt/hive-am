// Cron parsing and next-run computation, including time zones and daylight-saving changes. No model involved. Usage: npx tsx scripts/test-cron.ts
import { parseCron, nextCron, nextRuns, minGapMinutes, validTimezone, CronError } from '../src/cron.js';
let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); if (!ok) fail++; };
const iso = (t: number | null) => t === null ? null : new Date(t).toISOString();
const MX = 'America/Mexico_City';   // UTC-6, no DST since 2022
// weekdays 09:00 Mexico City = 15:00 UTC; 2026-10-09 is a Friday
eq('weekday 9:00 after Fri 14:00 UTC (08:00 local) -> same day', iso(nextCron('0 9 * * MON-FRI', MX, Date.parse('2026-10-09T14:00:00Z'))), '2026-10-09T15:00:00.000Z');
eq('after Fri 16:00 UTC -> Monday', iso(nextCron('0 9 * * MON-FRI', MX, Date.parse('2026-10-09T16:00:00Z'))), '2026-10-12T15:00:00.000Z');
eq('every 15 min', nextRuns('*/15 * * * *', 'UTC', Date.parse('2026-10-09T10:07:00Z'), 3).map(iso), ['2026-10-09T10:15:00.000Z', '2026-10-09T10:30:00.000Z', '2026-10-09T10:45:00.000Z']);
eq('strictly after (exact minute)', iso(nextCron('30 10 * * *', 'UTC', Date.parse('2026-10-09T10:30:00Z'))), '2026-10-10T10:30:00.000Z');
eq('month names + list', iso(nextCron('0 8 1 JAN,JUL *', 'UTC', Date.parse('2026-10-09T00:00:00Z'))), '2027-01-01T08:00:00.000Z');
eq('Feb 29 (leap year)', iso(nextCron('0 0 29 2 *', 'UTC', Date.parse('2026-10-09T00:00:00Z'))), '2028-02-29T00:00:00.000Z');
eq('dom and dow both set: either', nextRuns('0 12 13 * FRI', 'UTC', Date.parse('2026-10-09T13:00:00Z'), 2).map(iso), ['2026-10-13T12:00:00.000Z', '2026-10-16T12:00:00.000Z']);
eq('@daily', iso(nextCron('@daily', 'UTC', Date.parse('2026-10-09T10:00:00Z'))), '2026-10-10T00:00:00.000Z');
// DST (New York): 2026-03-08 02:30 does not exist; 2026-11-01 01:30 happens twice
const NY = 'America/New_York';
eq('DST gap: 02:30 on 2026-03-08 is skipped to the next day', iso(nextCron('30 2 * * *', NY, Date.parse('2026-03-08T00:00:00Z'))), '2026-03-09T06:30:00.000Z');
eq('DST gap: other days still 02:30 EST (07:30Z)', iso(nextCron('30 2 * * *', NY, Date.parse('2026-03-07T00:00:00Z'))), '2026-03-07T07:30:00.000Z');
eq('DST overlap: 01:30 on 2026-11-01 runs once (first, EDT = 05:30Z)', nextRuns('30 1 * * *', NY, Date.parse('2026-11-01T00:00:00Z'), 2).map(iso), ['2026-11-01T05:30:00.000Z', '2026-11-02T06:30:00.000Z']);
eq('after DST ends, 09:00 NY = 14:00Z (07:00 local at 12:00Z, so the same day)', iso(nextCron('0 9 * * *', NY, Date.parse('2026-11-01T12:00:00Z'))), '2026-11-01T14:00:00.000Z');
eq('Asia/Kolkata (UTC+5:30) 09:00 = 03:30Z', iso(nextCron('0 9 * * *', 'Asia/Kolkata', Date.parse('2026-10-09T00:00:00Z'))), '2026-10-09T03:30:00.000Z');
eq('min gap of "* * * * *" is 1', minGapMinutes('* * * * *', 'UTC', Date.now()), 1);
eq('min gap of "0 */6 * * *" is 360', minGapMinutes('0 */6 * * *', 'UTC', Date.now()), 360);
eq('timezone validity', [validTimezone('America/Mexico_City'), validTimezone('Mars/Base')], [true, false]);
for (const bad of ['', '* * * *', '61 * * * *', '* 25 * * *', '*/0 * * * *', '5-1 * * * *', 'a b c d e']) {
  let threw = false; try { parseCron(bad); } catch (e) { threw = e instanceof CronError; }
  eq(`rejects "${bad}"`, threw, true);
}
console.log(fail ? `${fail} FAILED` : 'ALL PASSED'); process.exit(fail ? 1 : 0);
