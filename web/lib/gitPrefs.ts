'use client';
import { useSyncExternalStore } from 'react';

/** How code looks in the changes explorer (viewer, diffs and the conflict editor). Stored only in this browser. */
export interface GitPrefs { theme: string; whitespace: boolean; tabSize: 2 | 4 | 8; showIgnored: boolean }
export const GIT_THEMES: { id: string; label: string; dark: boolean; swatch: [string, string, string, string] }[] = [
  { id: 'app', label: 'Hive', dark: false, swatch: ['#f6f4ee', '#9a6a00', '#2f8f5b', '#2f5bea'] },
  { id: 'gitlab-light', label: 'GitLab Light', dark: false, swatch: ['#ffffff', '#a31515', '#0451a5', '#6f42c1'] },
  { id: 'gitlab-dark', label: 'GitLab Dark', dark: true, swatch: ['#1f1e24', '#ff7b72', '#a5d6ff', '#d2a8ff'] },
  { id: 'solarized-light', label: 'Solarized Light', dark: false, swatch: ['#fdf6e3', '#859900', '#2aa198', '#268bd2'] },
  { id: 'solarized-dark', label: 'Solarized Dark', dark: true, swatch: ['#002b36', '#859900', '#2aa198', '#268bd2'] },
  { id: 'monokai', label: 'Monokai', dark: true, swatch: ['#272822', '#f92672', '#e6db74', '#66d9ef'] },
  { id: 'dracula', label: 'Dracula', dark: true, swatch: ['#282a36', '#ff79c6', '#f1fa8c', '#8be9fd'] },
];
const KEY = 'hive-git-view';
const DEFAULTS: GitPrefs = { theme: 'app', whitespace: false, tabSize: 4, showIgnored: true };

let cache: GitPrefs = DEFAULTS;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try { const raw = localStorage.getItem(KEY); if (raw) { const p = JSON.parse(raw); cache = { ...DEFAULTS, ...p, theme: GIT_THEMES.some((t) => t.id === p.theme) ? p.theme : 'app' }; } } catch { /* use defaults */ }
}
export function setGitPrefs(patch: Partial<GitPrefs>) {
  load(); cache = { ...cache, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}
export function useGitPrefs(): GitPrefs {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => { load(); return cache; }, () => DEFAULTS);
}
