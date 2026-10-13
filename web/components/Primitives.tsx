'use client';
import type { KeyboardEventHandler, ReactNode, Ref } from 'react';
import { CircleAlert, Info, Search, TriangleAlert, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

/** Nothing here yet: a dashed box with an optional icon, a title, a line of help and the action that fills it. `compact` for inside a panel or list. */
export function EmptyState({ icon, title, body, action, compact = false, className = '' }: { className?: string; icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`empty ${compact ? 'compact' : ''} ${className}`}>
      {icon && <span className="empty-ic" aria-hidden>{icon}</span>}
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

const BANNER_ICON = { info: Info, warn: TriangleAlert, err: CircleAlert, honey: null } as const;
/** A message that sits in the page. Errors are announced at once (`role="alert"`), the rest politely (`status`); `onDismiss` adds a close button. */
export function Banner({ kind, role, onDismiss, action, children }: { kind: 'info' | 'warn' | 'err' | 'honey'; role?: 'alert' | 'status' | 'note'; onDismiss?: () => void; /** Right-aligned slot, e.g. a Retry button. */ action?: ReactNode; children: ReactNode }) {
  const { t } = useI18n();
  const Icon = BANNER_ICON[kind];
  return (
    <div className={`banner ${kind}`} role={role ?? (kind === 'err' ? 'alert' : 'status')}>
      {Icon && <Icon size={16} aria-hidden className="banner-ic" />}
      <div className="grow">{children}</div>
      {action && <div className="banner-action">{action}</div>}
      {onDismiss && <button type="button" className="btn ghost icon sm" onClick={onDismiss} aria-label={t('common.dismiss')} title={t('common.dismiss')}><X size={14} /></button>}
    </div>
  );
}

/** A search box: icon, label for screen readers and a clear button once something is typed. `ref`, `autoFocus` and `onKeyDown` go to the input. */
export function SearchInput({ value, onChange, placeholder, label, onClear, className = '', ref, autoFocus, onKeyDown }: { value: string; onChange: (v: string) => void; placeholder?: string; label: string; onClear?: () => void; className?: string; ref?: Ref<HTMLInputElement>; autoFocus?: boolean; onKeyDown?: KeyboardEventHandler<HTMLInputElement> }) {
  const { t } = useI18n();
  return (
    <div className={`search ${className}`}>
      <Search size={15} aria-hidden />
      <input ref={ref} className="input" value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} autoFocus={autoFocus} placeholder={placeholder} aria-label={label} autoComplete="off" spellCheck={false} />
      {value && <button type="button" className="search-clear" onClick={() => (onClear ? onClear() : onChange(''))} aria-label={t('search.clear')} title={t('search.clear')}><X size={14} /></button>}
    </div>
  );
}

/** A checkbox in a bordered row: bold label and, under it, a line of explanation. The whole row is clickable. */
export function CheckRow({ checked, onChange, label, hint, disabled = false, compact = false }: { /** Inline: no border or background, for toolbars and dense lists. */ compact?: boolean; checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={`checkrow ${compact ? 'compact' : ''} ${disabled ? 'off' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span><b>{label}</b>{hint && <span className="hint">{hint}</span>}</span>
    </label>
  );
}
