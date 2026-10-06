import { useI18n } from '@/lib/i18n';
import type { GitChangeStatus } from '@/lib/types';

export const STATUS_LETTER: Record<GitChangeStatus, string> = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U', conflict: '!', typechange: 'T' };

/** The one-letter change badge (M, A, D, R, U, !, T) used by the file tree, the commit dialog and commit file lists. */
export function StatusLetter({ status, titled = false }: { status: GitChangeStatus; titled?: boolean }) {
  const { t } = useI18n();
  return <span className={`stl st-${status}`} title={titled ? t(`git.status.${status}`) : undefined}>{STATUS_LETTER[status]}</span>;
}
