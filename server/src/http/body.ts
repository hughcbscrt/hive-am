import type { IncomingMessage } from 'node:http';
import { UPLOAD_MAX_BYTES, UPLOAD_MAX_FILES } from '../connections/files.js';
import { bad, tooLarge } from './errors.js';

/** A JSON body: always an object (anything else is a 400 instead of a crash further down). Fields are `unknown`: validate them with ./validate.ts. */
export type Body = Record<string, unknown>;

/** Notes, skills, SQL, http files and settings are text: 2 MiB is far above what any of them needs. */
export const JSON_LIMIT = 2 * 1024 * 1024;
/** Files sent from the chat travel as base64 inside the JSON (4/3 of the bytes), up to UPLOAD_MAX_FILES of UPLOAD_MAX_BYTES each. */
export const UPLOAD_LIMIT = Math.ceil(UPLOAD_MAX_FILES * UPLOAD_MAX_BYTES * 4 / 3) + JSON_LIMIT;

const mb = (n: number) => `${Math.round(n / 1048576)} MB`;

/** Raw bytes of the request, refusing (413) anything over `max`. Once over the limit the rest is read and dropped, so the answer can still be delivered. */
export function readRaw(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    const chunks: Buffer[] = []; let size = 0, over = false;
    const refuse = () => { if (over) return; over = true; chunks.length = 0; reject(tooLarge(`The request is too big (limit ${mb(max)})`)); };
    if (Number.isFinite(declared) && declared > max) { refuse(); req.resume(); return; }
    req.on('data', (c: Buffer) => { if (over) return; size += c.length; if (size > max) return refuse(); chunks.push(c); });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)); });
    req.on('error', (e) => { if (!over) { over = true; reject(e); } });
  });
}

export async function body(req: IncomingMessage, max = JSON_LIMIT): Promise<Body> {
  const raw = await readRaw(req, max);
  if (!raw.length) return {};
  let v: unknown;
  try { v = JSON.parse(raw.toString('utf8')); } catch { throw bad('Request body is not valid JSON'); }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw bad('Request body must be a JSON object');
  return v as Body;
}
