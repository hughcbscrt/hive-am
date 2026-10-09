import { mkdirSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DATA_DIR } from '../db.js';
import type { ChannelAdapter, Inbound, SavedFile } from './types.js';

/**
 * Files people send to an agent. They are saved on this machine, in a folder per agent, so the agent can open them with
 * its own file tools; the message tells it where they are. Nothing here is ever executed.
 */
export const MAX_FILE_BYTES = 20 * 1024 * 1024; // Telegram bots cannot download more than this anyway
export const MAX_FILES = 5;                      // per message: the rest are mentioned but not saved
export const RETENTION_DAYS = 14;

/** Where the files an agent received live. Claude needs this folder added explicitly (see providers/claude.ts). */
export const inboxDir = (agentId: string) => join(DATA_DIR, 'inbox', agentId);

/** A file name that is safe on disk: no folders, no control or odd characters, never hidden, not endless. */
export function safeName(name: string): string {
  const base = basename(String(name ?? '').replace(/\\/g, '/')).normalize('NFC');
  const clean = base.replace(/[^\p{L}\p{N}._ -]+/gu, '_').replace(/\s+/g, ' ').replace(/^[.\s]+/, '').trim();
  const dot = clean.lastIndexOf('.');
  const ext = dot > 0 && clean.length - dot <= 12 ? clean.slice(dot) : '';
  const stem = (ext ? clean.slice(0, dot) : clean).slice(0, 80);
  return `${stem || 'file'}${ext}`;
}

export interface SaveResult { saved: SavedFile[]; failed: { name: string; reason: string }[] }

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

/** Downloads the attachments of one inbound message (the sender is already authorized). */
export async function saveAttachments(agentId: string, adapter: ChannelAdapter, m: Inbound): Promise<SaveResult> {
  const out: SaveResult = { saved: [], failed: [] };
  const list = m.attachments ?? [];
  const day = new Date().toISOString().slice(0, 10);
  const dir = join(inboxDir(agentId), day);
  for (const [i, att] of list.entries()) {
    if (i >= MAX_FILES) { out.failed.push({ name: att.name, reason: `only the first ${MAX_FILES} files of a message are kept` }); continue; }
    if (!adapter.download) { out.failed.push({ name: att.name, reason: 'this connection cannot download files' }); continue; }
    if (att.size && att.size > MAX_FILE_BYTES) { out.failed.push({ name: att.name, reason: `too big (limit ${mb(MAX_FILE_BYTES)})` }); continue; }
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${m.externalId}-${i + 1}-${safeName(att.name)}`);
    try {
      const size = await adapter.download(att, path);
      out.saved.push({ path, name: att.name, kind: att.kind, mime: att.mime, size });
    } catch (e) {
      try { unlinkSync(path); } catch { /* nothing was written */ }
      out.failed.push({ name: att.name, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/** Deletes received files older than the retention period (and the day folders that are left empty). */
export function cleanInbox(days = RETENTION_DAYS, now = Date.now()): number {
  const root = join(DATA_DIR, 'inbox');
  let removed = 0;
  let agents: string[] = [];
  try { agents = readdirSync(root); } catch { return 0; }
  for (const a of agents) {
    let dayDirs: string[] = [];
    try { dayDirs = readdirSync(join(root, a)); } catch { continue; }
    for (const d of dayDirs) {
      const dir = join(root, a, d);
      try {
        for (const f of readdirSync(dir)) {
          if (now - statSync(join(dir, f)).mtimeMs > days * 86_400_000) { unlinkSync(join(dir, f)); removed++; }
        }
        if (!readdirSync(dir).length) rmSync(dir, { recursive: true });
      } catch { /* a folder changed under us: next round */ }
    }
  }
  return removed;
}

export const describeFile = (f: Pick<SavedFile, 'name' | 'kind' | 'mime' | 'size'>) =>
  `${f.kind}${f.mime ? `, ${f.mime}` : ''}, ${f.size < 1024 ? `${f.size} B` : f.size < 1024 * 1024 ? `${Math.round(f.size / 1024)} KB` : `${(f.size / 1024 / 1024).toFixed(1)} MB`}`;
