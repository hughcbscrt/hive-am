import { realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, isAbsolute, join, sep } from 'node:path';
import { DATA_DIR, resolved } from '../db.js';
import type { Agent } from '../types.js';
import { inboxDir } from './files.js';
import type { FileKind } from './types.js';

/**
 * Files an agent sends back to a chat. The agent names a path; hive-am checks it before anything leaves this machine, so
 * a message in a group cannot make the agent mail out secrets: only the agent's own working folder, the files people
 * sent it and the system temp folder are allowed, and credentials, keys, databases and git internals never are.
 */
export const MAX_SEND_BYTES = 50 * 1024 * 1024; // the most Telegram accepts from a bot

const SENSITIVE_NAME = /^(\.env(\..*)?|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|\.npmrc|\.netrc|\.pgpass|\.git-credentials|credentials(\.json)?|secrets?(\.\w+)?|.*\.(pem|key|p12|pfx|kdbx|keystore|jks|sqlite3?|db))$/i;

const KINDS: Record<string, [FileKind, string]> = {
  '.png': ['image', 'image/png'], '.jpg': ['image', 'image/jpeg'], '.jpeg': ['image', 'image/jpeg'], '.gif': ['image', 'image/gif'], '.webp': ['image', 'image/webp'],
  '.mp4': ['video', 'video/mp4'], '.mov': ['video', 'video/quicktime'], '.webm': ['video', 'video/webm'],
  '.mp3': ['audio', 'audio/mpeg'], '.ogg': ['audio', 'audio/ogg'], '.wav': ['audio', 'audio/wav'], '.m4a': ['audio', 'audio/mp4'],
  '.pdf': ['document', 'application/pdf'], '.txt': ['document', 'text/plain'], '.md': ['document', 'text/markdown'], '.csv': ['document', 'text/csv'],
  '.json': ['document', 'application/json'], '.svg': ['document', 'image/svg+xml'], '.zip': ['document', 'application/zip'],
};

export interface Sendable { path: string; name: string; size: number; kind: FileKind; mime: string }
export class SendError extends Error {}

const inside = (child: string, root: string) => child === root || child.startsWith(root.endsWith(sep) ? root : root + sep);
const real = (p: string) => { try { return realpathSync(p); } catch { return null; } };

export function resolveSendable(agent: Agent, path: string): Sendable {
  const a = resolved(agent);
  const given = String(path ?? '').trim();
  if (!given) throw new SendError('Give the path of the file to send.');
  const file = real(isAbsolute(given) ? given : join(a.cwd, given));   // a relative path is relative to the working folder
  if (!file) throw new SendError(`There is no file at "${given}". Use the path of a file that exists.`);
  const st = statSync(file);
  if (!st.isFile()) throw new SendError(`"${path}" is not a file (folders cannot be sent: zip it first).`);
  if (st.size === 0) throw new SendError('The file is empty.');
  if (st.size > MAX_SEND_BYTES) throw new SendError(`The file is too big (${Math.round(st.size / 1024 / 1024)} MB; the limit is ${MAX_SEND_BYTES / 1024 / 1024} MB).`);

  const roots = [a.cwd && real(a.cwd), real(inboxDir(agent.id)), real(tmpdir())].filter((r): r is string => !!r);
  const data = real(DATA_DIR);
  const mine = real(inboxDir(agent.id));
  if (data && inside(file, data) && !(mine && inside(file, mine))) throw new SendError('Files of hive-am itself cannot be sent.');
  if (!roots.some((r) => inside(file, r))) throw new SendError(`Only files inside your working folder${a.cwd ? ` (${a.cwd})` : ''}, the files people sent you, or the temp folder can be sent. Copy the file there first.`);
  if (SENSITIVE_NAME.test(basename(file)) || file.split(sep).includes('.git')) throw new SendError('That file looks like a credential, key, database or git internals; it is never sent.');

  const [kind, mime] = KINDS[extname(file).toLowerCase()] ?? ['document', 'application/octet-stream'];
  return { path: file, name: basename(file), size: st.size, kind, mime };
}
