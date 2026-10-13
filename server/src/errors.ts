/**
 * What the domain modules throw on purpose: a refused action or a bad input, with a message written for the person (the interface
 * translates the ones it knows). `kind` says what went wrong in terms the HTTP layer can map to a status (invalid 400, forbidden 403,
 * not_found 404, conflict 409, unavailable 503); `code` is an optional stable identifier for callers that must branch on it.
 * Every module keeps its own subclass (ObjectError, WakeError...) so `instanceof` and the messages stay as they were.
 */
export type ErrorKind = 'invalid' | 'forbidden' | 'not_found' | 'conflict' | 'unavailable';

export class DomainError extends Error {
  constructor(message?: string, public readonly kind: ErrorKind = 'invalid', public readonly code?: string) { super(message); }
}

/** The HTTP status a kind maps to. */
export const STATUS_OF_KIND: Record<ErrorKind, number> = { invalid: 400, forbidden: 403, not_found: 404, conflict: 409, unavailable: 503 };
