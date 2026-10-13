'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

type Kind = 'ok' | 'err';
interface Item { id: number; msg: string; kind: Kind }

const ToastCtx = createContext<(msg: string, kind?: Kind) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

// Errors stay longer than confirmations, and longer messages stay longer than short ones.
const duration = (msg: string, kind: Kind) => kind === 'err' ? Math.min(15000, 7000 + msg.length * 40) : Math.min(8000, 3500 + msg.length * 30);

/** One toast. Its timer stops while the pointer is over it or focus is inside it, and picks up where it left off. */
function ToastItem({ item, onClose }: { item: Item; onClose: (id: number) => void }) {
  const { t } = useI18n();
  const [paused, setPaused] = useState(false);
  const left = useRef(duration(item.msg, item.kind));
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = setTimeout(() => onClose(item.id), left.current);
    return () => { clearTimeout(timer); left.current = Math.max(1200, left.current - (Date.now() - started)); };
  }, [paused, item.id, onClose]);
  const err = item.kind === 'err';
  return (
    <div className={`toast ${err ? 'err' : ''}`} role={err ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <span className="toast-msg">{item.msg}</span>
      <button type="button" className="toast-x" onClick={() => onClose(item.id)} aria-label={t('common.dismiss')} title={t('common.dismiss')}><X size={15} /></button>
    </div>
  );
}

export function Toaster({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const close = useCallback((id: number) => setItems((x) => x.filter((i) => i.id !== id)), []);
  const push = useCallback((msg: string, kind: Kind = 'ok') => {
    // The same message already on screen is not shown twice (e.g. a failing poll).
    setItems((x) => x.some((i) => i.msg === msg && i.kind === kind) ? x : [...x, { id: Date.now() + Math.random(), msg, kind }].slice(-5));
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" data-live>
        {items.map((i) => <ToastItem key={i.id} item={i} onClose={close} />)}
      </div>
    </ToastCtx.Provider>
  );
}
