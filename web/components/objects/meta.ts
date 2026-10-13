import { Boxes, Container, Database, Globe, Server, type LucideIcon } from 'lucide-react';
import { CLUSTER_COLOR } from '@/lib/meta';
import type { ObjectKind, ObjectStatus } from '@/lib/types';

export const KIND: Record<ObjectKind, { color: string; icon: LucideIcon }> = {
  server: { color: '#0f8f9e', icon: Server },
  docker: { color: '#2496ed', icon: Container },
  http: { color: '#7a4de0', icon: Globe },
  database: { color: '#d9822b', icon: Database },
  cluster: { color: CLUSTER_COLOR, icon: Boxes },
};
export const STATUS_TONE: Record<ObjectStatus, 'ok' | 'warn' | 'err' | 'off'> = { running: 'ok', ready: 'ok', starting: 'warn', error: 'err', stopped: 'off', unknown: 'off' };

/** NAME=value lines ⇄ an object of variables. */
export const envToText = (env?: Record<string, string>) => Object.entries(env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n');
export function textToEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) { const l = line.trim(); if (!l || l.startsWith('#')) continue; const i = l.indexOf('='); if (i <= 0) throw new Error(`"${l}" is not NAME=value`); out[l.slice(0, i).trim()] = l.slice(i + 1); }
  return out;
}
export const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);

/**
 * The server describes states in English ("2/3 running", "exited with code 3"…). This puts the usual ones in the language of the
 * interface; anything it does not know is shown as it came.
 */
const DETAILS: [RegExp, string][] = [
  [/^(\d+) requests in (\d+) files$/, 'd.requests'], [/^(\d+)\/(\d+) running$/, 'd.running'], [/^no members$/, 'd.noMembers'],
  [/^only (\d+)\/(\d+) running · stopped: (.+)$/, 'd.onlySome'], [/^(.+) failed · (\d+)\/(\d+) running$/, 'd.failed'],
  [/^waiting for port (\d+)$/, 'd.waitPort'], [/^running, but nothing listens on port (\d+)$/, 'd.noPort'], [/^exited with code (\d+)$/, 'd.exited'], [/^ended by (\w+)$/, 'd.signal'],
  [/^restarted \((\d+)\/(\d+)\)$/, 'd.restarted'], [/^was unhealthy: restarting \((\d+)\/(\d+)\)$/, 'd.unhealthyRestart'],
  [/^health check pending$/, 'd.healthPending'], [/^restarting$/, 'd.restarting'], [/^container not found$/, 'd.noContainer'], [/^the compose file is missing$/, 'd.noCompose'],
  [/^(\d+) of (\d+) running$/, 'd.running2'], [/^(\d+) services?$/, 'd.services'], [/^a service exited with an error$/, 'd.serviceFailed'], [/^checking…$/, 'd.checking'], [/^unhealthy$/, 'd.unhealthy'],
];
export function detailText(t: (k: any, v?: Record<string, string | number>) => string, detail?: string): string {
  if (!detail) return '';
  // "exited with code 3 · restarting in 2 s (1/5)" is several pieces joined by " · ": each one is translated on its own.
  return detail.split(' · ').map((piece) => {
    for (const [re, key] of DETAILS) { const m = re.exec(piece); if (m) return t(key, Object.fromEntries(m.slice(1).map((v, i) => [`a${i + 1}`, v]))); }
    const r = /^(.*)restarting in (\d+) s \((\d+)\/(\d+)\)$/.exec(piece); if (r) return t('d.restartIn', { a1: r[2], a2: r[3], a3: r[4] });
    const g = /^gave up after (\d+) restarts$/.exec(piece); if (g) return t('d.gaveUp', { a1: g[1] });
    const u = /^unhealthy: (.+)$/.exec(piece); if (u) return `${t('d.unhealthy')}: ${u[1]}`;
    return piece;
  }).join(' · ');
}
