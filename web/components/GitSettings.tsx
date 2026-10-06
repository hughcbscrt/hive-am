'use client';
import { useRef, useState } from 'react';
import { Check, Settings2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useDismiss } from '@/lib/useDismiss';
import { GIT_THEMES, setGitPrefs, useGitPrefs } from '@/lib/gitPrefs';

/** How code looks in the explorer: theme, visible whitespace and tab width. Remembered in this browser. */
export function GitSettings() {
  const { t } = useI18n();
  const prefs = useGitPrefs();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(open, box, () => setOpen(false));

  return (
    <div className="gx-brmenu gx-set" ref={box}>
      <button type="button" className="btn ghost icon sm" aria-expanded={open} aria-haspopup="dialog" aria-label={t('git.set.title')} title={t('git.set.title')} onClick={() => setOpen((o) => !o)}><Settings2 size={15} /></button>
      {open && (
        <div className="gx-pop gx-setpop" role="dialog" aria-label={t('git.set.title')}>
          <div className="gx-brhead" style={{ padding: '0 2px' }}>{t('git.set.theme')}</div>
          <div className="gx-themes" role="radiogroup" aria-label={t('git.set.theme')}>
            {GIT_THEMES.map((th) => (
              <button key={th.id} type="button" role="radio" aria-checked={prefs.theme === th.id} className={`gx-theme ${prefs.theme === th.id ? 'on' : ''}`} onClick={() => setGitPrefs({ theme: th.id })}>
                <span className="sw" style={{ background: th.swatch[0] }}><i style={{ background: th.swatch[1] }} /><i style={{ background: th.swatch[2] }} /><i style={{ background: th.swatch[3] }} /></span>
                <span className="nm">{th.id === 'app' ? t('git.set.themeApp') : th.label}</span>{prefs.theme === th.id && <Check size={14} />}
              </button>
            ))}
          </div>
          <label className="gx-opt"><input type="checkbox" checked={prefs.whitespace} onChange={(e) => setGitPrefs({ whitespace: e.target.checked })} /><span><b>{t('git.set.whitespace')}</b><small>{t('git.set.whitespace.hint')}</small></span></label>
          <div className="gx-opt"><span><b>{t('git.set.tab')}</b></span>
            <div className="seg" role="group">{([2, 4, 8] as const).map((n) => <button key={n} type="button" aria-pressed={prefs.tabSize === n} onClick={() => setGitPrefs({ tabSize: n })}>{n}</button>)}</div></div>
          <p className="small muted" style={{ margin: 0 }}>{t('git.set.note')}</p>
        </div>
      )}
    </div>
  );
}
