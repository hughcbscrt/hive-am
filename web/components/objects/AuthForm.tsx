'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { getRequestHeader, setRequestHeader } from '@/lib/httpText';
import { useToast } from '@/components/ui';

type Kind = 'none' | 'bearer' | 'basic' | 'apikey';
const KEY_HEADERS = ['X-Api-Key', 'Api-Key', 'X-Auth-Token'];

/** Authentication as a type (Bearer, Basic, API key), written into the request as the header it means. Values can be {{variables}}. */
export function AuthForm({ objectId, file, lines, onSaved }: { objectId: string; file: string; lines: number[]; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const line = lines[0];
  const [kind, setKind] = useState<Kind>('none');
  const [token, setToken] = useState(''); const [user, setUser] = useState(''); const [pass, setPass] = useState('');
  const [keyName, setKeyName] = useState('X-Api-Key'); const [keyValue, setKeyValue] = useState('');
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => {
    api.get<{ content: string }>(`/objects/${objectId}/http/file?file=${encodeURIComponent(file)}`).then((r) => {
      const a = getRequestHeader(r.content, line, 'Authorization');
      const key = KEY_HEADERS.find((h) => getRequestHeader(r.content, line, h) !== undefined);
      if (a && /^Bearer\s/i.test(a)) { setKind('bearer'); setToken(a.replace(/^Bearer\s+/i, '')); }
      else if (a && /^Basic\s/i.test(a)) { const m = /^Basic\s+(\S+?)(?:\s+|:)(.+)$/i.exec(a); setKind('basic'); setUser(m?.[1] ?? ''); setPass(m?.[2] ?? ''); }
      else if (key) { setKind('apikey'); setKeyName(key); setKeyValue(getRequestHeader(r.content, line, key) ?? ''); }
      else setKind('none');
    }).catch(() => undefined);
  }, [objectId, file, line]);
  const apply = async () => {
    setBusy(true); setErr('');
    try {
      let text = (await api.get<{ content: string }>(`/objects/${objectId}/http/file?file=${encodeURIComponent(file)}`)).content;
      // from the last request to the first, so the lines of the next ones do not move
      for (const ln of (all ? [...lines] : [line]).sort((a, b) => b - a)) {
        for (const h of ['Authorization', ...KEY_HEADERS]) text = setRequestHeader(text, ln, h, null);
        if (kind === 'bearer') text = setRequestHeader(text, ln, 'Authorization', `Bearer ${token}`);
        else if (kind === 'basic') text = setRequestHeader(text, ln, 'Authorization', `Basic ${user} ${pass}`);
        else if (kind === 'apikey') text = setRequestHeader(text, ln, keyName.trim() || 'X-Api-Key', keyValue);
      }
      await api.put(`/objects/${objectId}/http/file`, { file, content: text });
      toast(t('hw2.saved')); onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="hr-pre" style={{ maxWidth: 560 }}>
      <p className="muted small" style={{ marginTop: 0 }}>{t('hw2.auth.hint')}</p>
      <div className="stack" style={{ gap: 10 }}>
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label={t('hw2.auth.type')}>
          <option value="none">{t('hw2.auth.none')}</option><option value="bearer">Bearer token</option><option value="basic">Basic</option><option value="apikey">API key</option></select>
        {kind === 'bearer' && <input className="input mono" value={token} placeholder="{{token}}" onChange={(e) => setToken(e.target.value)} aria-label="Token" />}
        {kind === 'basic' && <div className="row gap-s"><input className="input mono" style={{ flex: 1 }} value={user} placeholder="{{user}}" onChange={(e) => setUser(e.target.value)} aria-label={t('hw2.auth.user')} /><input className="input mono" style={{ flex: 1 }} value={pass} placeholder="{{passwd}}" onChange={(e) => setPass(e.target.value)} aria-label={t('hw2.auth.pass')} /></div>}
        {kind === 'apikey' && <div className="row gap-s"><input className="input mono" style={{ flex: 1 }} value={keyName} onChange={(e) => setKeyName(e.target.value)} aria-label={t('hw2.auth.header')} /><input className="input mono" style={{ flex: 2 }} value={keyValue} placeholder="{{apiKey}}" onChange={(e) => setKeyValue(e.target.value)} aria-label={t('hw.session.value')} /></div>}
        {lines.length > 1 && <label className="row gap-s small"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />{t('hw2.auth.all', { count: lines.length })}</label>}
        <div className="row gap-s"><button className="btn primary" disabled={busy} onClick={() => void apply()}>{t('hw2.auth.apply')}</button></div>
        {err && <p className="gx-note err" style={{ margin: 0 }}>{err}</p>}
      </div>
    </div>
  );
}
