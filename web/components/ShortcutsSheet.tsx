'use client';
import { Fragment } from 'react';
import { Modal } from './ui';
import { HOTKEYS, type HotkeyDef, type KeyCap } from '@/lib/hotkeyRules';
import { useI18n } from '@/lib/i18n';

const GROUPS: { id: HotkeyDef['group']; label: 'keys.group.anywhere' | 'keys.group.outside' | 'keys.group.existing' }[] = [
  { id: 'anywhere', label: 'keys.group.anywhere' }, { id: 'outside', label: 'keys.group.outside' }, { id: 'existing', label: 'keys.group.existing' },
];

/** `?`: every shortcut, from the same list the rules use. Keys read ⌘ or Ctrl as on this computer, and "Command K" / "Control K" aloud. */
export function ShortcutsSheet({ onClose, mac }: { onClose: () => void; mac: boolean }) {
  const { t } = useI18n();
  const cap = (k: KeyCap) => (k === 'Mod' ? (mac ? '⌘' : 'Ctrl') : k);
  const spoken = (k: KeyCap) => (k === 'Mod' ? t(mac ? 'keys.mod.cmd' : 'keys.mod.ctrl') : k === 'Ctrl' ? t('keys.mod.ctrl') : k);
  return (
    <Modal title={t('keys.title')} onClose={onClose}>
      <div className="keys-sheet">
        {GROUPS.map((g) => (
          <section key={g.id}>
            <h4>{t(g.label)}</h4>
            <dl>
              {HOTKEYS.filter((h) => h.group === g.id).map((h) => (
                <Fragment key={h.id}>
                  <dt>{t(h.label)}</dt>
                  <dd><span className="sr-only">{h.keys.map(spoken).join(' ')}</span>{h.keys.map((k, i) => <kbd key={i} aria-hidden>{cap(k)}</kbd>)}</dd>
                </Fragment>
              ))}
            </dl>
          </section>
        ))}
        <p className="muted small m0">{t('keys.note')}</p>
      </div>
    </Modal>
  );
}
