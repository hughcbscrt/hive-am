import { DomainError, STATUS_OF_KIND } from '../errors.js';

/** An error with the status the client should see. Its message is shown to the person, so it is in plain English. */
export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
export const bad = (m: string) => new HttpError(400, m);
export const forbidden = (m: string) => new HttpError(403, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const tooLarge = (m: string) => new HttpError(413, m);

/** The one place where an error becomes a status and a message. `null` means "not ours": the caller logs it and answers 500. */
export function toHttpError(e: unknown): HttpError | null {
  if (e instanceof HttpError) return e;
  if (e instanceof DomainError) return new HttpError(STATUS_OF_KIND[e.kind] ?? 400, e.message);
  return null;
}
