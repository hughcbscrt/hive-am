import { agents } from '../db.js';
import { listWakeups } from '../wake.js';
import { pendingWatches } from '../watch.js';
import { listAll } from '../schedules.js';

/** Everything that will wake an agent, in one list for the interface: recurring schedules, one-off wake-ups and watched processes. */
export function allSchedules() {
  const name = (id: string) => agents.get(id)?.name ?? '?';
  const once = listWakeups().map((w) => ({
    id: w.id, agent_id: w.agent_id, connection_id: w.connection_id, thread_id: w.thread_id, kind: 'once', expr: '', tz: '', note: w.note, enabled: true, next_due: w.due_at, created_at: w.created_at,
    last_fired_at: null, fire_count: 0, last_status: null, last_detail: null, agent_name: name(w.agent_id), place: '', description: 'once',
  }));
  const watching = pendingWatches().map((w) => ({
    id: w.id, agent_id: w.agent_id, connection_id: w.connection_id, thread_id: w.thread_id, kind: 'watch', expr: String(w.pid), tz: '', note: w.note, enabled: true, next_due: w.deadline, created_at: w.started_at,
    last_fired_at: null, fire_count: 0, last_status: null, last_detail: null, agent_name: name(w.agent_id), place: '',
    description: `process ${w.pid}${w.file ? ` · file ${w.file}` : ''}${w.log ? ` · log ${w.log}` : ''}`,
  }));
  return [...listAll(), ...once, ...watching];
}
