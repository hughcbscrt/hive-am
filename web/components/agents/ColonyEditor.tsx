'use client';
import { useMemo, useState } from 'react';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { Check, Trash2 } from 'lucide-react';
import { Drawer, Field, FolderPicker, Modal, PermissionField, SkillPicker, useToast } from '@/components/ui';
import { useHive } from '@/lib/store';
import { api } from '@/lib/api';
import { permissionLabel, shortPath } from '@/lib/meta';
import { useI18n } from '@/lib/i18n/index';
import type { Colony, InheritField, InheritFlags, Permission, SkillLoad } from '@/lib/types';

export const COLONY_COLORS = ['#2f8f5b', '#d4663f', '#2f5bea', '#7a4de0', '#c0399a', '#0f8f9e', '#9a7400', '#c2412d'];

interface Draft { name: string; color: string; cwd: string; permission: Permission; system_prompt: string; skill_ids: string[]; skill_loads: Record<string, SkillLoad>; agent_ids: string[]; inherit: InheritFlags }

const FIELD_IDS: InheritField[] = ['cwd', 'permission', 'skills', 'prompt'];

export function ColonyEditor({ colony, onClose }: { colony?: Colony; onClose: () => void }) {
  const { t } = useI18n();
  const { agents, skills, colonies, refresh } = useHive();
  const toast = useToast();
  const [d, setD] = useState<Draft>(() => colony ? {
    name: colony.name, color: colony.color, cwd: colony.cwd, permission: colony.permission, system_prompt: colony.system_prompt,
    skill_ids: colony.skill_ids, skill_loads: colony.skill_loads, agent_ids: colony.agent_ids, inherit: colony.inherit,
  } : {
    name: '', color: COLONY_COLORS[colonies.length % COLONY_COLORS.length], cwd: '', permission: 'acceptEdits', system_prompt: '', skill_ids: [], skill_loads: {}, agent_ids: [],
    inherit: { cwd: true, permission: true, skills: true, prompt: true },
  });
  const [err, setErr] = useState('');
  const [asking, setAsking] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const requestSave = () => {
    if (!d.name.trim()) { setErr(t('colony.err.name')); return; }
    if (colonies.some((c) => c.id !== colony?.id && c.name.toLowerCase() === d.name.trim().toLowerCase())) { setErr(t('colony.err.nameTaken')); return; }
    if (!/^#[0-9a-f]{6}$/i.test(d.color)) { setErr(t('colony.err.color')); return; }
    setErr(''); setAsking(true);
  };

  const save = async (inherit: InheritFlags) => {
    setBusy(true);
    try {
      const body = { ...d, name: d.name.trim(), color: d.color.toLowerCase(), inherit };
      if (colony) await api.patch(`/colonies/${colony.id}`, body); else await api.post('/colonies', body);
      await refresh(['agents', 'colonies']);
      toast(colony ? t('colony.saved') : t('colony.created')); onClose();
    } catch (e) { setAsking(false); setErr(e instanceof Error ? e.message : t('edit.saveFailed')); setBusy(false); }
  };

  return (
    <>
      <Drawer title={colony ? t('colony.editTitle', { name: colony.name }) : t('colony.newTitle')} subtitle={t('colony.subtitle')} onClose={onClose}
        footer={<>{colony && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => setConfirmDel(true)}><Trash2 size={15} />{t('common.delete')}</button>}<button className="btn ghost" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" onClick={requestSave}>{colony ? t('colony.save') : t('colony.create')}</button></>}>
        <Field label={t('form.name')} error={err}><input className="input" value={d.name} onChange={(e) => set('name', e.target.value)} placeholder={t('colony.name.placeholder')} autoFocus /></Field>
        <Field label={t('colony.color')}>
          <div className="swatches">
            {COLONY_COLORS.map((c) => <button key={c} type="button" className="swatch" style={{ '--c': c } as any} aria-pressed={d.color.toLowerCase() === c} aria-label={t('colony.colorOption', { color: c })} onClick={() => set('color', c)} />)}
            <label className={`swatch custom ${COLONY_COLORS.includes(d.color.toLowerCase()) ? '' : 'on'}`} style={{ '--c': /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : 'transparent' } as any} title={t('colony.colorCustom')}>
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(d.color) ? d.color : '#2f8f5b'} onChange={(e) => set('color', e.target.value)} aria-label={t('colony.colorCustom')} />
            </label>
            <input className="input hex-input mono" value={d.color} maxLength={7} spellCheck={false} aria-label={t('colony.colorHex')} placeholder="#2f8f5b"
              onChange={(e) => { const v = e.target.value.trim(); set('color', v.startsWith('#') || !v ? v : `#${v}`); }} />
          </div>
        </Field>
        <FolderPicker value={d.cwd} onChange={(v) => set('cwd', v)} />
        <PermissionField value={d.permission} onChange={(v) => set('permission', v)} />
        <Field label={t('inherit.context')} hint={t('colony.context.hint')}>
          <MarkdownEditor value={d.system_prompt} onChange={(v) => set('system_prompt', v)} placeholder={t('colony.context.placeholder')} defaultView="write" minHeight={160} />
        </Field>
        <Field label={t('form.skills')}><SkillPicker skills={skills} value={d.skill_ids} loads={d.skill_loads} onChange={(ids, loads) => setD({ ...d, skill_ids: ids, skill_loads: loads })} /></Field>
        <Field label={t('colony.members')} hint={t('colony.members.hint')}>
          {agents.length === 0 ? <p className="hint">{t('colony.members.empty')}</p> : (
            <div className="skillpick">
              {agents.map((a) => {
                const on = d.agent_ids.includes(a.id); const other = a.colony_id && a.colony_id !== colony?.id ? colonies.find((c) => c.id === a.colony_id) : null;
                return (
                  <button key={a.id} type="button" className="skillrow" aria-pressed={on} onClick={() => set('agent_ids', on ? d.agent_ids.filter((x) => x !== a.id) : [...d.agent_ids, a.id])}>
                    <span className="check">{on && <Check size={13} strokeWidth={3} />}</span>
                    <span><b style={{ fontWeight: 600 }}>{a.name}</b><span className="hint" style={{ display: 'block' }}>{other ? t('colony.currentlyIn', { name: other.name }) : a.description || t(`role.${a.role}`)}</span></span>
                  </button>
                );
              })}
            </div>
          )}
        </Field>
      </Drawer>

      {asking && (
        <InheritAsk draft={d} colony={colony} members={agents.filter((a) => d.agent_ids.includes(a.id))} busy={busy} onBack={() => setAsking(false)} onConfirm={save} />
      )}
      {confirmDel && colony && (
        <Modal title={t('colony.deleteTitle', { name: colony.name })} onClose={() => setConfirmDel(false)}>
          <p style={{ margin: 0 }} className="muted">{t('colony.deleteBody', { count: colony.agent_ids.length })}</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn ghost" onClick={() => setConfirmDel(false)}>{t('colony.keep')}</button>
            <button className="btn danger" onClick={async () => { await api.del(`/colonies/${colony.id}`); await refresh(['agents', 'colonies']); toast(t('colony.deleted')); onClose(); }}>{t('colony.delete')}</button></div>
        </Modal>
      )}
    </>
  );
}

/** Asked on every save: what do this colony’s agents follow by default? */
function InheritAsk({ draft, colony, members, busy, onBack, onConfirm }: { draft: Draft; colony?: Colony; members: { id: string; name: string; overrides: InheritField[]; colony_id: string | null; effective: { cwd: string } }[]; busy: boolean; onBack: () => void; onConfirm: (f: InheritFlags) => void }) {
  const { t } = useI18n();
  const hasValue: Record<InheritField, boolean> = { cwd: !!draft.cwd, permission: true, skills: draft.skill_ids.length > 0, prompt: !!draft.system_prompt.trim() };
  const [flags, setFlags] = useState<InheritFlags>(() => ({
    cwd: (colony ? colony.inherit.cwd : true) && hasValue.cwd, permission: colony ? colony.inherit.permission : true,
    skills: (colony ? colony.inherit.skills : true) && hasValue.skills, prompt: (colony ? colony.inherit.prompt : true) && hasValue.prompt,
  }));
  const folderChanges = useMemo(() => flags.cwd && draft.cwd && members.filter((m) => !m.overrides.includes('cwd') && m.effective.cwd !== draft.cwd).length, [flags.cwd, draft.cwd, members]);
  return (
    <Modal title={t('inheritAsk.title')} onClose={onBack}>
      <p style={{ margin: 0 }} className="muted small">{t('inheritAsk.intro')}</p>
      <div className="col" style={{ gap: 8 }}>
        {FIELD_IDS.map((id) => (
          <label key={id} className={`checkrow ${hasValue[id] ? '' : 'off'}`}>
            <input type="checkbox" disabled={!hasValue[id]} checked={flags[id]} onChange={(e) => setFlags((f) => ({ ...f, [id]: e.target.checked }))} />
            <span><b>{t(`inheritAsk.field.${id}`)}{id === 'cwd' && draft.cwd ? <span className="muted mono" style={{ fontWeight: 400 }}> · {shortPath(draft.cwd)}</span> : null}{id === 'permission' ? <span className="muted" style={{ fontWeight: 400 }}> · {permissionLabel(draft.permission)}</span> : null}</b>
              <span className="hint">{hasValue[id] ? t(`inheritAsk.hint.${id}`) : t(`inheritAsk.empty.${id}`)}</span></span>
          </label>
        ))}
      </div>
      {folderChanges ? <div className="banner honey small">{t('inheritAsk.folderMoves', { count: Number(folderChanges) })}</div> : null}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onBack}>{t('common.back')}</button>
        <button className="btn primary" disabled={busy} onClick={() => onConfirm(flags)}>{busy ? t('common.saving') : colony ? t('colony.save') : t('colony.create')}</button>
      </div>
    </Modal>
  );
}
