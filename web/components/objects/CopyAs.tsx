'use client';
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n, type MessageKey } from '@/lib/i18n/index';
import { Menu, MenuCheck, MenuGroup, MenuItem, MenuSep } from '@/components/Menu';

const GROUPS: { key: string; formats: readonly (readonly [string, string])[] }[] = [
  { key: 'tools', formats: [['curl', 'cURL'], ['wget', 'wget'], ['httpie', 'HTTPie'], ['powershell', 'PowerShell']] },
  { key: 'langs', formats: [['fetch', 'JavaScript (fetch)'], ['axios', 'Node (axios)'], ['python', 'Python (requests)'], ['go', 'Go'], ['php', 'PHP (cURL)'], ['java', 'Java (HttpClient)'], ['csharp', 'C# (HttpClient)'], ['ruby', 'Ruby (net/http)'], ['rust', 'Rust (reqwest)']] },
  { key: 'raw', formats: [['http', 'HTTP']] },
];

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
      <MenuCheck checked={redact} onChange={setRedact} hint={t('hw2.copyAs.redact.hint')}>{t('hw2.copyAs.redact')}</MenuCheck>
      <MenuSep />
      {GROUPS.map((g) => (
        <MenuGroup key={g.key} label={t(`hw2.copyAs.g.${g.key}` as MessageKey)}>{g.formats.map(([id, label]) => <MenuItem key={id} icon={done === id ? <Check size={15} /> : undefined} onClick={() => void copy(id)}>{label}</MenuItem>)}</MenuGroup>))}
      {note && <p className="muted small menu-note">{note}</p>}
    </>)}</Menu>
  );
}
