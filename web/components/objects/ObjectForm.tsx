'use client';
import { useState } from 'react';
import { Field, FolderPicker, PathPicker, Segmented } from '@/components/ui';
import { useI18n } from '@/lib/i18n/index';
import { useHive } from '@/lib/store';
import type { ClusterConfig, DockerConfig, HttpConfig, ObjectKind, ObjectView, ServerConfig } from '@/lib/types';
import { KIND, envToText, lines, textToEnv } from './meta';
import { VarsEditor, type Vars } from './VarsEditor';

type Mode = NonNullable<DockerConfig['mode']>;
export interface Draft {
  name: string; colony_id: string; kind: ObjectKind;
  cwd: string; start: string; stop: string; port: string; env: string;
  restart: string; maxRestarts: string; healthKind: string; healthTarget: string; healthInterval: string; healthRetries: string; healthRestart: boolean; stopTimeout: string; logMax: string;
  folder: string; defEnv: string; variables: Vars; members: string[];
  mode: Mode; image: string; ports: string; volumes: string; dockerRestart: string; command: string; file: string; project: string; services: string; container: string;
  memory: string; cpus: string; network: string;
}
const n = (v: number | undefined) => (v === undefined ? '' : String(v));

export const draftFrom = (o?: ObjectView, colony?: string, kind?: ObjectKind): Draft => {
  const s = (o?.kind === 'server' ? o.config : {}) as Partial<ServerConfig>;
  const d = (o?.kind === 'docker' ? o.config : {}) as Partial<DockerConfig>;
  const h = (o?.kind === 'http' ? o.config : {}) as Partial<HttpConfig>;
  const c = (o?.kind === 'cluster' ? o.config : {}) as Partial<ClusterConfig>;
  return {
    name: o?.name ?? '', colony_id: o?.colony_id ?? colony ?? '', kind: o?.kind ?? kind ?? 'server',
    cwd: s.cwd ?? '', start: s.start ?? '', stop: s.stop ?? '', port: n(s.port), env: envToText(o?.kind === 'server' ? s.env : d.env),
    restart: s.restart ?? 'no', maxRestarts: n(s.maxRestarts), healthKind: s.health?.kind ?? '', healthTarget: s.health?.target ?? '', healthInterval: n(s.health?.intervalSec), healthRetries: n(s.health?.retries), healthRestart: !!s.health?.restartWhenUnhealthy,
    stopTimeout: n(o?.kind === 'server' ? s.stopTimeoutSec : d.stopTimeoutSec), logMax: n(o?.kind === 'server' ? s.logMaxMb : d.logMaxMb),
    folder: h.folder ?? '', defEnv: h.env ?? '', variables: (h.variables ?? {}) as Vars, members: c.members ?? [],
    mode: d.mode ?? 'container', image: d.image ?? '', ports: (d.ports ?? []).join('\n'), volumes: (d.volumes ?? []).join('\n'), dockerRestart: d.restart ?? 'no', command: d.command ?? '',
    file: d.file ?? '', project: d.project ?? '', services: (d.services ?? []).join(', '), container: d.container ?? '',
    memory: d.memory ?? '', cpus: n(d.cpus), network: d.network ?? '',
  };
};

const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

/** The body the server expects for this draft. */
export function toConfig(d: Draft): ServerConfig | DockerConfig | HttpConfig | ClusterConfig {
  if (d.kind === 'http') return { folder: d.folder.trim(), env: d.defEnv.trim() || undefined, variables: Object.keys(d.variables).length ? d.variables : undefined };
  if (d.kind === 'cluster') return { members: d.members };
  if (d.kind === 'server') {
    return {
      cwd: d.cwd.trim(), start: d.start.trim(), stop: d.stop.trim() || undefined, port: num(d.port), env: textToEnv(d.env),
      restart: d.restart === 'no' ? undefined : (d.restart as ServerConfig['restart']), maxRestarts: num(d.maxRestarts), stopTimeoutSec: num(d.stopTimeout), logMaxMb: num(d.logMax),
      health: d.healthKind && d.healthTarget.trim() ? { kind: d.healthKind as 'http', target: d.healthTarget.trim(), intervalSec: num(d.healthInterval), retries: num(d.healthRetries), restartWhenUnhealthy: d.healthRestart || undefined } : undefined,
    };
  }
  if (d.mode === 'existing') return { mode: 'existing', container: d.container.trim(), stopTimeoutSec: num(d.stopTimeout) };
  if (d.mode === 'compose') return { mode: 'compose', file: d.file.trim(), project: d.project.trim() || undefined, services: d.services.split(',').map((x) => x.trim()).filter(Boolean), stopTimeoutSec: num(d.stopTimeout) };
  return {
    mode: 'container', image: d.image.trim(), ports: lines(d.ports), volumes: lines(d.volumes), env: textToEnv(d.env), restart: (d.dockerRestart || 'no') as DockerConfig['restart'], command: d.command.trim() || undefined,
    memory: d.memory.trim() || undefined, cpus: num(d.cpus), network: d.network.trim() || undefined, stopTimeoutSec: num(d.stopTimeout), logMaxMb: num(d.logMax),
  };
}

/** The settings of an object, as fields. Used to create one (in a drawer) and to change it (in its own screen). */
export function ObjectFields({ d, set, setD, fileEnvs, fileVars, showKind = false, error }: {
  d: Draft; set: <K extends keyof Draft>(k: K, v: Draft[K]) => void; setD: (f: (x: Draft) => Draft) => void;
  fileEnvs?: string[]; fileVars?: Record<string, string[]>; showKind?: boolean; error?: string;
}) {
  const { t } = useI18n();
  const { colonies, objects } = useHive();
  const text = (k: keyof Draft, props: { placeholder?: string; mono?: boolean; type?: string } = {}) => (
    <input className={`input ${props.mono ? 'mono' : ''}`} type={props.type} value={d[k] as string} placeholder={props.placeholder} onChange={(e) => set(k, e.target.value as never)} />
  );
  return (
    <>
      {showKind && (
        <Field label={t('obj.kind.pick')}>
          <div className="okinds">
            {(['server', 'docker', 'http', 'cluster'] as ObjectKind[]).map((k) => { const { icon: Icon, color } = KIND[k]; return (
              <button key={k} type="button" className="okind" aria-pressed={d.kind === k} style={{ ['--c' as never]: color }} onClick={() => set('kind', k)}>
                <Icon size={20} /><b>{t(`obj.kind.${k}`)}</b><small>{t(`obj.kind.${k}.hint`)}</small>
              </button>); })}
          </div>
        </Field>
      )}
      <Field label={t('obj.f.name')} error={error}>{text('name')}</Field>
      <Field label={t('obj.colony')}>
        <select className="select" value={d.colony_id} onChange={(e) => setD((x) => ({ ...x, colony_id: e.target.value, members: [] }))}>
          <option value="">{t('obj.noColony')}</option>{colonies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>

      {d.kind === 'http' ? (<>
        <FolderPicker value={d.folder} onChange={(v) => set('folder', v)} label={t('obj.f.httpFolder')} hint={t('obj.f.httpFolder.hint')} />
        <Field label={t('obj.f.defaultEnv')} hint={t('obj.f.defaultEnv.hint')}>{text('defEnv', { placeholder: 'dev', mono: true })}</Field>
        <Field label={t('vars.title')} hint={t('vars.hint')}><VarsEditor value={d.variables} onChange={(v) => set('variables', v)} fileEnvs={fileEnvs} fileVars={fileVars} /></Field>
      </>) : d.kind === 'cluster' ? (<>
        <Field label={t('obj.f.members')} hint={t('obj.f.members.hint')}>
          {(() => {
            const pool = objects.filter((o) => (o.kind === 'server' || o.kind === 'docker') && (o.colony_id ?? '') === d.colony_id);
            if (!pool.length) return <p className="muted small" style={{ margin: 0 }}>{t('obj.f.members.none')}</p>;
            const toggle = (id: string) => set('members', d.members.includes(id) ? d.members.filter((x) => x !== id) : [...d.members, id]);
            return (<div className="omembers">{pool.map((o) => { const { icon: Icon, color } = KIND[o.kind]; const at = d.members.indexOf(o.id); return (
              <label key={o.id} className="omember"><input type="checkbox" checked={at >= 0} onChange={() => toggle(o.id)} /><Icon size={15} style={{ color }} /><span className="nm">{o.name}</span>{at >= 0 && <span className="ord">{at + 1}</span>}</label>); })}</div>);
          })()}
        </Field>
      </>) : d.kind === 'server' ? (<>
        <FolderPicker value={d.cwd} onChange={(v) => set('cwd', v)} label={t('obj.f.folder')} hint={t('obj.f.folder.hint')} />
        <Field label={t('obj.f.start')} hint={t('obj.f.start.hint')}>{text('start', { placeholder: 'npm run dev', mono: true })}</Field>
        <Field label={t('obj.f.stop')} hint={t('obj.f.stop.hint')}>{text('stop', { mono: true })}</Field>
        <Field label={t('obj.f.port')} hint={t('obj.f.port.hint')}>{text('port', { placeholder: '3000' })}</Field>
        <Field label={t('obj.f.env')} hint={t('obj.f.env.hint')}><textarea className="textarea mono" rows={3} value={d.env} onChange={(e) => set('env', e.target.value)} /></Field>
        <details className="ofold" open={d.restart !== 'no' || !!d.healthKind}>
          <summary>{t('obj.sup.title')}</summary>
          <Field label={t('obj.sup.restart')} hint={t('obj.sup.restart.hint')}>
            <div className="row gap-s"><select className="select" value={d.restart} onChange={(e) => set('restart', e.target.value)}>
              <option value="no">{t('obj.sup.restart.no')}</option><option value="on-failure">{t('obj.sup.restart.fail')}</option><option value="always">{t('obj.sup.restart.always')}</option></select>
              {d.restart !== 'no' && <input className="input" style={{ maxWidth: 130 }} value={d.maxRestarts} placeholder={t('obj.sup.max')} onChange={(e) => set('maxRestarts', e.target.value)} title={t('obj.sup.max.hint')} aria-label={t('obj.sup.max')} />}</div>
          </Field>
          <Field label={t('obj.sup.health')} hint={t('obj.sup.health.hint')}>
            <div className="row gap-s"><select className="select" style={{ maxWidth: 170 }} value={d.healthKind} onChange={(e) => set('healthKind', e.target.value)}>
              <option value="">{t('obj.sup.health.none')}</option><option value="http">HTTP</option><option value="tcp">{t('obj.sup.health.tcp')}</option><option value="command">{t('obj.sup.health.command')}</option></select>
              {d.healthKind && <input className="input mono grow" value={d.healthTarget} onChange={(e) => set('healthTarget', e.target.value)} placeholder={d.healthKind === 'http' ? 'http://127.0.0.1:3000/health' : d.healthKind === 'tcp' ? '3000' : 'curl -fs localhost:3000'} aria-label={t('obj.sup.health')} />}</div>
            {d.healthKind && (<div className="row gap-s wrap" style={{ marginTop: 8 }}>
              <input className="input" style={{ maxWidth: 150 }} value={d.healthInterval} onChange={(e) => set('healthInterval', e.target.value)} placeholder={t('obj.sup.interval')} aria-label={t('obj.sup.interval')} />
              <input className="input" style={{ maxWidth: 130 }} value={d.healthRetries} onChange={(e) => set('healthRetries', e.target.value)} placeholder={t('obj.sup.retries')} aria-label={t('obj.sup.retries')} />
              <label className="row gap-s small"><input type="checkbox" checked={d.healthRestart} onChange={(e) => set('healthRestart', e.target.checked)} />{t('obj.sup.healthRestart')}</label></div>)}
          </Field>
          <div className="row gap-s wrap">
            <Field label={t('obj.sup.stopTimeout')} hint={t('obj.sup.stopTimeout.hint')}>{text('stopTimeout', { placeholder: '8' })}</Field>
            <Field label={t('obj.sup.logMax')} hint={t('obj.sup.logMax.hint')}>{text('logMax', { placeholder: '5' })}</Field>
          </div>
        </details>
      </>) : (<>
        <Field label={t('obj.f.mode')}>
          <Segmented value={d.mode} onChange={(v) => set('mode', v)} options={[{ id: 'container', label: t('obj.mode.container') }, { id: 'compose', label: t('obj.mode.compose') }, { id: 'existing', label: t('obj.mode.existing') }]} />
        </Field>
        {d.mode === 'container' && (<>
          <Field label={t('obj.f.image')}>{text('image', { placeholder: 'nginx:alpine', mono: true })}</Field>
          <Field label={t('obj.f.ports')} hint={t('obj.f.ports.hint')}><textarea className="textarea mono" rows={2} value={d.ports} onChange={(e) => set('ports', e.target.value)} placeholder="8080:80" /></Field>
          <Field label={t('obj.f.volumes')} hint={t('obj.f.volumes.hint')}>
            <textarea className="textarea mono" rows={2} value={d.volumes} onChange={(e) => set('volumes', e.target.value)} />
            <PathPicker bare value="" buttonLabel={t('obj.f.volumes.add')} onChange={(v) => set('volumes', `${d.volumes.trimEnd()}${d.volumes.trim() ? '\n' : ''}${v}:/data`)} />
          </Field>
          <Field label={t('obj.f.env')} hint={t('obj.f.env.hint')}><textarea className="textarea mono" rows={3} value={d.env} onChange={(e) => set('env', e.target.value)} /></Field>
          <Field label={t('obj.f.restart')}>
            <select className="select" value={d.dockerRestart} onChange={(e) => set('dockerRestart', e.target.value)}>{['no', 'always', 'unless-stopped', 'on-failure'].map((r) => <option key={r} value={r}>{r}</option>)}</select>
          </Field>
          <Field label={t('obj.f.command')}>{text('command', { mono: true })}</Field>
          <details className="ofold" open={!!(d.memory || d.cpus || d.network || d.logMax || d.stopTimeout)}>
            <summary>{t('obj.dk.limits')}</summary>
            <p className="muted small" style={{ margin: '0 0 8px' }}>{t('obj.dk.limits.hint')}</p>
            <div className="row gap-s wrap">
              <Field label={t('obj.dk.memory')}>{text('memory', { placeholder: '512m' })}</Field>
              <Field label={t('obj.dk.cpus')}>{text('cpus', { placeholder: '1.5' })}</Field>
              <Field label={t('obj.dk.network')}>{text('network', { placeholder: 'bridge' })}</Field>
              <Field label={t('obj.sup.stopTimeout')}>{text('stopTimeout', { placeholder: '10' })}</Field>
              <Field label={t('obj.sup.logMax')}>{text('logMax', { placeholder: '10' })}</Field>
            </div>
          </details>
        </>)}
        {d.mode === 'compose' && (<>
          <PathPicker mode="file" exts={['yml', 'yaml']} value={d.file} onChange={(v) => set('file', v)} label={t('obj.f.file')} hint={t('obj.f.file.hint')} placeholder="/home/you/app/docker-compose.yml" />
          <Field label={t('obj.f.project')}>{text('project', { mono: true })}</Field>
          <Field label={t('obj.f.services')} hint={t('obj.f.services.hint')}>{text('services', { mono: true })}</Field>
          <Field label={t('obj.sup.stopTimeout')} hint={t('obj.sup.stopTimeout.hint')}>{text('stopTimeout', { placeholder: '10' })}</Field>
        </>)}
        {d.mode === 'existing' && (<>
          <Field label={t('obj.f.container')} hint={t('obj.f.container.hint')}>{text('container', { mono: true })}</Field>
          <Field label={t('obj.sup.stopTimeout')} hint={t('obj.sup.stopTimeout.hint')}>{text('stopTimeout', { placeholder: '10' })}</Field>
        </>)}
      </>)}
    </>
  );
}

/** A draft kept in a component, with a way to tell whether it changed. */
export function useDraft(initial: () => Draft) {
  const [d, setD] = useState<Draft>(initial);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  return { d, setD, set };
}
