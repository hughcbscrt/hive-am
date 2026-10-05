'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Check, ChevronLeft, Folder, X } from 'lucide-react';
import { api } from '@/lib/api';
import { PROVIDERS, initials } from '@/lib/meta';
import type { Agent, ModelInfo, Permission, Provider, ProviderInfo, Skill } from '@/lib/types';
import { PERMISSIONS } from '@/lib/meta';

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
  const map = { idle: ['Idle', ''], running: ['Working', 'run'], error: ['Needs attention', 'err'] } as const;
  const [t, c] = map[status];
  return <span className="chip"><i className={`dot ${c}`} />{t}</span>;
}
export function RoleChip({ role }: { role: Agent['role'] }) {
  return role === 'orchestrator' ? <span className="chip honey">Orchestrator</span> : <span className="chip">Worker</span>;
}

/* ---------- containers ---------- */
export function Drawer({ title, subtitle, onClose, children, footer }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal aria-label={title}>
        <header>
          <div className="grow"><h2>{title}</h2>{subtitle && <p className="muted small" style={{ margin: '4px 0 0' }}>{subtitle}</p>}</div>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
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
  return (
    <div className="pcards">
      {(Object.keys(PROVIDERS) as Provider[]).map((p) => {
        const info = providers.find((x) => x.id === p);
        return (
          <button key={p} type="button" className="pcard" aria-pressed={value === p} style={{ '--c': PROVIDERS[p].color } as any} onClick={() => onChange(p)}>
            <b>{PROVIDERS[p].label}</b>
            <span>{PROVIDERS[p].blurb}</span>
            {info && <span className="tag" style={{ color: info.installed ? 'var(--ok)' : 'var(--err)' }}>{info.installed ? '● installed' : '● not found'}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function ModelField({ provider, value, onChange }: { provider: Provider; value: string; onChange: (v: string) => void }) {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  useEffect(() => { setModels(null); api.get<ModelInfo[]>(`/providers/${provider}/models`).then(setModels).catch(() => setModels([])); }, [provider]);
  const id = `models-${provider}`;
  return (
    <Field label="Model" hint={models === null ? 'Loading the models this CLI offers…' : models.length ? 'Pick one, or type any model id. Leave empty to use the CLI’s default.' : 'Could not list models. Type a model id, or leave empty for the CLI’s default.'}>
      <input className="input" list={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="CLI default" spellCheck={false} />
      <datalist id={id}>{models?.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
    </Field>
  );
}

export function PermissionField({ value, onChange }: { value: Permission; onChange: (v: Permission) => void }) {
  return (
    <Field label="What can it do?" hint={PERMISSIONS.find((p) => p.id === value)?.hint}>
      <Segmented value={value} onChange={onChange} options={PERMISSIONS.map((p) => ({ id: p.id, label: p.label }))} />
    </Field>
  );
}

export function SkillPicker({ skills, value, onChange }: { skills: Skill[]; value: string[]; onChange: (v: string[]) => void }) {
  if (!skills.length) return <p className="hint">No skills yet. Create some in the Skills library, then attach them here.</p>;
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
  const [open, setOpen] = useState(false);
  const [dir, setDir] = useState<{ path: string; parent: string | null; dirs: { name: string; path: string }[] } | null>(null);
  const load = useCallback((p?: string) => api.get<typeof dir>(`/fs/dirs${p ? `?path=${encodeURIComponent(p)}` : ''}`).then(setDir).catch(() => undefined), []);
  useEffect(() => { if (open) void load(value || undefined); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Field label="Working folder" hint="The agent runs here, and each folder keeps its own native sessions." error={error}>
      <div className="row gap-s">
        <input className="input mono" value={value} onChange={(e) => onChange(e.target.value)} placeholder="/home/you/project" spellCheck={false} />
        <button type="button" className="btn" onClick={() => setOpen((o) => !o)}><Folder size={16} />Browse</button>
      </div>
      {open && dir && (
        <div className="picker">
          <div className="path">
            <button type="button" className="btn ghost icon sm" disabled={!dir.parent} onClick={() => dir.parent && load(dir.parent)} aria-label="Up one folder"><ChevronLeft size={14} /></button>
            <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{dir.path}</span>
            <button type="button" className="btn sm primary" onClick={() => { onChange(dir.path); setOpen(false); }}>Use this folder</button>
          </div>
          <ul>{dir.dirs.length ? dir.dirs.map((d) => <li key={d.path}><button type="button" onClick={() => load(d.path)}><Folder size={15} className="muted" />{d.name}</button></li>) : <li className="hint" style={{ padding: 10 }}>No subfolders here.</li>}</ul>
        </div>
      )}
    </Field>
  );
}
