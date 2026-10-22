'use client';
import { Children, cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronLeft, File, Folder, Loader2, Search, X } from 'lucide-react';
import { useDismiss } from '@/lib/useDismiss';
import { api } from '@/lib/api';
import { PROVIDERS, initials, permissions, providerBlurb } from '@/lib/meta';
import { useI18n } from '@/lib/i18n';
import { ALWAYS_BUDGET, estTokens, fmtTok, skillWeight } from '@/lib/tokens';
import type { Agent, ModelInfo, Permission, Provider, ProviderInfo, Skill, SkillLoad } from '@/lib/types';
import { useCombobox } from './combobox';
import { PasswordInput } from './PasswordInput';

// The primitives live in their own files; everything is imported from '@/components/ui'.
export { useToast, Toaster } from './Toast';
export { Dialog, Modal, Drawer, dialogDepth } from './Dialog';
export { ConfirmDialog } from './ConfirmDialog';
export { Tabs, TabPanel, type TabDef } from './Tabs';
export { EmptyState, Banner, SearchInput, CheckRow } from './Primitives';
export { WorkspaceHeader, type HeaderAction } from './WorkspaceHeader';
export { useCombobox } from './combobox';

/* ---------- hex avatar & badges ---------- */
export function Hex({ agent, size, color, queen, label }: { agent?: Pick<Agent, 'name' | 'provider' | 'role'>; size?: 'sm' | 'lg'; color?: string; queen?: boolean; label?: string }) {
  const q = queen ?? agent?.role === 'orchestrator';
  const c = color ?? (agent ? PROVIDERS[agent.provider].color : undefined);
  return <span className={`hex ${size ?? ''} ${q ? 'queen' : ''}`} style={c && !q ? ({ '--c': c } as any) : undefined} aria-hidden>{label ?? initials(agent?.name ?? '')}</span>;
}
export function ProviderBadge({ provider }: { provider: Provider }) {
  return <span className="pbadge" style={{ '--c': PROVIDERS[provider].color } as any}><i />{PROVIDERS[provider].short}</span>;
}
export function StatusChip({ status }: { status: Agent['status'] }) {
  const { t } = useI18n();
  const dot = { idle: '', running: 'run', error: 'err' }[status];
  return <span className="chip"><i className={`dot ${dot}`} />{t(`status.${status}`)}</span>;
}
export function RoleChip({ role }: { role: Agent['role'] }) {
  const { t } = useI18n();
  return role === 'orchestrator' ? <span className="chip honey">{t('role.orchestrator')}</span> : <span className="chip">{t('role.worker')}</span>;
}

/* ---------- containers ---------- */
/** Host controls (and the components that pass `id` on to one) a label can point at. */
const labelable = (el: ReactElement) => typeof el.type === 'string' ? ['input', 'select', 'textarea'].includes(el.type) : (el.type === PasswordInput);
/**
 * A label and its control. With a single input / select / textarea (or PasswordInput) the label is tied to it and the hint / error are its description;
 * with anything else (a segmented control, a picker, several controls) the whole field is a named group instead.
 */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  const uid = useId();
  const controlId = `${uid}-c`, labelId = `${uid}-l`, noteId = `${uid}-n`;
  const only = Children.count(children) === 1 ? Children.toArray(children)[0] : null;
  const direct = isValidElement(only) && labelable(only as ReactElement);
  const note = error || hint;
  let body = children;
  if (direct) {
    const el = only as ReactElement<Record<string, unknown>>;
    const described = [el.props['aria-describedby'] as string | undefined, note ? noteId : undefined].filter(Boolean).join(' ') || undefined;
    body = cloneElement(el, { id: (el.props.id as string | undefined) ?? controlId, 'aria-describedby': described, ...(error ? { 'aria-invalid': true } : {}) });
  }
  const forId = direct ? ((only as ReactElement<Record<string, unknown>>).props.id as string | undefined) ?? controlId : undefined;
  return (
    <div className="field" {...(direct ? {} : { role: 'group', 'aria-labelledby': labelId, 'aria-describedby': note ? noteId : undefined })}>
      <label id={labelId} htmlFor={forId}>{label}</label>
      {body}
      {error ? <span id={noteId} className="field-err">{error}</span> : hint ? <span id={noteId} className="hint">{hint}</span> : null}
    </div>
  );
}
export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string; disabled?: boolean; title?: string }[] }) {
  return <div className="seg" role="group">{options.map((o) => <button key={o.id} type="button" aria-pressed={value === o.id} disabled={o.disabled} title={o.title} onClick={() => onChange(o.id)}>{o.label}</button>)}</div>;
}

/* ---------- domain pickers ---------- */
export function ProviderPicker({ value, onChange, providers }: { value: Provider; onChange: (p: Provider) => void; providers: ProviderInfo[] }) {
  const { t } = useI18n();
  return (
    <div className="pcards">
      {(Object.keys(PROVIDERS) as Provider[]).map((p) => {
        const info = providers.find((x) => x.id === p);
        return (
          <button key={p} type="button" className="pcard" aria-pressed={value === p} style={{ '--c': PROVIDERS[p].color } as any} onClick={() => onChange(p)}>
            <b>{PROVIDERS[p].label}</b>
            <span>{providerBlurb(p)}</span>
            {info && <span className="tag" style={{ color: info.installed ? 'var(--ok)' : 'var(--err)' }}>{info.installed ? t('provider.installed') : t('provider.notFound')}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The model of an agent: a selector. It shows the one in use (or "CLI default"); opening it lists what the CLI offers, filtered as you type,
 * and a model the list does not have can still be used by typing its id.
 */
export function ModelField({ provider, value, onChange }: { provider: Provider; value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listEl = useRef<HTMLUListElement>(null);
  useEffect(() => { setModels(null); api.get<ModelInfo[]>(`/providers/${provider}/models`).then(setModels).catch(() => setModels([])); }, [provider]);
  useDismiss(open, box, () => { setOpen(false); setQ(''); });
  useEffect(() => { if (open) requestAnimationFrame(() => search.current?.focus()); }, [open]);
  useEffect(() => { setHi(0); }, [q, open]);
  useEffect(() => { listEl.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [hi]);

  const needle = q.trim().toLowerCase();
  const list = (models ?? []).filter((m) => !needle || `${m.label} ${m.id}`.toLowerCase().includes(needle));
  const typed = q.trim();
  const custom = typed && !(models ?? []).some((m) => m.id.toLowerCase() === typed.toLowerCase());
  type Opt = { id: string; label: string; hint?: string; kind?: 'default' | 'custom' };
  const opts: Opt[] = [
    ...(!needle ? [{ id: '', label: t('model.cliDefault'), hint: t('model.cliDefault.hint'), kind: 'default' as const }] : []),
    ...list.map((m) => ({ id: m.id, label: m.label || m.id, hint: m.label && m.label !== m.id ? m.id : undefined })),
    ...(custom ? [{ id: typed, label: t('model.custom', { id: typed }), kind: 'custom' as const }] : []),
  ];
  const combo = useCombobox(open, hi, opts.length);
  const choose = (o: Opt) => { onChange(o.id); setOpen(false); setQ(''); };
  const current = value ? (models ?? []).find((m) => m.id === value) : undefined;

  return (
    <Field label={t('field.model')} hint={models === null ? t('model.loading') : models.length ? t('model.pick') : t('model.none')}>
      <div className="sg mdl" ref={box}>
        <button type="button" className={`input mdl-btn ${open ? 'open' : ''}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span className="mdl-cur">{value ? <><b>{current?.label || value}</b>{current && current.label !== value && <i>{value}</i>}</> : <span className="muted">{t('model.cliDefault')}</span>}</span>
          {models === null ? <Loader2 size={14} className="spin" aria-hidden /> : <ChevronDown size={15} aria-hidden />}
        </button>
        {open && (
          <div className="sg-list mdl-pop">
            <div className="mdl-search"><Search size={14} aria-hidden /><input ref={search} value={q} placeholder={t('model.search')} aria-label={t('model.search')} autoComplete="off" spellCheck={false} {...combo.input}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(opts.length - 1, h + 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
                else if (e.key === 'Enter') { e.preventDefault(); if (opts[hi]) choose(opts[hi]); }
                else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); setQ(''); }
              }} /></div>
            <ul ref={listEl} {...combo.listProps} className="mdl-opts">
              {models === null && <li className="sg-empty">{t('model.loading')}</li>}
              {models !== null && opts.length === 0 && <li className="sg-empty">{t('model.none')}</li>}
              {opts.map((o, i) => (
                <li key={`${o.kind ?? 'm'}:${o.id}`} {...combo.optionProps(i)}>
                  <button type="button" className={`sg-opt ${i === hi ? 'hi' : ''} ${o.kind ?? ''}`} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setHi(i)} onClick={() => choose(o)}>
                    <span className="nm">{o.label}</span>{o.hint && <span className="hint">{o.hint}</span>}
                    {o.id === value && o.kind !== 'custom' && <Check size={14} className="mdl-ok" aria-hidden />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Field>
  );
}

/** The reasoning levels a provider (and, for OpenCode and Kiro, a model) takes, as the server knows them. Cursor takes none: its model id names the level. */
interface EffortInfo { options: { id: string; level?: string }[]; known: boolean }
/**
 * The agent's reasoning effort: the CLI's default, or one of the levels the chosen provider and model take (never one that would fail the turn).
 * For OpenCode they are the variants of the model, read from its catalog; when they are not known only the default is offered.
 */
export function EffortField({ provider, model, value, onChange }: { provider: Provider; model: string; value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const [info, setInfo] = useState<EffortInfo | null>(null);
  useEffect(() => {
    let dead = false; setInfo(null);
    api.get<EffortInfo>(`/providers/${provider}/efforts?model=${encodeURIComponent(model)}`).then((r) => { if (!dead) setInfo(r); }).catch(() => { if (!dead) setInfo({ options: [], known: false }); });
    return () => { dead = true; };
  }, [provider, model]);
  // A saved value the model does not take any more goes back to the default (only once what the model takes is known).
  useEffect(() => { if (info?.known && value && !info.options.some((o) => o.id === value)) onChange(''); }, [info]); // eslint-disable-line react-hooks/exhaustive-deps
  const label = (o: { id: string; level?: string }) => {
    const named = (x: string) => ((['low', 'medium', 'high', 'xhigh', 'max'] as const).includes(x as 'low') ? t(`effort.${x as 'low'}`) : x);
    return o.level && o.level !== o.id ? `${o.id} · ${named(o.level)}` : named(o.id);
  };
  // Nothing to choose for Cursor, so no field (the effect above still clears an effort left from another provider).
  if (provider === 'cursor') return null;
  const hint = info === null ? t('form.effort.loading') : !info.known ? t('form.effort.unknown') : info.options.length === 0 ? t('form.effort.none') : t('form.effort.hint');
  return (
    <Field label={t('form.effort')} hint={hint}>
      <Segmented value={value} onChange={onChange} options={[{ id: '', label: t('form.effort.default') }, ...(info?.options ?? []).map((o) => ({ id: o.id, label: label(o) }))]} />
    </Field>
  );
}

export function PermissionField({ value, onChange, locked = [] }: { value: Permission; onChange: (v: Permission) => void; locked?: Permission[] }) {
  const { t } = useI18n();
  const list = permissions();
  return (
    <Field label={t('permission.title')} hint={list.find((p) => p.id === value)?.hint}>
      <Segmented value={value} onChange={onChange} options={list.map((p) => ({ id: p.id, label: p.label, disabled: locked.includes(p.id), title: locked.includes(p.id) ? t('permission.lockedByConnection') : undefined }))} />
    </Field>
  );
}

/**
 * Skills of an agent, type or colony. The chosen ones are pills; each pill says how that skill is loaded for THIS agent
 * (always in the instructions, or read on demand) and a click flips it. To add more, search the library: the list shows
 * each match with the start of its description, so you can tell skills apart without opening them.
 */
export function SkillPicker({ skills, value, loads, onChange }: { skills: Skill[]; value: string[]; loads: Record<string, SkillLoad>; onChange: (ids: string[], loads: Record<string, SkillLoad>) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);
  const [hi, setHi] = useState(0);
  const loadOf = (s: Skill): SkillLoad => loads[s.id] ?? s.load;
  const picked = value.map((id) => skills.find((s) => s.id === id)).filter((s): s is Skill => !!s);
  const always = picked.reduce((n, s) => n + skillWeight({ ...s, load: loadOf(s) }), 0);
  const needle = q.trim().toLowerCase();
  const options = skills.filter((s) => !value.includes(s.id) && (!needle || `${s.name} ${s.description}`.toLowerCase().includes(needle)));
  const show = focus || !!needle;
  const combo = useCombobox(show, hi, options.length);
  useEffect(() => { setHi(0); }, [q]);
  const list = useRef<HTMLDivElement>(null);
  // Opening the list below the fold of a scrolling panel: bring it into view.
  useEffect(() => { if (show) list.current?.scrollIntoView({ block: 'nearest' }); }, [show, q]);
  if (!skills.length) return <p className="hint">{t('skillPicker.empty')}</p>;

  // Only the skills that are picked keep an entry, each with an explicit choice.
  const commit = (ids: string[], next: Record<string, SkillLoad>) => onChange(ids, Object.fromEntries(ids.map((id) => [id, next[id] ?? skills.find((s) => s.id === id)?.load ?? 'always'])));
  const add = (s: Skill) => { commit([...value, s.id], { ...loads, [s.id]: s.load }); setQ(''); };
  const remove = (id: string) => commit(value.filter((x) => x !== id), loads);
  const flip = (s: Skill) => commit(value, { ...loads, [s.id]: loadOf(s) === 'always' ? 'on_demand' : 'always' });
  const key = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (options[hi]) add(options[hi]); }
    else if (e.key === 'Escape') { if (show) e.stopPropagation(); setQ(''); e.currentTarget.blur(); }
    else if (e.key === 'Backspace' && !q && picked.length) remove(picked[picked.length - 1].id);
  };
  return (
    <div className="skillpick">
      {picked.length > 0 && (
        <div className="skillpills">
          {picked.map((s) => {
            const lazy = loadOf(s) === 'on_demand', tok = fmtTok(estTokens(s.content));
            return (
              <span key={s.id} className="skillpill" title={s.description || undefined}>
                {s.name}
                <button type="button" className={`skillmode${lazy ? ' lazy' : ''}`} onClick={() => flip(s)} aria-pressed={lazy}
                  title={t(lazy ? 'skillPicker.mode.lazy.hint' : 'skillPicker.mode.always.hint', { tokens: tok })}>
                  {t(lazy ? 'skillPicker.mode.lazy' : 'skillPicker.mode.always')}
                </button>
                <button type="button" onClick={() => remove(s.id)} aria-label={t('skillPicker.remove', { name: s.name })} title={t('skillPicker.remove', { name: s.name })}><X size={12} /></button>
              </span>
            );
          })}
        </div>
      )}
      {picked.length > 0 && (
        <p className={`hint${always > ALWAYS_BUDGET ? ' warn' : ''}`} style={{ margin: 0 }}>
          {t('skillPicker.weight', { always: fmtTok(always), onDemand: picked.filter((s) => loadOf(s) === 'on_demand').length })}{always > ALWAYS_BUDGET ? ` ${t('skillPicker.heavy')}` : ''}
        </p>
      )}
      <div className="search">
        <Search size={15} aria-hidden />
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} onKeyDown={key}
          placeholder={t('skillPicker.search')} aria-label={t('skillPicker.search')} {...combo.input} />
      </div>
      {show && (
        <div className="skillopts" {...combo.listProps} ref={list}>
          {options.length === 0
            ? <p className="hint" style={{ margin: 0, padding: '8px 10px' }}>{needle ? t('skillPicker.noMatch', { query: q.trim() }) : t('skillPicker.allAdded')}</p>
            : options.map((s, i) => (
              <button key={s.id} type="button" tabIndex={-1} {...combo.optionProps(i)} className={`skillopt${i === hi ? ' on' : ''}`}
                onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setHi(i)} onClick={() => add(s)}>
                <b>{s.name} <span className="skillopt-w">~{fmtTok(estTokens(s.content))} tokens</span></b>
                <span className="hint">{s.description || t('common.noDescription')}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

interface Listing { path: string; parent: string | null; dirs: { name: string; path: string }[]; files?: { name: string; path: string }[] }

/**
 * The one way to choose a folder or a file on this machine, used by every field that holds a path (an agent's or a colony's folder, the
 * folder of a server, a compose file, a volume). Type the path, or press Browse: move through the folders and press "Use this folder"
 * (or, choosing a file, press the file). `mode="file"` lists the files whose extension is in `exts`. `bare` shows only the button, for
 * adding a path to something else (a list of volumes) instead of filling a field.
 */
export function PathPicker({ value, onChange, error, label, hint, mode = 'dir', exts, bare = false, buttonLabel, placeholder }: {
  value: string; onChange: (v: string) => void; error?: string; label?: string; hint?: string;
  mode?: 'dir' | 'file'; exts?: string[]; bare?: boolean; buttonLabel?: string; placeholder?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [dir, setDir] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<{ msg: string; path?: string } | null>(null);
  const files = mode === 'file' ? (exts ?? []).join(',') : '';
  const load = useCallback((p?: string) => {
    setLoading(true); setFailed(null);
    return api.get<Listing>(`/fs/dirs?${p ? `path=${encodeURIComponent(p)}&` : ''}${files ? `files=${encodeURIComponent(files)}` : ''}`).then(setDir)
      .catch((e) => setFailed({ msg: e instanceof Error ? e.message : String(e), path: p })).finally(() => setLoading(false));
  }, [files]);
  // A file field opens in the folder of the file it already has.
  const start = mode === 'file' && value.includes('/') ? value.slice(0, value.lastIndexOf('/')) || '/' : value;
  useEffect(() => { if (open) void load(start || undefined); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (v: string) => { onChange(v); setOpen(false); };
  const status = open && ((loading && !dir) || failed) && (
    <div className="picker" aria-busy={loading}>
      {!failed
        ? <p className="hint picker-state"><Loader2 size={14} className="spin" aria-hidden />{t('folder.loading')}</p>
        : <div className="picker-state err" role="alert"><span>{t('folder.error')}{failed?.msg ? `: ${failed.msg}` : ''}</span><button type="button" className="btn sm" onClick={() => void load(failed?.path)}>{t('folder.retry')}</button></div>}
    </div>
  );
  const panel = open && !failed && dir && (
    <div className="picker">
      <div className="path">
        <button type="button" className="btn ghost icon sm" disabled={!dir.parent} onClick={() => dir.parent && load(dir.parent)} aria-label={t('folder.up')}><ChevronLeft size={14} /></button>
        <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{dir.path}</span>
        {mode === 'dir' && <button type="button" className="btn sm primary" onClick={() => pick(dir.path)}>{t('folder.use')}</button>}
      </div>
      <ul>
        {dir.dirs.map((d) => <li key={d.path}><button type="button" onClick={() => load(d.path)}><Folder size={15} className="muted" />{d.name}</button></li>)}
        {mode === 'file' && (dir.files ?? []).map((f) => <li key={f.path}><button type="button" onClick={() => pick(f.path)}><File size={15} className="muted" />{f.name}</button></li>)}
        {!dir.dirs.length && !(mode === 'file' && dir.files?.length) && <li className="hint" style={{ padding: '10px 12px' }}>{mode === 'file' ? t('folder.emptyFiles') : t('folder.empty')}</li>}
      </ul>
    </div>
  );
  if (bare) return <div><button type="button" className="btn sm" onClick={() => setOpen((o) => !o)}><Folder size={15} />{buttonLabel ?? t('folder.browse')}</button>{status}{panel}</div>;
  return (
    <Field label={label ?? t('field.folder')} hint={hint ?? t('folder.hint')} error={error}>
      <div className="row gap-s">
        <input className="input mono" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? t('folder.placeholder')} spellCheck={false} />
        <button type="button" className="btn" onClick={() => setOpen((o) => !o)}><Folder size={16} />{t('folder.browse')}</button>
      </div>
      {status}{panel}
    </Field>
  );
}

/** A folder field: the same picker, in folder mode. */
export const FolderPicker = (p: Omit<Parameters<typeof PathPicker>[0], 'mode' | 'exts' | 'bare'>) => <PathPicker {...p} mode="dir" />;
