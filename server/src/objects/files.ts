import { createHash } from 'node:crypto';
import { closeSync, existsSync, fchmodSync, fsyncSync, linkSync, lstatSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { DOCKERFILE_NAME } from './docker.js';
import { ObjectError } from './model.js';

/**
 * The two files of the person that hive-am writes, and only when asked to: the compose file of a compose resource and a Dockerfile picked to
 * build. Both are edited in place or copied next to the original. The compose path is the one saved in the resource; a Dockerfile path comes
 * from the page, so its name is the limit: hive-am is not a writer of any file. A save is atomic (a temporary file in the same folder, then
 * `rename`) and carries the `etag` read with the file, so an edit made outside hive-am is never overwritten without knowing.
 */
export type SourceKind = 'compose' | 'dockerfile';
export const SOURCE_MAX = 512 * 1024;
const NAME: Record<SourceKind, RegExp> = { compose: /^\w[\w.-]{0,95}\.ya?ml$/i, dockerfile: DOCKERFILE_NAME };
const WHAT: Record<SourceKind, string> = { compose: 'a compose file (.yml or .yaml)', dockerfile: 'a Dockerfile (Dockerfile, Containerfile, Dockerfile.<name> or <name>.Dockerfile)' };
const TMP = '.hive-tmp-';

export const etagOf = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');

/** The real path of an existing regular file of that kind, no bigger than 512 KB: its name and the name of what a link leads to are checked. */
export function assertSourcePath(kind: SourceKind, raw: unknown): string {
  const file = typeof raw === 'string' ? raw.trim() : '';
  if (!file || !isAbsolute(file)) throw new ObjectError('The file must be an absolute path');
  if (!NAME[kind].test(basename(file))) throw new ObjectError(`${basename(file)} is not ${WHAT[kind]}`);
  if (!existsSync(file)) throw new ObjectError(`The file ${file} does not exist`);
  const st = statSync(file);
  if (!st.isFile()) throw new ObjectError(`${file} is not a file`);
  const real = realpathSync(file);
  if (!NAME[kind].test(basename(real))) throw new ObjectError(`${file} leads to ${basename(real)}, which is not ${WHAT[kind]}`);
  if (st.size > SOURCE_MAX) throw new ObjectError(`${file} is bigger than 512 KB`);
  return real;
}

/** Text that can be saved: a string of UTF-8 with no NUL, up to 512 KB. */
function checkContent(content: unknown): string {
  if (typeof content !== 'string') throw new ObjectError('The content of the file is missing');
  if (content.includes('\0')) throw new ObjectError('The file cannot contain NUL characters');
  if (Buffer.byteLength(content, 'utf8') > SOURCE_MAX) throw new ObjectError('The file cannot be bigger than 512 KB');
  return content;
}

/** The text of the file and the etag of its bytes (a byte order mark is kept, so saving what was read writes the same bytes). */
function readText(real: string): { text: string; etag: string } {
  const buf = readFileSync(real);
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf); } catch { throw new ObjectError(`${real} is not a text file (UTF-8)`); }
  if (text.includes('\0')) throw new ObjectError(`${real} is not a text file`);
  return { text, etag: etagOf(buf) };
}

export interface SourceFile { path: string; content: string; etag: string; bytes: number }
export function readSource(kind: SourceKind, path: unknown): SourceFile {
  const real = assertSourcePath(kind, path);
  const { text, etag } = readText(real);
  return { path: String(path).trim(), content: text, etag, bytes: Buffer.byteLength(text, 'utf8') };
}

/**
 * Writes `content` (as given: its line endings are not touched) into a temporary file next to `target` (with exactly `mode`), flushes it and then either renames it over `target` or, with
 * `noClobber`, links it there (which fails if `target` exists, so nothing is overwritten). On any failure the temporary file is removed and
 * `target` is as it was. Temporary files left by a hive-am that died while saving the same file are removed first (only that exact prefix).
 */
function atomicWrite(target: string, content: string, mode: number, noClobber = false): void {
  const dir = dirname(target), prefix = `.${basename(target)}${TMP}`;
  try { for (const f of readdirSync(dir)) if (f.startsWith(prefix)) rmSync(join(dir, f), { force: true }); } catch { /* an unreadable folder fails below */ }
  const tmp = join(dir, `${prefix}${process.pid}`);
  let fd: number | null = null;
  try {
    fd = openSync(tmp, 'w', mode);
    fchmodSync(fd, mode);                                                     // `open` applies the umask: 664 would become 644
    writeSync(fd, content);
    fsyncSync(fd);
    closeSync(fd); fd = null;
    if (noClobber) { linkSync(tmp, target); rmSync(tmp, { force: true }); } else renameSync(tmp, target);
  } catch (e) {
    if (fd !== null) try { closeSync(fd); } catch { /* already closed */ }
    rmSync(tmp, { force: true });
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') throw new ObjectError(`${target} already exists`, 'conflict', 'exists');
    throw new ObjectError(`Could not save ${target}: ${code === 'EACCES' || code === 'EPERM' ? 'the folder cannot be written' : (e as Error).message}`);
  }
}

/** Saves over the file, only if it is still what was read (`etag`); otherwise a conflict (409) and the file is not touched. */
export function writeSource(kind: SourceKind, path: unknown, content: unknown, etag: unknown): { path: string; etag: string; bytes: number } {
  const real = assertSourcePath(kind, path);
  const text = checkContent(content);
  if (typeof etag !== 'string' || !etag) throw new ObjectError('Open the file before saving it');
  if (etagOf(readFileSync(real)) !== etag) throw new ObjectError(`${String(path).trim()} changed on disk since it was opened`, 'conflict', 'stale');
  atomicWrite(real, text, statSync(real).mode & 0o777);
  return { path: String(path).trim(), etag: etagOf(text), bytes: Buffer.byteLength(text, 'utf8') };
}

/** A name for the copy: only a file name, valid for the kind (a compose file stays .yml / .yaml, a Dockerfile stays named like one), not the original's. */
export function assertCopyName(kind: SourceKind, original: string, raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) throw new ObjectError('Give the copy a name');
  if (name.length > 100) throw new ObjectError('The name of the copy can have up to 100 characters');
  if (/[/\\]/.test(name) || name.includes('..')) throw new ObjectError('The copy is saved next to the original: give only a file name, without / or ..');
  if (/^[-.]/.test(name)) throw new ObjectError('The name of the copy cannot start with - or .');
  if (!/^\w[\w.-]*$/.test(name) || !NAME[kind].test(name)) throw new ObjectError(`${name} is not ${WHAT[kind]}`);
  if (name === basename(original)) throw new ObjectError('The copy needs a name different from the original');
  return name;
}

/**
 * Writes a copy next to the original (in its real folder, so the relative paths of a compose file and the build folder of a Dockerfile still
 * hold), with the text given or, without it, the original's. One that exists is only replaced with `overwrite`; otherwise a conflict (409).
 */
export function copySource(kind: SourceKind, path: unknown, rawName: unknown, content: unknown, overwrite: boolean): { path: string; etag: string; bytes: number } {
  const real = assertSourcePath(kind, path);
  const name = assertCopyName(kind, real, rawName);
  if (name === basename(String(path).trim())) throw new ObjectError('The copy needs a name different from the original');
  const text = content === undefined || content === null ? readText(real).text : checkContent(content);
  const target = join(dirname(real), name);
  const there = (() => { try { return lstatSync(target); } catch { return null; } })();
  if (there && !overwrite) throw new ObjectError(`${target} already exists`, 'conflict', 'exists');
  if (there && (!there.isFile() || there.isSymbolicLink())) throw new ObjectError(`${target} is not a regular file, so it is not replaced`);
  atomicWrite(target, text, statSync(real).mode & 0o777, !there);
  return { path: target, etag: etagOf(text), bytes: Buffer.byteLength(text, 'utf8') };
}
