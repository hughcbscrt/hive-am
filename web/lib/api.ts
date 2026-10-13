import { translate, translateServerError } from './i18n/core';

/** `status` is the HTTP status, or 0 when the request never got an answer (network down, timeout). `aborted` is true when the caller cancelled. */
export class ApiError extends Error {
  constructor(message: string, readonly status = 0, readonly aborted = false) { super(message); this.name = 'ApiError'; }
}
export const isAbort = (e: unknown) => e instanceof ApiError && e.aborted;

/** Optional extras for any call: cancel with `signal`, or give up after `timeoutMs` (no timeout by default: some calls are long). */
export interface ReqOpts { signal?: AbortSignal; timeoutMs?: number }

async function req<T>(method: string, path: string, body?: unknown, opts?: ReqOpts): Promise<T> {
  const ctl = new AbortController(); let timedOut = false;
  const onAbort = () => ctl.abort();
  if (opts?.signal) { if (opts.signal.aborted) ctl.abort(); else opts.signal.addEventListener('abort', onAbort, { once: true }); }
  const timer = opts?.timeoutMs ? setTimeout(() => { timedOut = true; ctl.abort(); }, opts.timeoutMs) : undefined;
  try {
    let res: Response;
    try {
      res = await fetch(`/api${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      });
    } catch (e) {
      if (timedOut) throw new ApiError(translate('lib.timeout'), 0);
      if (ctl.signal.aborted) throw new ApiError('Request aborted', 0, true);
      throw new ApiError(translate('lib.unreachable'), 0);
    }
    const data = await res.json().catch(() => null);
    // The server speaks English; known messages are shown in the selected language.
    if (!res.ok) throw new ApiError(translateServerError(data?.error ?? `Request failed (${res.status})`), res.status);
    return data as T;
  } finally {
    clearTimeout(timer); opts?.signal?.removeEventListener('abort', onAbort);
  }
}

export const api = {
  get: <T,>(p: string, o?: ReqOpts) => req<T>('GET', p, undefined, o),
  post: <T,>(p: string, b?: unknown, o?: ReqOpts) => req<T>('POST', p, b ?? {}, o),
  patch: <T,>(p: string, b: unknown, o?: ReqOpts) => req<T>('PATCH', p, b, o),
  put: <T,>(p: string, b: unknown, o?: ReqOpts) => req<T>('PUT', p, b, o),
  del: <T,>(p: string, o?: ReqOpts) => req<T>('DELETE', p, undefined, o),
};
