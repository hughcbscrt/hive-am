import { db } from '../db.js';

/**
 * An agent's notebook: Markdown it keeps for itself across conversations (see the «Notebook» default skill).
 * Lives in its own table so it never travels with the agent list. Every change bumps `version`; `seen` is the version the
 * agent's live conversation already contains, so the runtime knows when it must be re-sent (e.g. after the user edits it).
 */
db.exec(`
CREATE TABLE IF NOT EXISTS agent_notebooks (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0, seen INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0, updated_by TEXT NOT NULL DEFAULT ''
);
`);

/** It is prompt overhead on every turn, so it has a hard cap. */
export const NOTEBOOK_MAX = 8000;
const NOTE_MAX = 500;
const SECTION_MAX = 60;

export interface Notebook { content: string; version: number; seen: number; updated_at: number; updated_by: string }
export class NotebookError extends Error {}

/** What looks like a credential. Notes are copied into every future prompt, so these are refused outright. */
const SECRETS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/\b(AKIA|ASIA)[0-9A-Z]{16}\b/, 'an AWS key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, 'a GitHub token'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'an API key'],
  [/\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/, 'a Telegram bot token'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'a JWT'],
  [/\b(bearer)\s+[A-Za-z0-9._~+/-]{24,}/i, 'a bearer token'],
  [/\b(pass(word|wd)?|contrase(ñ|n)a|secret|token|api[_-]?key|access[_-]?key)\b\s*(is|es|:|=)\s*\S{6,}/i, 'a password, token or key'],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/i, 'a connection string with credentials'],
];
export function findSecret(text: string): string | null {
  for (const [re, what] of SECRETS) if (re.test(text)) return what;
  return null;
}
const refuseSecret = (text: string) => {
  const what = findSecret(text);
  if (what) throw new NotebookError(`That looks like ${what}. Credentials are never stored in the notebook: leave it out (or describe where it lives, not its value).`);
};

const empty = (): Notebook => ({ content: '', version: 0, seen: 0, updated_at: 0, updated_by: '' });

export const notebooks = {
  get: (agentId: string): Notebook => (db.prepare('SELECT content,version,seen,updated_at,updated_by FROM agent_notebooks WHERE agent_id=?').get(agentId) as Notebook | undefined) ?? empty(),

  /** The agent (or the user) replaced the text. `live`: the change happened inside the conversation the agent is running now. */
  save(agentId: string, content: string, by: 'agent' | 'user', live: boolean): Notebook {
    const cur = notebooks.get(agentId), version = cur.version + 1, t = Date.now();
    const seen = live ? version : cur.seen;
    db.prepare(`INSERT INTO agent_notebooks (agent_id,content,version,seen,updated_at,updated_by) VALUES (?,?,?,?,?,?)
      ON CONFLICT(agent_id) DO UPDATE SET content=excluded.content, version=excluded.version, seen=excluded.seen, updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
      .run(agentId, content, version, seen, t, by);
    return notebooks.get(agentId);
  },

  /** The runtime sent version `v` to the agent's conversation. */
  markSeen: (agentId: string, v: number) => { db.prepare('UPDATE agent_notebooks SET seen=MAX(seen, ?) WHERE agent_id=?').run(v, agentId); },

  /** Edit from the UI. `version` (when given) must be the one the user was looking at. */
  edit(agentId: string, content: string, version?: number): Notebook {
    const text = content.replace(/\r\n/g, '\n').trimEnd();
    if (text.length > NOTEBOOK_MAX) throw new NotebookError(`The notebook is limited to ${NOTEBOOK_MAX} characters (this has ${text.length}).`);
    if (version !== undefined && version !== notebooks.get(agentId).version) throw new NotebookError('The agent changed its notebook while you were editing. Reload it and apply your changes again.');
    return notebooks.save(agentId, text, 'user', false);
  },

  /** `notebook_add`: one short note under a section; no duplicates; keeps the notebook inside its limit. */
  add(agentId: string, sectionIn: string, noteIn: string, source: string, live: boolean): { added: boolean; notebook: Notebook; note?: string } {
    const section = String(sectionIn ?? '').replace(/[#\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SECTION_MAX) || 'General';
    const note = String(noteIn ?? '').replace(/\s+/g, ' ').trim();
    if (!note) throw new NotebookError('The note is empty.');
    if (note.length > NOTE_MAX) throw new NotebookError(`A note is one short sentence (at most ${NOTE_MAX} characters; this has ${note.length}). Say it shorter, or split it in separate notes.`);
    refuseSecret(`${section}\n${note}`);

    const cur = notebooks.get(agentId);
    const key = (s: string) => s.replace(/\s*_\([^)]*\)_\s*$/, '').replace(/^[-*]\s+/, '').trim().toLowerCase();
    if (cur.content.split('\n').some((l) => key(l) === note.toLowerCase())) return { added: false, notebook: cur, note: 'That note is already in the notebook.' };

    const bullet = `- ${note}${source ? ` _(${source})_` : ''}`;
    const lines = cur.content ? cur.content.split('\n') : [];
    const head = lines.findIndex((l) => /^##\s/.test(l) && l.replace(/^##\s+/, '').trim().toLowerCase() === section.toLowerCase());
    if (head < 0) {
      if (lines.length && lines[lines.length - 1].trim()) lines.push('');
      lines.push(`## ${section}`, bullet);
    } else {
      let end = head + 1;
      while (end < lines.length && !/^##\s/.test(lines[end])) end++;
      let at = end; while (at > head + 1 && !lines[at - 1].trim()) at--; // after the last non-blank line of the section
      lines.splice(at, 0, bullet);
    }
    const next = lines.join('\n').trimEnd();
    if (next.length > NOTEBOOK_MAX) throw new NotebookError(`The notebook is full (${cur.content.length} of ${NOTEBOOK_MAX} characters). Read it, then call notebook_rewrite with a shorter version: merge duplicates, drop what is outdated or one-off, keep what is most useful. Then add this note again.`);
    return { added: true, notebook: notebooks.save(agentId, next, 'agent', live) };
  },

  /** `notebook_rewrite`: replaces everything; only valid against the version the agent read. */
  rewrite(agentId: string, contentIn: string, version: number, live: boolean): Notebook {
    const cur = notebooks.get(agentId);
    if (version !== cur.version) throw new NotebookError(`The notebook is now at version ${cur.version} (you sent ${version}): it changed since you read it. Call notebook_read and merge your changes into the current text.`);
    const content = String(contentIn ?? '').replace(/\r\n/g, '\n').trimEnd();
    if (content.length > NOTEBOOK_MAX) throw new NotebookError(`Still too long: ${content.length} of ${NOTEBOOK_MAX} characters. Cut more (merge duplicates, drop one-off notes).`);
    const known = new Set(cur.content.split('\n'));
    for (const l of content.split('\n')) if (!known.has(l)) refuseSecret(l);
    return notebooks.save(agentId, content, 'agent', live);
  },
};
