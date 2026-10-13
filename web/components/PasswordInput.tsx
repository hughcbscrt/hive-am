'use client';
import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useI18n } from '@/lib/i18n/index';

/** A password field with an eye to see what is typed. `masked` (default on) lets a caller that hides the value for another reason keep it plain when off. */
export function PasswordInput({ masked = true, className = 'input mono', ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { masked?: boolean }) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  const hidden = masked && !show;
  return (
    <span className="pw">
      <input {...rest} className={className} type={hidden ? 'password' : 'text'} />
      {masked && <button type="button" className="pw-eye" onClick={() => setShow((v) => !v)} aria-pressed={show} aria-label={show ? t('common.hidePassword') : t('common.showPassword')} title={show ? t('common.hidePassword') : t('common.showPassword')}>{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>}
    </span>
  );
}
