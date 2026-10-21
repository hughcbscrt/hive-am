'use client';
import { useSyncExternalStore } from 'react';

/** How the chat shows the agent's steps: one card per step (normal) or one small pill per step (compact). Stored only in this browser, for every agent. */
export type ChatView = 'normal' | 'compact';
const KEY = 'hive-am.chatView';
const DEFAULT: ChatView = 'normal';

let cache: ChatView = DEFAULT;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try { const raw = localStorage.getItem(KEY); if (raw === 'normal' || raw === 'compact') cache = raw; } catch { /* use the default */ }
}
export function setChatView(view: ChatView) {
  load(); cache = view;
  try { localStorage.setItem(KEY, view); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}
export function useChatView(): ChatView {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => { load(); return cache; }, () => DEFAULT);
}
