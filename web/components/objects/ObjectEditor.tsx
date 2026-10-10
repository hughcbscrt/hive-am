'use client';
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { useHive } from '@/lib/store';
import type { BossConfig, DockerConfig, HttpConfig, ObjectKind, ObjectView, ServerConfig } from '@/lib/types';
import { Drawer, Field, FolderPicker, Modal, PathPicker, Segmented, useToast } from '@/components/ui';
import { KIND, envToText, lines, textToEnv } from './meta';

type Mode = NonNullable<DockerConfig['mode']>;
interface Draft {
  name: string; colony_id: string; kind: ObjectKind;
  cwd: string; start: string; stop: string; port: string; env: string;
  folder: string; defEnv: string; members: string[];
  mode: Mode; image: string; ports: string; volumes: string; restart: string; command: string; file: string; project: string; services: string; container: string;
}

const fromObject = (o?: ObjectView, colony?: string): Draft => {
  const s = (o?.kind === 'server' ? o.config : {}) as Partial<ServerConfig>;
  const d = (o?.kind === 'docker' ? o.config : {}) as Partial<DockerConfig>;
  const h = (o?.kind === 'http' ? o.config : {}) as Partial<HttpConfig>;
  const bo = (o?.kind === 'boss' ? o.config : {}) as Partial<BossConfig>;
  return {
    name: o?.name ?? '', colony_id: o?.colony_id ?? colony ?? '', kind: o?.kind ?? 'server',
    cwd: s.cwd ?? '', start: s.start ?? '', stop: s.stop ?? '', port: s.port ? String(s.port) : '', env: envToText(o?.kind === 'server' ? s.env : d.env),
    folder: h.folder ?? '', defEnv: h.env ?? '', members: bo.members ?? [],
    mode: d.mode ?? 'container', image: d.image ?? '', ports: (d.ports ?? []).join('\n'), volumes: (d.volumes ?? []).join('\n'), restart: d.restart ?? 'no', command: d.command ?? '',
    file: d.file ?? '', project: d.project ?? '', services: (d.services ?? []).join(', '), container: d.container ?? '',
  };
};

function toConfig(d: Draft): ServerConfig | DockerConfig | HttpConfig | BossConfig {
  if (d.kind === 'http') return { folder: d.folder.trim(), env: d.defEnv.trim() || undefined };
  if (d.kind === 'boss') return { members: d.members };
  if (d.kind === 'server') return { cwd: d.cwd.trim(), start: d.start.trim(), stop: d.stop.trim() || undefined, port: d.port.trim() ? Number(d.port) : undefined, env: textToEnv(d.env) };
  if (d.mode === 'existing') return { mode: 'existing', container: d.container.trim() };
  if (d.mode === 'compose') return { mode: 'compose', file: d.file.trim(), project: d.project.trim() || undefined, services: d.services.split(',').map((x) => x.trim()).filter(Boolean) };
  return { mode: 'container', image: d.image.trim(), ports: lines(d.ports), volumes: lines(d.volumes), env: textToEnv(d.env), restart: (d.restart || 'no') as DockerConfig['restart'], command: d.command.trim() || undefined };
}

export function ObjectEditor({ object, presetColonyId, onClose, onSaved }: { object?: ObjectView; presetColonyId?: string; onClose: () => void; onSaved?: (id: string) => void }) {
  const { t } = useI18n();
  const { colonies, objects, refresh } = useHive();
  const toast = useToast();
  const [d, setD] = useState<Draft>(() => fromObject(object, presetColonyId));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const text = (k: keyof Draft, props: { placeholder?: string; mono?: boolean } = {}) => (
    <input className={`input ${props.mono ? 'mono' : ''}`} value={d[k] as string} placeholder={props.placeholder} onChange={(e) => set(k, e.target.value as never)} />
  );

  const save = async () => {
    if (!d.name.trim()) { setErr(t('obj.err.name')); return; }
    setBusy(true); setErr('');
    try {
      const body = { name: d.name.trim(), colony_id: d.colony_id || null, config: toConfig(d), ...(object ? {} : { kind: d.kind }) };
      const r = object ? await api.patch<ObjectView>(`/objects/${object.id}`, body) : await api.post<ObjectView>('/objects', body);
      await refresh(['objects']);
      toast(object ? t('obj.saved') : t('obj.created')); onSaved?.(r.id); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : t('edit.saveFailed')); setBusy(false); }
  };
  const del = async () => {
    if (!object) return;
    setBusy(true);
    try { await api.del(`/objects/${object.id}`); await refresh(['objects']); toast(t('obj.deleted')); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : ''); setConfirmDel(false); setBusy(false); }
  };

  return (
    <>
      <Drawer title={object ? t('obj.editTitle', { name: object.name }) : t('obj.newTitle')} subtitle={t('obj.subtitle')} onClose={onClose}
        footer={<>{object && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => setConfirmDel(true)}><Trash2 size={15} />{t('common.delete')}</button>}
          <button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={busy} onClick={() => void save()}>{object ? t('obj.save') : t('obj.create')}</button></>}>
        {!object && (
          <Field label={t('obj.kind.pick')}>
            <div className="okinds">
              {(['server', 'docker', 'http', 'boss'] as ObjectKind[]).map((k) => { const { icon: Icon, color } = KIND[k]; return (
                <button key={k} type="button" className="okind" aria-pressed={d.kind === k} style={{ ['--c' as never]: color }} onClick={() => set('kind', k)}>
                  <Icon size={20} /><b>{t(`obj.kind.${k}`)}</b><small>{t(`obj.kind.${k}.hint`)}</small>
                </button>); })}
            </div>
          </Field>
        )}
        <Field label={t('obj.f.name')} error={err}>{text('name')}</Field>
        <Field label={t('obj.colony')}>
          <select className="select" value={d.colony_id} onChange={(e) => setD((x) => ({ ...x, colony_id: e.target.value, members: [] }))}>
            <option value="">{t('obj.noColony')}</option>{colonies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>

        {d.kind === 'http' ? (<>
          <FolderPicker value={d.folder} onChange={(v) => set('folder', v)} label={t('obj.f.httpFolder')} hint={t('obj.f.httpFolder.hint')} />
          <Field label={t('obj.f.defaultEnv')} hint={t('obj.f.defaultEnv.hint')}>{text('defEnv', { placeholder: 'dev', mono: true })}</Field>
        </>) : d.kind === 'boss' ? (<>
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
              <select className="select" value={d.restart} onChange={(e) => set('restart', e.target.value)}>
                {['no', 'always', 'unless-stopped', 'on-failure'].map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <Field label={t('obj.f.command')}>{text('command', { mono: true })}</Field>
          </>)}
          {d.mode === 'compose' && (<>
            <PathPicker mode="file" exts={['yml', 'yaml']} value={d.file} onChange={(v) => set('file', v)} label={t('obj.f.file')} hint={t('obj.f.file.hint')} placeholder="/home/you/app/docker-compose.yml" />
            <Field label={t('obj.f.project')}>{text('project', { mono: true })}</Field>
            <Field label={t('obj.f.services')} hint={t('obj.f.services.hint')}>{text('services', { mono: true })}</Field>
          </>)}
          {d.mode === 'existing' && <Field label={t('obj.f.container')} hint={t('obj.f.container.hint')}>{text('container', { mono: true })}</Field>}
        </>)}
      </Drawer>
      {confirmDel && object && (
        <Modal title={t('obj.delete.title', { name: object.name })} onClose={() => setConfirmDel(false)}>
          <p style={{ margin: 0 }} className="muted">{object.kind === 'server' ? t('obj.delete.server') : t(`obj.delete.${(object.config as DockerConfig).mode}`)}</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn ghost" onClick={() => setConfirmDel(false)}>{t('common.cancel')}</button><button className="btn danger" disabled={busy} onClick={() => void del()}>{t('obj.delete')}</button></div>
        </Modal>
      )}
    </>
  );
}
