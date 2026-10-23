'use client';
import { useState } from 'react';
import { ChevronRight, Plus, X } from 'lucide-react';
import { canCreate, validName } from '@/lib/dockerLists';
import type { DockerNetwork } from '@/lib/useDocker';
import { useI18n } from '@/lib/i18n/index';
import { Field } from '@/components/ui';
import { Suggest } from './Suggest';
import type { useDockerMake } from './DockerMake';
import type { Draft } from './ObjectForm';

/**
 * The networks a container is connected to besides its main one. Unlike everything else in the form, they change in place: applying
 * connects or disconnects them (`docker network connect / disconnect`) without creating the container again. `host` and `none` cannot be
 * one of them, and a container on one of those has none.
 */
export function ExtraNetworks({ value, onChange, main, networks, make }: {
  value: string[]; onChange: (v: string[]) => void; main: string; networks: DockerNetwork[] | null; make: ReturnType<typeof useDockerMake>;
}) {
  const { t } = useI18n();
  const [typed, setTyped] = useState('');
  const primary = main.trim() || 'bridge';
  const alone = primary === 'host' || primary === 'none';
  const name = typed.trim();
  const ok = validName('network', name) && name !== primary && name !== 'host' && name !== 'none' && !value.includes(name);
  const add = () => { if (ok) { onChange([...value, name]); setTyped(''); } };
  const missing = networks ? value.filter((x) => !networks.some((n) => n.name === x)) : [];
  if (alone) return <Field label={t('dk.extra')}><p className="muted small res-m0">{t('dk.extra.alone', { name: primary })}</p></Field>;
  return (
    <Field label={t('dk.extra')} hint={t('dk.extra.hint')}>
      {value.length > 0 && (
        <div className="chips dk-extra">{value.map((x) => (
          <span key={x} className={`chip-pick on dk-chip ${missing.includes(x) ? 'warn' : ''}`}>
            <span className="dk-chip-name">{x}</span>
            <button type="button" className="dk-chip-x" aria-label={t('dk.extra.remove', { name: x })} title={t('dk.extra.remove', { name: x })} onClick={() => onChange(value.filter((y) => y !== x))}><X size={12} aria-hidden /></button>
          </span>
        ))}</div>
      )}
      <div className="row gap-s">
        <div className="grow"><Suggest value={typed} onChange={setTyped} mono placeholder={t('dk.extra.add')} ariaLabel={t('dk.extra.add')}
          options={(networks ?? []).filter((n) => !n.builtin && n.name !== primary && !value.includes(n.name)).map((n) => ({ value: n.name, hint: [n.driver, t('dk.inUse', { count: n.inUse })].filter(Boolean).join(' · ') }))} /></div>
        <button type="button" className="btn sm" disabled={!ok} onClick={add}><Plus size={14} />{t('dk.extra.addBtn')}</button>
      </div>
      {canCreate('network', name, networks) && ok && <div className="dk-make">{make.createButton('network', name, networks, t('dk.make.network', { name }))}</div>}
      {missing.length > 0 && <p className="muted small res-mt4">{t('dk.extra.missing', { names: missing.join(', ') })}</p>}
    </Field>
  );
}

/** The other supported options of `docker run` (labels, user, working folder, entrypoint, hostname): a fixed list, no free flags. */
export function RunOptions({ d, set }: { d: Draft; set: <K extends keyof Draft>(k: K, v: Draft[K]) => void }) {
  const { t } = useI18n();
  const count = [d.labels.trim(), d.user, d.workdir, d.entrypoint, d.hostname].filter((x) => x.trim()).length;
  // Open when something is set as it is shown; after that it is the person's to open or close (emptying a field does not fold it away).
  const [startOpen] = useState(count > 0);
  const input = (k: 'user' | 'workdir' | 'entrypoint' | 'hostname', placeholder: string) => (
    <input className="input mono" value={d[k]} placeholder={placeholder} spellCheck={false} onChange={(e) => set(k, e.target.value)} />
  );
  return (
    <details className="fold of-fold" open={startOpen || undefined}>
      <summary>{t('dk.opts')}{count > 0 ? ` · ${count}` : ''}<ChevronRight size={15} className="chev" aria-hidden /></summary>
      <p className="muted small res-m0">{t('dk.opts.hint')}</p>
      <div className="of-grid2">
        <Field label={t('dk.opts.user')} hint={t('dk.opts.user.hint')}>{input('user', '1000:1000')}</Field>
        <Field label={t('dk.opts.workdir')}>{input('workdir', '/app')}</Field>
        <Field label={t('dk.opts.entrypoint')} hint={t('dk.opts.entrypoint.hint')}>{input('entrypoint', '/docker-entrypoint.sh')}</Field>
        <Field label={t('dk.opts.hostname')}>{input('hostname', 'web-1')}</Field>
      </div>
      <Field label={t('dk.opts.labels')} hint={t('dk.opts.labels.hint')}><textarea className="textarea mono" rows={3} value={d.labels} spellCheck={false} placeholder="com.example.team=web" onChange={(e) => set('labels', e.target.value)} /></Field>
    </details>
  );
}
