/** Light or dark: flips what layout.tsx applied before the first paint and remembers it ('hive-theme'). */
export function flipTheme(): void {
  const el = document.documentElement;
  const next = el.dataset.theme === 'dark' ? 'light' : 'dark';
  el.dataset.theme = next;
  try { localStorage.setItem('hive-theme', next); } catch { /* storage unavailable: the choice lasts until reload */ }
}
