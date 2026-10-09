/**
 * Cron expressions (5 fields: minute hour day-of-month month day-of-week) evaluated in a time zone.
 * The next run is computed from calendar days and local times and then mapped to an instant, so daylight-saving changes behave:
 * a local time that does not exist (the hour skipped in spring) is skipped, and one that happens twice (autumn) runs once, the first time.
 */
export class CronError extends Error {}

export interface CronSpec { minute: number[]; hour: number[]; dom: number[]; month: number[]; dow: number[]; domAny: boolean; dowAny: boolean }

const NAMES: Record<string, Record<string, number>> = {
  month: { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 },
  dow: { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 },
};
const MACROS: Record<string, string> = { '@hourly': '0 * * * *', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@weekly': '0 0 * * 0', '@monthly': '0 0 1 * *' };

function field(src: string, min: number, max: number, names?: Record<string, number>): { values: number[]; any: boolean } {
  const num = (s: string): number => {
    const v = names?.[s.toUpperCase()] ?? (/^\d+$/.test(s) ? Number(s) : NaN);
    if (!Number.isInteger(v) || v < min || v > max) throw new CronError(`"${s}" is out of range (${min}-${max})`);
    return v;
  };
  const out = new Set<number>();
  let any = false;
  for (const part of src.split(',')) {
    const [range, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new CronError(`Invalid step "${stepText}"`);
    let from: number, to: number;
    if (range === '*' || range === '?') { from = min; to = max; if (stepText === undefined) any = true; }
    else if (range.includes('-')) { const [a, b] = range.split('-'); from = num(a); to = num(b); if (from > to) throw new CronError(`Range ${range} goes backwards`); }
    else { from = num(range); to = stepText === undefined ? from : max; }
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return { values: [...out].sort((a, b) => a - b), any };
}

export function parseCron(expression: string): CronSpec {
  const text = MACROS[expression.trim().toLowerCase()] ?? expression.trim();
  const parts = text.split(/\s+/);
  if (parts.length !== 5) throw new CronError('A cron expression has 5 fields: minute hour day-of-month month day-of-week (for example "0 9 * * MON-FRI")');
  const minute = field(parts[0], 0, 59), hour = field(parts[1], 0, 23), dom = field(parts[2], 1, 31), month = field(parts[3], 1, 12, NAMES.month);
  const dowRaw = field(parts[4].replace(/\b7\b/g, '0'), 0, 6, NAMES.dow);
  return { minute: minute.values, hour: hour.values, dom: dom.values, month: month.values, dow: dowRaw.values, domAny: dom.any, dowAny: dowRaw.any };
}

// ---- time zones ----
const formats = new Map<string, Intl.DateTimeFormat>();
function format(tz: string): Intl.DateTimeFormat {
  let f = formats.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }); formats.set(tz, f); }
  return f;
}
export function validTimezone(tz: string): boolean { try { format(tz); return true; } catch { return false; } }
export const serverTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

interface Local { y: number; m: number; d: number; h: number; mi: number; s: number }
function local(ts: number, tz: string): Local {
  const p: Record<string, number> = {};
  for (const x of format(tz).formatToParts(new Date(ts))) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
}
const offsetMs = (ts: number, tz: string) => { const l = local(ts, tz); return Date.UTC(l.y, l.m - 1, l.d, l.h, l.mi, l.s) - Math.floor(ts / 1000) * 1000; };

/** The instant at which the wall clock of `tz` reads y-m-d h:mi, or null when that time does not exist there (spring-forward gap). */
function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): number | null {
  const wall = Date.UTC(y, m - 1, d, h, mi);
  let utc = wall - offsetMs(wall, tz);
  utc = wall - offsetMs(utc, tz);              // second pass: the offset may differ at the new instant
  const l = local(utc, tz);
  return l.y === y && l.m === m && l.d === d && l.h === h && l.mi === mi ? utc : null;
}

/** First run strictly after `after` (ms), or null if there is none in the next 8 years. */
export function nextCron(expression: string | CronSpec, tz: string, after: number): number | null {
  const spec = typeof expression === 'string' ? parseCron(expression) : expression;
  const start = local(after, tz);
  for (let k = 0; k < 366 * 8; k++) {
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + k));
    const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate(), wd = day.getUTCDay();
    if (!spec.month.includes(m)) continue;
    const domOk = spec.dom.includes(d), dowOk = spec.dow.includes(wd);
    const dayOk = spec.domAny || spec.dowAny ? domOk && dowOk : domOk || dowOk;   // both restricted: either matches (classic cron)
    if (!dayOk) continue;
    for (const h of spec.hour) for (const mi of spec.minute) {
      const t = zonedToUtc(y, m, d, h, mi, tz);
      if (t !== null && t > after) return t;
    }
  }
  return null;
}

/** The next `count` runs. */
export function nextRuns(expression: string, tz: string, after: number, count: number): number[] {
  const spec = parseCron(expression), out: number[] = [];
  let t = after;
  while (out.length < count) { const n = nextCron(spec, tz, t); if (n === null) break; out.push(n); t = n; }
  return out;
}

/** Smallest gap, in minutes, between the next runs: protects against "* * * * *" and the like. */
export function minGapMinutes(expression: string, tz: string, after: number): number {
  const runs = nextRuns(expression, tz, after, 12);
  if (runs.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 1; i < runs.length; i++) min = Math.min(min, (runs[i] - runs[i - 1]) / 60000);
  return min;
}
