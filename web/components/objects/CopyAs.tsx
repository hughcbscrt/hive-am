'use client';
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { Menu, MenuItem } from '@/components/Menu';

const FORMATS = [['curl', 'cURL'], ['wget', 'wget'], ['httpie', 'HTTPie'], ['powershell', 'PowerShell'], ['fetch', 'JavaScript (fetch)'], ['axios', 'Node (axios)'], ['python', 'Python (requests)'], ['go', 'Go'], ['php', 'PHP (cURL)'], ['java', 'Java (HttpClient)'], ['csharp', 'C# (HttpClient)'], ['ruby', 'Ruby (net/http)'], ['rust', 'Rust (reqwest)'], ['http', 'HTTP']] as const;

/** "Copy as…": the request, with the values in effect now, as cURL, fetch, Python, Go, Java… */
export function CopyAs({ objectId, file, index, env }: { objectId: string; file: string; index: number; env: string }) {
  const { t } = useI18n();
  const [redact, setRedact] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [note, setNote] = useState('');

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
    <Menu label={t('hw2.copyAs')} icon={<Copy size={14} />}>{() => (<>
      <div className="menu-list">{FORMATS.map(([id, label]) => <MenuItem key={id} onClick={() => void copy(id)}>{label}{done === id && <Check size={14} />}</MenuItem>)}</div>
      <label className="menu-opt small"><input type="checkbox" checked={redact} onChange={(e) => setRedact(e.target.checked)} />{t('hw2.copyAs.redact')}</label>
      {note && <p className="muted small menu-note">{note}</p>}
    </>)}</Menu>
  );
}
