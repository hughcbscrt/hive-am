'use client';
import { createContext, useCallback, useContext, useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Check, ChevronLeft, Folder, Maximize2, Minimize2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { PROVIDERS, initials, permissions, providerBlurb } from '@/lib/meta';
import { useI18n } from '@/lib/i18n';
import type { Agent, ModelInfo, Permission, Provider, ProviderInfo, Skill } from '@/lib/types';

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
export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[] }) {
  return <div className="seg" role="group">{options.map((o) => <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>{o.label}</button>)}</div>;
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

export function PermissionField({ value, onChange }: { value: Permission; onChange: (v: Permission) => void }) {
  const { t } = useI18n();
  const list = permissions();
  return (
    <Field label={t('permission.title')} hint={list.find((p) => p.id === value)?.hint}>
      <Segmented value={value} onChange={onChange} options={list.map((p) => ({ id: p.id, label: p.label }))} />
    </Field>
  );
}

export function SkillPicker({ skills, value, onChange }: { skills: Skill[]; value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useI18n();
  if (!skills.length) return <p className="hint">{t('skillPicker.empty')}</p>;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="skillpick">
      {skills.map((s) => (
        <button key={s.id} type="button" className="skillrow" aria-pressed={value.includes(s.id)} onClick={() => toggle(s.id)}>
          <span className="check">{value.includes(s.id) && <Check size={13} strokeWidth={3} />}</span>
          <span><b style={{ fontWeight: 600 }}>{s.name}</b>{s.description && <span className="hint" style={{ display: 'block' }}>{s.description}</span>}</span>
        </button>
      ))}
    </div>
  );
}

export function FolderPicker({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [dir, setDir] = useState<{ path: string; parent: string | null; dirs: { name: string; path: string }[] } | null>(null);
  const load = useCallback((p?: string) => api.get<typeof dir>(`/fs/dirs${p ? `?path=${encodeURIComponent(p)}` : ''}`).then(setDir).catch(() => undefined), []);
  useEffect(() => { if (open) void load(value || undefined); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Field label={t('field.folder')} hint={t('folder.hint')} error={error}>
      <div className="row gap-s">
        <input className="input mono" value={value} onChange={(e) => onChange(e.target.value)} placeholder={t('folder.placeholder')} spellCheck={false} />
        <button type="button" className="btn" onClick={() => setOpen((o) => !o)}><Folder size={16} />{t('folder.browse')}</button>
      </div>
      {open && dir && (
        <div className="picker">
          <div className="path">
            <button type="button" className="btn ghost icon sm" disabled={!dir.parent} onClick={() => dir.parent && load(dir.parent)} aria-label={t('folder.up')}><ChevronLeft size={14} /></button>
            <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{dir.path}</span>
            <button type="button" className="btn sm primary" onClick={() => { onChange(dir.path); setOpen(false); }}>{t('folder.use')}</button>
          </div>
          <ul>{dir.dirs.length ? dir.dirs.map((d) => <li key={d.path}><button type="button" onClick={() => load(d.path)}><Folder size={15} className="muted" />{d.name}</button></li>) : <li className="hint" style={{ padding: 10 }}>{t('folder.empty')}</li>}</ul>
        </div>
      )}
    </Field>
  );
}
