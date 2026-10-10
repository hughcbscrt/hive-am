// Recurring schedules without a model: validation, limits, de-duplication, missed runs and pausing. Usage:
//   HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4470 npx tsx scripts/test-schedules.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agents, db } from '../src/db.js';
import '../src/index.js';
import { MAX_PER_AGENT, MIN_INTERVAL_MINUTES, ScheduleError, armSchedules, cancelFor, createSchedule, listAll, listFor, runsOf, setEnabled } from '../src/schedules.js';

let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const throws = (fn: () => unknown, re: RegExp) => { try { fn(); return false; } catch (e) { return e instanceof ScheduleError && re.test(e.message); } };
const mk = (name: string) => agents.create({ name, role: 'worker', provider: 'opencode', model: '', cwd: mkdtempSync(join(tmpdir(), 'sched-')), permission: 'acceptEdits' });
const a = mk('sched-a'), b = mk('sched-b');

const r = createSchedule(a.id, { cron: '0 9 * * MON-FRI', timezone: 'America/Mexico_City', note: 'check QA logs' });
check(r.schedule.kind === 'cron' && r.schedule.next_due! > Date.now(), `a cron schedule is created (next: ${r.next[0]})`);
check(r.next.length === 3, 'it reports the next three runs');
const e = createSchedule(a.id, { every_minutes: 60, note: 'is the job up?' });
check(e.schedule.kind === 'every' && e.schedule.expr === '60', 'an "every N minutes" schedule is created');
check(createSchedule(a.id, { cron: '0 9 * * MON-FRI', timezone: 'America/Mexico_City', note: 'CHECK QA logs' }).schedule.id === r.schedule.id, 'the same request again is the same schedule');
check(listFor(a.id).length === 2 && listFor(b.id).length === 0, 'each agent sees only its own');

check(throws(() => createSchedule(a.id, { cron: '* * * * *', note: 'x' }), /minimum is 15/), 'every minute is refused');
check(throws(() => createSchedule(a.id, { cron: '*/10 * * * *', note: 'x' }), /minimum is 15/), 'every 10 minutes is refused');
check(throws(() => createSchedule(a.id, { every_minutes: 5, note: 'x' }), /between 15/), 'an interval below the minimum is refused');
check(throws(() => createSchedule(a.id, { cron: '0 9 * *', note: 'x' }), /5 fields/), 'a bad cron expression is explained');
check(throws(() => createSchedule(a.id, { cron: '0 9 * * *', timezone: 'Mars/Base', note: 'x' }), /Unknown time zone/), 'a bad time zone is refused');
check(throws(() => createSchedule(a.id, { note: 'x' }), /either "cron"/), 'neither cron nor interval is refused');
check(throws(() => createSchedule(a.id, { cron: '0 9 * * *', every_minutes: 30, note: 'x' }), /either "cron"/), 'both cron and interval is refused');
check(throws(() => createSchedule(a.id, { cron: '0 9 * * *', note: '  ' }), /note/), 'an empty note is refused');
check(throws(() => createSchedule(a.id, { cron: '0 9 * * *', note: 'x'.repeat(401) }), /too long/), 'a very long note is refused');
for (let i = listFor(a.id).length; i < MAX_PER_AGENT; i++) createSchedule(a.id, { every_minutes: 100 + i, note: `n${i}` });
check(throws(() => createSchedule(a.id, { every_minutes: 999, note: 'one too many' }), new RegExp(`${MAX_PER_AGENT} schedules`)), `at most ${MAX_PER_AGENT} per agent`);

check(throws(() => cancelFor(b.id, r.schedule.id), /no schedule with that id/), 'an agent cannot cancel another agent\'s schedule');
check(cancelFor(a.id, e.schedule.id) && listFor(a.id).every((s) => s.id !== e.schedule.id), 'an agent cancels its own');

// The server was down for hours: the run is skipped (not replayed) and the next one is set.
db.prepare('UPDATE agent_schedules SET next_due=? WHERE id=?').run(Date.now() - 3 * 3_600_000, r.schedule.id);
armSchedules();
await new Promise((res) => setTimeout(res, 400));
const after = listAll().find((s) => s.id === r.schedule.id)!;
check(after.last_status === 'skipped_missed', `a run missed during an outage is skipped (${after.last_status})`);
check(after.next_due! > Date.now(), 'and the next run is in the future');
check(runsOf(r.schedule.id).length === 1 && runsOf(r.schedule.id)[0].status === 'skipped_missed', 'the history records it');

// Pausing from the interface keeps it but stops the clock; resuming sets a fresh next run.
const paused = setEnabled(r.schedule.id, false)!;
check(!paused.enabled && paused.next_due === null, 'pausing clears the next run');
const resumed = setEnabled(r.schedule.id, true)!;
check(resumed.enabled && resumed.next_due! > Date.now(), 'resuming sets a new one');
console.log(MIN_INTERVAL_MINUTES === 15 ? '' : `(minimum interval overridden: ${MIN_INTERVAL_MINUTES})`, fail ? `${fail} FAILED` : 'ALL PASSED');
process.exit(fail ? 1 : 0);
