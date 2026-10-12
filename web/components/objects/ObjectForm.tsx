'use client';
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Field, FolderPicker, PathPicker, Segmented } from '@/components/ui';
import { useComposeServices, useDockerLists } from '@/lib/useDocker';
import { Suggest } from './Suggest';
import { TemplatePicker } from './TemplatePicker';
import { useI18n } from '@/lib/i18n/index';
import { useHive } from '@/lib/store';
import type { ClusterConfig, DatabaseConfig, DbEngine, DockerConfig, HttpConfig, HttpScan, ObjectKind, ObjectView, ServerConfig } from '@/lib/types';
import { KIND, envToText, lines, textToEnv } from './meta';
import { VarsEditor, type Vars } from './VarsEditor';
import { DatabaseCards, suggestDbName } from './DatabaseCards';

type Mode = NonNullable<DockerConfig['mode']> | 'template';
export interface Draft {
  name: string; colony_id: string; kind: ObjectKind;
  cwd: string; start: string; stop: string; port: string; env: string;
  restart: string; maxRestarts: string; healthKind: string; healthTarget: string; healthInterval: string; healthRetries: string; healthRestart: boolean; stopTimeout: string; logMax: string;
  folder: string; defEnv: string; variables: Vars; members: string[];
  template: string; tplValues: Record<string, string>;
  mode: Mode; image: string; ports: string; volumes: string; dockerRestart: string; command: string; file: string; project: string; services: string; container: string;
  memory: string; cpus: string; network: string;
  engine: DbEngine; dbHost: string; dbPort: string; dbUser: string; dbPassword: string; dbPasswordSet: boolean; dbName: string; dbFile: string; dbSsl: boolean; dbTrust: boolean; dbReadOnly: boolean; dbTimeout: string; dbMaxRows: string; dbProps: Record<string, string>;
}
const n = (v: number | undefined) => (v === undefined ? '' : String(v));

export const draftFrom = (o?: ObjectView, colony?: string, kind?: ObjectKind): Draft => {
  const s = (o?.kind === 'server' ? o.config : {}) as Partial<ServerConfig>;
  const d = (o?.kind === 'docker' ? o.config : {}) as Partial<DockerConfig>;
  const h = (o?.kind === 'http' ? o.config : {}) as Partial<HttpConfig>;
  const c = (o?.kind === 'cluster' ? o.config : {}) as Partial<ClusterConfig>;
  const q = (o?.kind === 'database' ? o.config : {}) as Partial<DatabaseConfig>;
  return {
    name: o?.name ?? '', colony_id: o?.colony_id ?? colony ?? '', kind: o?.kind ?? kind ?? 'server',
    cwd: s.cwd ?? '', start: s.start ?? '', stop: s.stop ?? '', port: n(s.port), env: envToText(o?.kind === 'server' ? s.env : d.env),
    restart: s.restart ?? 'no', maxRestarts: n(s.maxRestarts), healthKind: s.health?.kind ?? '', healthTarget: s.health?.target ?? '', healthInterval: n(s.health?.intervalSec), healthRetries: n(s.health?.retries), healthRestart: !!s.health?.restartWhenUnhealthy,
    stopTimeout: n(o?.kind === 'server' ? s.stopTimeoutSec : d.stopTimeoutSec), logMax: n(o?.kind === 'server' ? s.logMaxMb : d.logMaxMb),
    folder: h.folder ?? '', defEnv: h.env ?? '', variables: (h.variables ?? {}) as Vars, members: c.members ?? [],
    template: '', tplValues: {},
    mode: d.mode ?? (o ? 'container' : 'template'), image: d.image ?? '', ports: (d.ports ?? []).join('\n'), volumes: (d.volumes ?? []).join('\n'), dockerRestart: d.restart ?? 'no', command: d.command ?? '',
    file: d.file ?? '', project: d.project ?? '', services: (d.services ?? []).join(', '), container: d.container ?? '',
    memory: d.memory ?? '', cpus: n(d.cpus), network: d.network ?? '',
    engine: q.engine ?? 'postgresql', dbHost: q.host ?? '', dbPort: n(q.port), dbUser: q.user ?? '', dbPassword: '', dbPasswordSet: !!q.passwordSet, dbName: q.database ?? '', dbFile: q.file ?? '',
    dbSsl: !!q.ssl, dbTrust: !!q.trustCert, dbReadOnly: q.readOnly !== false, dbTimeout: n(q.timeoutSec), dbMaxRows: n(q.maxRows), dbProps: { ...(q.props ?? {}) },
  };
};

const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

/** The body the server expects for this draft. */
export function toConfig(d: Draft): ServerConfig | DockerConfig | HttpConfig | DatabaseConfig | ClusterConfig {
  if (d.kind === 'database') return dbConfigOf(d);
  if (d.kind === 'http') return { folder: d.folder.trim(), env: d.defEnv.trim() || undefined, variables: Object.keys(d.variables).length ? d.variables : undefined };
  if (d.kind === 'cluster') return { members: d.members };
  if (d.kind === 'server') {
    return {
      cwd: d.cwd.trim(), start: d.start.trim(), stop: d.stop.trim() || undefined, port: num(d.port), env: textToEnv(d.env),
      restart: d.restart === 'no' ? undefined : (d.restart as ServerConfig['restart']), maxRestarts: num(d.maxRestarts), stopTimeoutSec: num(d.stopTimeout), logMaxMb: num(d.logMax),
      health: d.healthKind && d.healthTarget.trim() ? { kind: d.healthKind as 'http', target: d.healthTarget.trim(), intervalSec: num(d.healthInterval), retries: num(d.healthRetries), restartWhenUnhealthy: d.healthRestart || undefined } : undefined,
    };
  }
  if (d.mode === 'template') return { mode: 'compose' };   // creating from a template goes through its own call (see ObjectEditor)
  if (d.mode === 'existing') return { mode: 'existing', container: d.container.trim(), stopTimeoutSec: num(d.stopTimeout) };
  if (d.mode === 'compose') return { mode: 'compose', file: d.file.trim(), project: d.project.trim() || undefined, services: d.services.split(',').map((x) => x.trim()).filter(Boolean), stopTimeoutSec: num(d.stopTimeout) };
  return {
    mode: 'container', image: d.image.trim(), ports: lines(d.ports), volumes: lines(d.volumes), env: textToEnv(d.env), restart: (d.dockerRestart || 'no') as DockerConfig['restart'], command: d.command.trim() || undefined,
    memory: d.memory.trim() || undefined, cpus: num(d.cpus), network: d.network.trim() || undefined, stopTimeoutSec: num(d.stopTimeout), logMaxMb: num(d.logMax),
  };
}

/** What the server expects for a database draft (the password empty means: keep the saved one). */
export const dbConfigOf = (d: Draft): DatabaseConfig => {
  // A property with no value is not set; the SSL ones only count while SSL is on.
  const entries = Object.entries(d.dbProps).filter(([k, v]) => v.trim() !== '' && (d.dbSsl || !k.startsWith('ssl.')));
  const props = entries.length ? Object.fromEntries(entries) : undefined;
  return d.engine === 'sqlite'
  ? { engine: 'sqlite', file: d.dbFile.trim(), props, readOnly: d.dbReadOnly, timeoutSec: num(d.dbTimeout), maxRows: num(d.dbMaxRows) }
  : { engine: d.engine, host: d.dbHost.trim() || undefined, port: num(d.dbPort), user: d.dbUser.trim() || undefined, password: d.dbPassword, database: d.dbName.trim() || undefined,
      ssl: d.dbSsl || undefined, trustCert: d.dbSsl && d.dbTrust ? true : undefined, props, readOnly: d.dbReadOnly, timeoutSec: num(d.dbTimeout), maxRows: num(d.dbMaxRows) };
};

export const Card = ({ title, hint, wide = false, children }: { title: string; hint?: string; wide?: boolean; children: React.ReactNode }) => (
  <section className={`of-card ${wide ? 'wide' : ''}`} id={`of-${title.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-')}`} data-title={title}><header><h4>{title}</h4>{hint && <p className="muted small">{hint}</p>}</header>{children}</section>
);

/** The services of a compose file, to pick (none picked = all of them). */
function ServicePicker({ file, project, services, onServices, onProject }: { file: string; project: string; services: string; onServices: (v: string) => void; onProject: (v: string) => void }) {
  const { t } = useI18n();
  const { info, err, loading } = useComposeServices(file);
  const picked = new Set(services.split(',').map((x) => x.trim()).filter(Boolean));
  const toggle = (s: string) => { const n = new Set(picked); if (n.has(s)) n.delete(s); else n.add(s); onServices([...n].join(', ')); };
  return (
    <>
      <Field label={t('obj.f.services')} hint={t('dk.services.hint')}>
        {!file ? <p className="muted small" style={{ margin: 0 }}>{t('dk.services.pickFile')}</p>
          : loading ? <p className="muted small" style={{ margin: 0 }}>{t('dk.services.loading')}</p>
          : err ? <p className="gx-note err" style={{ margin: 0 }}>{err}</p>
          : info && info.services.length === 0 ? <p className="muted small" style={{ margin: 0 }}>{t('dk.services.none')}</p>
          : info ? (<>
            <div className="chips">{info.services.map((sv) => <button key={sv} type="button" className={`chip-pick ${picked.has(sv) ? 'on' : ''}`} aria-pressed={picked.has(sv)} onClick={() => toggle(sv)}>{sv}</button>)}</div>
            {info.source === 'file' && <p className="muted small" style={{ margin: '6px 0 0' }}>{t('dk.services.file')}</p>}
          </>) : null}
      </Field>
      <Field label={t('obj.f.project')} hint={t('dk.project.hint')}>
        <div className="row gap-s"><input className="input mono" value={project} onChange={(e) => onProject(e.target.value)} placeholder={info?.project} />
          {info && !project && <button type="button" className="btn sm" onClick={() => onProject(info.project)}>{t('dk.project.use', { name: info.project })}</button>}</div>
      </Field>
    </>
  );
}

/** The settings of an object, as fields in cards (one column in a drawer, several on a wide screen). Used to create one and to change it. */
export function ObjectFields({ d, set, setD, scan, showKind = false, error, objectId }: {
  objectId?: string; d: Draft; set: <K extends keyof Draft>(k: K, v: Draft[K]) => void; setD: (f: (x: Draft) => Draft) => void;
  scan?: HttpScan | null; showKind?: boolean; error?: string;
}) {
  const { t } = useI18n();
  const { colonies, objects } = useHive();
  const needsDocker = d.kind === 'docker' && (d.mode === 'existing' || d.mode === 'container');
  const docker = useDockerLists(needsDocker);
  const text = (k: keyof Draft, props: { placeholder?: string; mono?: boolean; type?: string } = {}) => (
    <input className={`input ${props.mono ? 'mono' : ''}`} type={props.type} value={d[k] as string} placeholder={props.placeholder} onChange={(e) => set(k, e.target.value as never)} />
  );
  const dockerNote = docker.error ? <p className="muted small" style={{ margin: '4px 0 0' }}>{t('dk.unavailable', { error: docker.error })}</p> : null;
  const refresh = <button type="button" className="btn ghost icon sm" onClick={docker.reload} aria-label={t('dk.refresh')} title={t('dk.refresh')}><RefreshCw size={14} /></button>;
  const fileEnvs = scan ? Object.keys(scan.fileVars).filter((e) => e !== '$shared') : undefined;
  // In the settings of an existing object these live in the one General card (its variables have their own tab); creating one, in cards of their own.
  const httpFiles = (<>
    <FolderPicker value={d.folder} onChange={(v) => set('folder', v)} label={t('obj.f.httpFolder')} hint={t('obj.f.httpFolder.hint')} />
    <Field label={t('obj.f.defaultEnv')} hint={t('obj.f.defaultEnv.hint')}>
      <Suggest value={d.defEnv} onChange={(v) => set('defEnv', v)} mono placeholder="dev" options={[...new Set([...(scan?.environments ?? []), ...Object.keys(d.variables).filter((k) => k !== '$shared')])].map((v) => ({ value: v }))} />
    </Field>
  </>);

  return (
    <div className="of">
      {showKind && (
        <Card title={t('obj.kind.pick')} wide>
          <div className="okinds">
            {(['server', 'docker', 'http', 'database', 'cluster'] as ObjectKind[]).map((k) => { const { icon: Icon, color } = KIND[k]; return (
              <button key={k} type="button" className="okind" aria-pressed={d.kind === k} style={{ ['--c' as never]: color }} onClick={() => set('kind', k)}>
                <Icon size={20} /><b>{t(`obj.kind.${k}`)}</b><small>{t(`obj.kind.${k}.hint`)}</small>
              </button>); })}
          </div>
        </Card>
      )}
      <Card title={t('of.general')}>
        <Field label={t('obj.f.name')} error={error}>{text('name', { placeholder: d.kind === 'database' ? suggestDbName(d) : undefined })}</Field>
        <Field label={t('obj.colony')}>
          <select className="select" value={d.colony_id} onChange={(e) => setD((x) => ({ ...x, colony_id: e.target.value, members: [] }))}>
            <option value="">{t('obj.noColony')}</option>{colonies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        {d.kind === 'http' && !showKind && httpFiles}
      </Card>

      {d.kind === 'http' ? (<>
        {showKind && <Card title={t('of.files')}>{httpFiles}</Card>}
        {showKind && <Card title={t('of.vars')} wide><VarsEditor value={d.variables} onChange={(v) => set('variables', v)} fileEnvs={fileEnvs} fileVars={scan?.fileVars} used={scan?.used} fileDefined={scan?.fileDefined} setBy={scan?.setBy} /></Card>}
      </>) : d.kind === 'database' ? (<DatabaseCards d={d} set={set} setD={setD} objectId={objectId} creating={showKind} />) : d.kind === 'cluster' ? (
        <Card title={t('of.members')} hint={t('obj.f.members.hint')}>
          {(() => {
            const pool = objects.filter((o) => (o.kind === 'server' || o.kind === 'docker') && (o.colony_id ?? '') === d.colony_id);
            if (!pool.length) return <p className="muted small" style={{ margin: 0 }}>{t('obj.f.members.none')}</p>;
            const toggle = (id: string) => set('members', d.members.includes(id) ? d.members.filter((x) => x !== id) : [...d.members, id]);
            return (<div className="omembers">{pool.map((o) => { const { icon: Icon, color } = KIND[o.kind]; const at = d.members.indexOf(o.id); return (
              <label key={o.id} className="omember"><input type="checkbox" checked={at >= 0} onChange={() => toggle(o.id)} /><Icon size={15} style={{ color }} /><span className="nm">{o.name}</span>{at >= 0 && <span className="ord">{at + 1}</span>}</label>); })}</div>);
          })()}
        </Card>
      ) : d.kind === 'server' ? (<>
        <Card title={t('of.run')}>
          <FolderPicker value={d.cwd} onChange={(v) => set('cwd', v)} label={t('obj.f.folder')} hint={t('obj.f.folder.hint')} />
          <Field label={t('obj.f.start')} hint={t('obj.f.start.hint')}>{text('start', { placeholder: 'npm run dev', mono: true })}</Field>
          <Field label={t('obj.f.stop')} hint={t('obj.f.stop.hint')}>{text('stop', { mono: true })}</Field>
          <Field label={t('obj.f.port')} hint={t('obj.f.port.hint')}>{text('port', { placeholder: '3000' })}</Field>
        </Card>
        <Card title={t('of.env')}><Field label={t('obj.f.env')} hint={t('obj.f.env.hint')}><textarea className="textarea mono" rows={5} value={d.env} onChange={(e) => set('env', e.target.value)} /></Field></Card>
        <Card title={t('obj.sup.title')} hint={t('obj.sup.note')}>
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
          <div className="of-grid2">
            <Field label={t('obj.sup.stopTimeout')} hint={t('obj.sup.stopTimeout.hint')}>{text('stopTimeout', { placeholder: '8' })}</Field>
            <Field label={t('obj.sup.logMax')} hint={t('obj.sup.logMax.hint')}>{text('logMax', { placeholder: '5' })}</Field>
          </div>
        </Card>
      </>) : (<>
        <Card title={t('obj.f.mode')}>
          <Segmented value={d.mode} onChange={(v) => set('mode', v)} options={[...(showKind ? [{ id: 'template' as const, label: t('obj.mode.template') }] : []), { id: 'container', label: t('obj.mode.container') }, { id: 'compose', label: t('obj.mode.compose') }, { id: 'existing', label: t('obj.mode.existing') }]} />
        </Card>
        {d.mode === 'template' && (
          <Card title={t('obj.mode.template')} hint={t('tpl.hint')}>
            <TemplatePicker template={d.template} values={d.tplValues}
              onPick={(x) => setD((p) => ({ ...p, template: x.id, tplValues: Object.fromEntries(x.fields.map((f) => [f.key, f.default])), name: p.name.trim() ? p.name : x.name }))}
              onValue={(k, v) => setD((p) => ({ ...p, tplValues: { ...p.tplValues, [k]: v } }))} />
          </Card>
        )}
        {d.mode === 'container' && (<>
          <Card title={t('of.image')}>
            <Field label={t('obj.f.image')}>
              <div className="row gap-s"><div className="grow"><Suggest value={d.image} onChange={(v) => set('image', v)} mono placeholder={t('dk.pickImage')} ariaLabel={t('obj.f.image')}
                options={(docker.images ?? []).map((i) => ({ value: i.ref, hint: `${i.size}${i.created ? ` · ${i.created}` : ''}` }))} /></div>{refresh}</div>
              {dockerNote}
            </Field>
            <Field label={t('obj.f.ports')} hint={t('obj.f.ports.hint')}><textarea className="textarea mono" rows={2} value={d.ports} onChange={(e) => set('ports', e.target.value)} placeholder="8080:80" /></Field>
            <Field label={t('obj.f.volumes')} hint={t('obj.f.volumes.hint')}>
              <textarea className="textarea mono" rows={2} value={d.volumes} onChange={(e) => set('volumes', e.target.value)} />
              <PathPicker bare value="" buttonLabel={t('obj.f.volumes.add')} onChange={(v) => set('volumes', `${d.volumes.trimEnd()}${d.volumes.trim() ? '\n' : ''}${v}:/data`)} />
            </Field>
          </Card>
          <Card title={t('of.env')}>
            <Field label={t('obj.f.env')} hint={t('obj.f.env.hint')}><textarea className="textarea mono" rows={4} value={d.env} onChange={(e) => set('env', e.target.value)} /></Field>
            <Field label={t('obj.f.restart')}>
              <select className="select" value={d.dockerRestart} onChange={(e) => set('dockerRestart', e.target.value)}>{['no', 'always', 'unless-stopped', 'on-failure'].map((r) => <option key={r} value={r}>{r}</option>)}</select>
            </Field>
            <Field label={t('obj.f.command')}>{text('command', { mono: true })}</Field>
          </Card>
          <Card title={t('of.limits')} hint={t('obj.dk.limits.hint')}>
            <div className="of-grid2">
              <Field label={t('obj.dk.memory')}>{text('memory', { placeholder: '512m' })}</Field>
              <Field label={t('obj.dk.cpus')}>{text('cpus', { placeholder: '1.5' })}</Field>
              <Field label={t('obj.dk.network')}>{text('network', { placeholder: 'bridge' })}</Field>
              <Field label={t('obj.sup.stopTimeout')}>{text('stopTimeout', { placeholder: '10' })}</Field>
              <Field label={t('obj.sup.logMax')}>{text('logMax', { placeholder: '10' })}</Field>
            </div>
          </Card>
        </>)}
        {d.mode === 'compose' && (
          <Card title={t('obj.mode.compose')}>
            <PathPicker mode="file" exts={['yml', 'yaml']} value={d.file} onChange={(v) => set('file', v)} label={t('obj.f.file')} hint={t('obj.f.file.hint')} placeholder="/home/you/app/docker-compose.yml" />
            <ServicePicker file={d.file} project={d.project} services={d.services} onServices={(v) => set('services', v)} onProject={(v) => set('project', v)} />
            <Field label={t('obj.sup.stopTimeout')} hint={t('obj.sup.stopTimeout.hint')}>{text('stopTimeout', { placeholder: '10' })}</Field>
          </Card>
        )}
        {d.mode === 'existing' && (
          <Card title={t('obj.mode.existing')}>
            <Field label={t('obj.f.container')} hint={t('obj.f.container.hint')}>
              <div className="row gap-s"><div className="grow"><Suggest value={d.container} onChange={(v) => set('container', v)} mono placeholder={t('dk.pickContainer')} ariaLabel={t('obj.f.container')}
                options={(docker.containers ?? []).map((c) => ({ value: c.name, hint: `${c.image} · ${c.state}${c.managed ? ` · ${t('dk.managed')}` : ''}` }))} /></div>{refresh}</div>
              {dockerNote}
            </Field>
            <Field label={t('obj.sup.stopTimeout')} hint={t('obj.sup.stopTimeout.hint')}>{text('stopTimeout', { placeholder: '10' })}</Field>
          </Card>
        )}
      </>)}
    </div>
  );
}

/** A draft kept in a component, with a way to tell whether it changed. */
export function useDraft(initial: () => Draft) {
  const [d, setD] = useState<Draft>(initial);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  return { d, setD, set };
}
