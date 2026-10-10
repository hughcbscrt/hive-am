'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';

const FORMATS = [['curl', 'cURL'], ['wget', 'wget'], ['httpie', 'HTTPie'], ['powershell', 'PowerShell'], ['fetch', 'JavaScript (fetch)'], ['axios', 'Node (axios)'], ['python', 'Python (requests)'], ['go', 'Go'], ['php', 'PHP (cURL)'], ['java', 'Java (HttpClient)'], ['csharp', 'C# (HttpClient)'], ['ruby', 'Ruby (net/http)'], ['rust', 'Rust (reqwest)'], ['http', 'HTTP']] as const;

/** "Copy as…": the request, with the values in effect now, as cURL, fetch, Python, Go, Java…. */
export function CopyAs({ objectId, file, index, env }: { objectId: string; file: string; index: number; env: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [redact, setRedact] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const copy = async (format: string) => {
    setNote('');
    try {
      const r = await api.get<{ text: string; unresolved: string[] }>(`/objects/${objectId}/http/export?file=${encodeURIComponent(file)}&index=${index}&format=${format}${env ? `&env=${encodeURIComponent(env)}` : ''}${redact ? '&redact=1' : ''}`);
      await navigator.clipboard.writeText(r.text);
      setDone(format); setTimeout(() => setDone(null), 1500);
      if (r.unresolved.length) setNote(t('hw2.copyAs.unresolved', { names: r.unresolved.map((n) => `{{${n}}}`).join(', ') }));
    } catch (e) { setNote(e instanceof Error ? e.message : 'error'); }
  };
  return (
    <div className="copyas" ref={box}>
      <button className="btn sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu"><Copy size={14} />{t('hw2.copyAs')}<ChevronDown size={13} /></button>
      {open && (
        <div className="copyas-menu" role="menu">
          <div className="copyas-list">{FORMATS.map(([id, label]) => <button key={id} role="menuitem" className="copyas-item" onClick={() => void copy(id)}>{label}{done === id && <Check size={14} />}</button>)}</div>
          <label className="copyas-opt small"><input type="checkbox" checked={redact} onChange={(e) => setRedact(e.target.checked)} />{t('hw2.copyAs.redact')}</label>
          {note && <p className="muted small copyas-note">{note}</p>}
        </div>)}
    </div>
  );
}
