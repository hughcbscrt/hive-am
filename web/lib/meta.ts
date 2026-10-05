import type { Permission, Provider } from './types';

export const PROVIDERS: Record<Provider, { label: string; short: string; color: string; blurb: string }> = {
  claude: { label: 'Claude Code', short: 'Claude', color: 'var(--p-claude)', blurb: 'Anthropic’s coding agent. Streams tokens, resumes by session id.' },
  opencode: { label: 'OpenCode', short: 'OpenCode', color: 'var(--p-opencode)', blurb: 'Open-source agent over any model provider you have configured.' },
  kiro: { label: 'Kiro', short: 'Kiro', color: 'var(--p-kiro)', blurb: 'AWS’s agentic CLI with spec-driven workflows.' },
};

export const PERMISSIONS: { id: Permission; label: string; hint: string }[] = [
  { id: 'plan', label: 'Read-only', hint: 'Plans and reads; never edits files or runs commands.' },
  { id: 'acceptEdits', label: 'Edit files', hint: 'Edits files freely; other risky actions follow the CLI’s own rules.' },
  { id: 'bypassPermissions', label: 'Full access', hint: 'Runs anything without asking. Use in throwaway folders.' },
];

export function ago(ts: number | null | undefined): string {
  if (!ts) return '—';
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24); if (d < 30) return `${d} d ago`;
  return new Date(ts).toLocaleDateString();
}

export const shortPath = (p: string) => p.replace(/^\/home\/[^/]+/, '~');
export const initials = (n: string) => n.split(/[\s_-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
