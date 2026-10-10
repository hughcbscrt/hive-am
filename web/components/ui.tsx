'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Check, ChevronLeft, File, Folder, Maximize2, Minimize2, Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { PROVIDERS, initials, permissions, providerBlurb } from '@/lib/meta';
import { useI18n } from '@/lib/i18n';
import { ALWAYS_BUDGET, estTokens, fmtTok, skillWeight } from '@/lib/tokens';
import type { Agent, ModelInfo, Permission, Provider, ProviderInfo, Skill, SkillLoad } from '@/lib/types';

/* ---------- toasts ---------- */
const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'err') => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);
export function Toaster({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; kind: 'ok' | 'err' }[]>([]);
  const push = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'err' ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((i) => <div key={i.id} className={`toast ${i.kind === 'err' ? 'err' : ''}`}>{i.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

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
const DRAWER_MIN = 420, DRAWER_DEFAULT = 560, DRAWER_KEY = 'hive-am.drawerWidth';
const maxDrawer = () => Math.max(DRAWER_MIN, window.innerWidth - 80);
/** Side panel the user can widen: drag its left edge or use the expand button. The width is remembered. */
export function Drawer({ title, subtitle, onClose, children, footer }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const { t } = useI18n();
  const [width, setWidth] = useState(DRAWER_DEFAULT);
  useEffect(() => { try { const w = Number(localStorage.getItem(DRAWER_KEY)); if (w >= DRAWER_MIN) setWidth(Math.min(w, maxDrawer())); } catch { /* storage unavailable */ } }, []);
  const save = (w: number) => { try { localStorage.setItem(DRAWER_KEY, String(Math.round(w))); } catch { /* storage unavailable */ } };
  const wide = width > DRAWER_DEFAULT + 40;
  const toggle = () => { const w = wide ? DRAWER_DEFAULT : Math.min(maxDrawer(), 1100); setWidth(w); save(w); };
  const drag = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget; el.setPointerCapture(e.pointerId);
    let w = width;
    const move = (ev: PointerEvent) => { w = Math.min(maxDrawer(), Math.max(DRAWER_MIN, window.innerWidth - ev.clientX)); setWidth(w); };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); save(w); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  };
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal aria-label={title} style={{ width: `min(${width}px, 100vw)` }}>
        <div className="drawer-grip" onPointerDown={drag} onDoubleClick={toggle} role="separator" aria-orientation="vertical" aria-label={t('drawer.resize')} title={t('drawer.resize')} />
        <header>
          <div className="grow"><h2>{title}</h2>{subtitle && <p className="muted small" style={{ margin: '4px 0 0' }}>{subtitle}</p>}</div>
          <button className="btn ghost icon" onClick={toggle} aria-label={wide ? t('drawer.shrink') : t('drawer.expand')} title={wide ? t('drawer.shrink') : t('drawer.expand')}>{wide ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
          <button className="btn ghost icon" onClick={onClose} aria-label={t('common.close')}><X size={18} /></button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </aside>
    </>
  );
}
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (<><div className="scrim" onClick={onClose} /><div className="modal" role="dialog" aria-modal aria-label={title}><h3 style={{ fontSize: 20 }}>{title}</h3>{children}</div></>);
}
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return <div className="field"><label>{label}</label>{children}{error ? <span className="field-err">{error}</span> : hint ? <span className="hint">{hint}</span> : null}</div>;
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

export function ModelField({ provider, value, onChange }: { provider: Provider; value: string; onChange: (v: string) => void }) {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  useEffect(() => { setModels(null); api.get<ModelInfo[]>(`/providers/${provider}/models`).then(setModels).catch(() => setModels([])); }, [provider]);
  const { t } = useI18n();
  const id = `models-${provider}`;
  return (
    <Field label={t('field.model')} hint={models === null ? t('model.loading') : models.length ? t('model.pick') : t('model.none')}>
      <input className="input" list={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={t('model.cliDefault')} spellCheck={false} />
      <datalist id={id}>{models?.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
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
    else if (e.key === 'Escape') { setQ(''); e.currentTarget.blur(); }
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
          placeholder={t('skillPicker.search')} aria-label={t('skillPicker.search')} role="combobox" aria-expanded={show} aria-controls="skill-options" aria-autocomplete="list" />
      </div>
      {show && (
        <div className="skillopts" id="skill-options" role="listbox" ref={list}>
          {options.length === 0
            ? <p className="hint" style={{ margin: 0, padding: '8px 10px' }}>{needle ? t('skillPicker.noMatch', { query: q.trim() }) : t('skillPicker.allAdded')}</p>
            : options.map((s, i) => (
              <button key={s.id} type="button" role="option" aria-selected={i === hi} className={`skillopt${i === hi ? ' on' : ''}`}
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
  const files = mode === 'file' ? (exts ?? []).join(',') : '';
  const load = useCallback((p?: string) => api.get<Listing>(`/fs/dirs?${p ? `path=${encodeURIComponent(p)}&` : ''}${files ? `files=${encodeURIComponent(files)}` : ''}`).then(setDir).catch(() => undefined), [files]);
  // A file field opens in the folder of the file it already has.
  const start = mode === 'file' && value.includes('/') ? value.slice(0, value.lastIndexOf('/')) || '/' : value;
  useEffect(() => { if (open) void load(start || undefined); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (v: string) => { onChange(v); setOpen(false); };
  const panel = open && dir && (
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
  if (bare) return <div><button type="button" className="btn sm" onClick={() => setOpen((o) => !o)}><Folder size={15} />{buttonLabel ?? t('folder.browse')}</button>{panel}</div>;
  return (
    <Field label={label ?? t('field.folder')} hint={hint ?? t('folder.hint')} error={error}>
      <div className="row gap-s">
        <input className="input mono" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? t('folder.placeholder')} spellCheck={false} />
        <button type="button" className="btn" onClick={() => setOpen((o) => !o)}><Folder size={16} />{t('folder.browse')}</button>
      </div>
      {panel}
    </Field>
  );
}

/** A folder field: the same picker, in folder mode. */
export const FolderPicker = (p: Omit<Parameters<typeof PathPicker>[0], 'mode' | 'exts' | 'bare'>) => <PathPicker {...p} mode="dir" />;
