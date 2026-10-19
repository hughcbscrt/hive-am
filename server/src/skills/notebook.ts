import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { DomainError } from '../errors.js';

/**
 * A notebook: Markdown an agent keeps for itself across conversations (see the «Notebook» default skill). It is an object of its own with
 * readers (`notebooks` and `notebook_readers`, created by db/migrations.ts): an agent and the clones made from it read and write the same one, and
 * it goes away only with its last reader. It lives in its own table so it never travels with the agent list. Every change bumps `version`;
 * `seen` belongs to the reader: it is the version that agent's live conversation already contains, so the runtime knows when the text must be
 * re-sent to it (e.g. after the user, or another agent that shares the notebook, changed it).
 */

/** It is prompt overhead on every turn, so it has a hard cap. */
export const NOTEBOOK_MAX = 8000;
const NOTE_MAX = 500;
const SECTION_MAX = 60;

export interface Notebook { content: string; version: number; seen: number; updated_at: number; updated_by: string }
export class NotebookError extends DomainError {}

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

/** The notebook an agent reads, with that agent's own `seen`. */
const readerRow = (agentId: string) => db.prepare(`SELECT n.id, n.content, n.version, r.seen, n.updated_at, n.updated_by FROM notebook_readers r JOIN notebooks n ON n.id = r.notebook_id WHERE r.agent_id = ?`).get(agentId) as (Notebook & { id: string }) | undefined;

export interface Reader { id: string; name: string }

/** The notebook the agent reads, created empty (version 0) when it has none yet. */
function ensure(agentId: string) {
  let row = readerRow(agentId);
  if (!row) {
    const id = randomUUID();
    db.prepare('INSERT INTO notebooks (id) VALUES (?)').run(id);
    db.prepare('INSERT INTO notebook_readers (agent_id, notebook_id, seen) VALUES (?,?,0)').run(agentId, id);
    row = readerRow(agentId)!;
  }
  return row;
}

export const notebooks = {
  get: (agentId: string): Notebook => { const r = readerRow(agentId); return r ? { content: r.content, version: r.version, seen: r.seen, updated_at: r.updated_at, updated_by: r.updated_by } : empty(); },

  /** The other agents that read the same notebook (empty for an ordinary notebook). */
  sharedWith(agentId: string): Reader[] {
    const r = readerRow(agentId); if (!r) return [];
    return db.prepare('SELECT a.id, a.name FROM notebook_readers x JOIN agents a ON a.id = x.agent_id WHERE x.notebook_id = ? AND x.agent_id <> ? ORDER BY a.name').all(r.id, agentId) as Reader[];
  },

  /** The agent (or the user) replaced the text. `live`: the change happened inside the conversation the agent is running now. */
  save: db.transaction((agentId: string, content: string, by: 'agent' | 'user', live: boolean): Notebook => {
    const row = ensure(agentId);                                       // an agent that never had one gets its own
    const version = row.version + 1;
    db.prepare('UPDATE notebooks SET content=?, version=?, updated_at=?, updated_by=? WHERE id=?').run(content, version, Date.now(), by, row.id);
    // Only the writer's own conversation already contains what it just wrote; the other readers are sent it on their next turn.
    if (live) db.prepare('UPDATE notebook_readers SET seen=? WHERE agent_id=?').run(version, agentId);
    return notebooks.get(agentId);
  }),

  /** The runtime sent version `v` to the agent's conversation. */
  markSeen: (agentId: string, v: number) => { db.prepare('UPDATE notebook_readers SET seen=MAX(seen, ?) WHERE agent_id=?').run(v, agentId); },

  /**
   * `to` starts reading the notebook of `from` (a clone sharing its source's notes): `from` gets one if it had none, and what `to` read before
   * is dropped with its last reader. Its `seen` starts at 0, so its first turn is sent the text.
   */
  share: db.transaction((fromId: string, toId: string): void => {
    if (fromId === toId) return;
    const nb = ensure(fromId);
    db.prepare('INSERT INTO notebook_readers (agent_id, notebook_id, seen) VALUES (?,?,0) ON CONFLICT(agent_id) DO UPDATE SET notebook_id=excluded.notebook_id, seen=0').run(toId, nb.id);
    db.prepare('DELETE FROM notebooks WHERE id NOT IN (SELECT notebook_id FROM notebook_readers)').run();      // what `to` read before, if nobody else does
  }),

  /** Gives the agent its own copy of the notebook it shares, and leaves the shared one with the others. Does nothing for an agent that shares nothing. */
  separate: db.transaction((agentId: string): Notebook => {
    const row = readerRow(agentId);
    if (!row || !notebooks.sharedWith(agentId).length) return notebooks.get(agentId);
    const id = randomUUID();
    db.prepare('INSERT INTO notebooks (id, content, version, updated_at, updated_by) VALUES (?,?,?,?,?)').run(id, row.content, row.version, row.updated_at, row.updated_by);
    db.prepare('UPDATE notebook_readers SET notebook_id=? WHERE agent_id=?').run(id, agentId);              // `seen` stays: it still describes what this agent's conversation holds
    return notebooks.get(agentId);
  }),

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
