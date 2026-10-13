import type { HttpRun } from '@/lib/types';

export const parseJson = (s: string): unknown | undefined => { try { return JSON.parse(s); } catch { return undefined; } };

export interface Result { run?: HttpRun; error?: string; at: number }
/** The environment where the values added from the runner go (created the first time). */
export const DEFAULT_ENV = 'default';
export const methodTone = (m: string) => (m === 'GET' ? 'get' : m === 'POST' ? 'post' : m === 'DELETE' ? 'del' : m === 'PUT' || m === 'PATCH' ? 'put' : 'other');
export const statusTone = (s: number) => (s >= 200 && s < 300 ? 'ok' : s >= 300 && s < 400 ? 'warn' : 'err');
export const testsFailed = (r?: Result) => !!r?.run && (r.run.tests.some((x) => !x.passed) || !!r.run.scriptError);
/** How a result looks in a list: red when it failed (an error, a 4xx/5xx, a test or a handler), green when it went well. */
export const tone = (r?: Result): 'ok' | 'warn' | 'err' | '' => (!r ? '' : !r.run ? 'err' : testsFailed(r) ? 'err' : statusTone(r.run.status));
export function prettyBody(run: HttpRun): string {
  if (/json/i.test(run.contentType) || /^\s*[[{]/.test(run.body)) { try { return JSON.stringify(JSON.parse(run.body), null, 2); } catch { /* not complete JSON */ } }
  return run.body;
}
