import { cancelFor, createSchedule, listFor, removeSchedule, runsOf, setEnabled } from '../../schedules.js';
import { removeWakeup } from '../../wake.js';
import { WatchError, cancelWatchFor, removeWatch } from '../../watch.js';
import { allSchedules } from '../../services/schedules.js';
import { body } from '../body.js';
import { notFound } from '../errors.js';
import { route } from '../router.js';
import { text } from '../validate.js';

// Recurring schedules and pending wake-ups: the agent's tools (`from` is its id) and the interface. ScheduleError becomes a 400 in http/errors.ts.
route('POST', '/api/schedules/create', async ({ req }) => {
  const b = await body(req);
  const r = createSchedule(text(b.from), b);
  return { id: r.schedule.id, schedule: r.schedule.kind === 'every' ? `every ${r.schedule.expr} min` : `${r.schedule.expr} (${r.schedule.tz})`, next: r.next, where: r.where };
});
route('POST', '/api/schedules/list', async ({ req }) => { const b = await body(req); return { schedules: listFor(text(b.from)) }; });
route('POST', '/api/schedules/cancel', async ({ req }) => {
  const b = await body(req); const from = text(b.from), id = text(b.id);
  try { cancelWatchFor(from, id); return { cancelled: true }; } catch (e) { if (!(e instanceof WatchError)) throw e; }   // not one of its watches: a schedule then
  cancelFor(from, id); return { cancelled: true };
});
route('GET', '/api/schedules', () => allSchedules());
route('GET', '/api/schedules/:id/runs', ({ params }) => runsOf(params[0]));
route('PATCH', '/api/schedules/:id', async ({ req, params }) => {
  const b = await body(req);
  return setEnabled(params[0], !!b.enabled) ?? (() => { throw notFound('Schedule not found'); })();
});
route('DELETE', '/api/schedules/:id', ({ params }) => {
  if (!removeSchedule(params[0]) && !removeWakeup(params[0]) && !removeWatch(params[0])) throw notFound('Schedule not found');
  return { ok: true };
});
