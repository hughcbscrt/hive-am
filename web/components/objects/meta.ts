import { Container, Server, type LucideIcon } from 'lucide-react';
import type { ObjectKind, ObjectStatus } from '@/lib/types';

export const KIND: Record<ObjectKind, { color: string; icon: LucideIcon }> = {
  server: { color: '#0f8f9e', icon: Server },
  docker: { color: '#2496ed', icon: Container },
};
export const STATUS_TONE: Record<ObjectStatus, 'ok' | 'warn' | 'err' | 'off'> = { running: 'ok', starting: 'warn', error: 'err', stopped: 'off', unknown: 'off' };

/** NAME=value lines ⇄ an object of variables. */
export const envToText = (env?: Record<string, string>) => Object.entries(env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n');
export function textToEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) { const l = line.trim(); if (!l || l.startsWith('#')) continue; const i = l.indexOf('='); if (i <= 0) throw new Error(`"${l}" is not NAME=value`); out[l.slice(0, i).trim()] = l.slice(i + 1); }
  return out;
}
export const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);
