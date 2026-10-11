'use client';
import { useState } from 'react';
import { createHttpSource, editHttpSource } from '@/lib/httpFiles';
import { useI18n } from '@/lib/i18n/index';
import { appendRequest, parseCurl, requestBlock, type DraftRequest } from '@/lib/httpText';
import type { HttpFile } from '@/lib/types';
import { Field, Modal, Segmented } from '@/components/ui';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const NEW = '\u0000new';

/** A new request for an HTTP object: written in a form or pasted as a cURL command, into an existing file or into a new one. */
export function NewRequest({ objectId, files, defaultFile, onClose, onCreated }: { objectId: string; files: HttpFile[]; defaultFile?: string | null; onClose: () => void; onCreated: (file: string) => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'form' | 'curl'>('form');
  const [target, setTarget] = useState(defaultFile && files.some((f) => f.relFile === defaultFile) ? defaultFile : files[0]?.relFile ?? NEW);
  const [newFile, setNewFile] = useState('requests.http');
  const [r, setR] = useState<DraftRequest>({ name: '', method: 'GET', url: '{{host}}/', headers: [], body: '' });
  const [headersText, setHeadersText] = useState('');
  const [curl, setCurl] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const fromCurl = () => {
    try { const d = parseCurl(curl); setR(d); setHeadersText(d.headers.map((h) => `${h.name}: ${h.value}`).join('\n')); setMode('form'); setErr(''); }
    catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
  };
  const draft = (): DraftRequest => ({ ...r, headers: headersText.split('\n').map((l) => { const k = l.indexOf(':'); return k > 0 ? { name: l.slice(0, k).trim(), value: l.slice(k + 1).trim() } : { name: '', value: '' }; }).filter((h) => h.name) });
  const save = async () => {
    if (!r.url.trim()) { setErr(t('hw2.new.needUrl')); return; }
    setBusy(true); setErr('');
    try {
      const d = draft();
      if (target === NEW) { const name = newFile.trim(); await createHttpSource(objectId, name, `${requestBlock(d)}\n`); onCreated(name); }
      else { await editHttpSource(objectId, target, (content) => appendRequest(content, d)); onCreated(target); }
    } catch (e) { setErr(e instanceof Error ? e.message : 'error'); } finally { setBusy(false); }
  };

  return (
    <Modal title={t('hw2.new.title')} onClose={onClose}>
      <div className="stack">
        <Segmented value={mode} onChange={setMode} options={[{ id: 'form', label: t('hw2.new.form') }, { id: 'curl', label: t('hw2.new.curl') }]} />
        {mode === 'curl' ? (<>
          <Field label={t('hw2.new.curl')} hint={t('hw2.new.curlHint')}><textarea className="input mono" rows={7} value={curl} onChange={(e) => setCurl(e.target.value)} placeholder={"curl -X POST 'https://…' -H 'Content-Type: application/json' -d '{…}'"} autoFocus /></Field>
          <div className="row gap-s"><span className="grow" /><button className="btn primary" disabled={!curl.trim()} onClick={fromCurl}>{t('hw2.new.parse')}</button></div>
        </>) : (<>
          <Field label={t('hw2.new.file')}>
            <div className="row gap-s">
              <select className="select" value={target} onChange={(e) => setTarget(e.target.value)} style={{ flex: 1 }}>{files.map((f) => <option key={f.relFile} value={f.relFile}>{f.relFile}</option>)}<option value={NEW}>{t('hw2.new.newFile')}</option></select>
              {target === NEW && <input className="input mono" value={newFile} onChange={(e) => setNewFile(e.target.value)} aria-label={t('hw2.new.file')} style={{ flex: 1 }} />}
            </div>
          </Field>
          <Field label={t('obj.f.name')}><input className="input" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} placeholder="login" autoFocus /></Field>
          <div className="row gap-s"><select className="select" style={{ width: 120 }} value={r.method} onChange={(e) => setR({ ...r, method: e.target.value })} aria-label="Method">{METHODS.map((m) => <option key={m}>{m}</option>)}</select>
            <input className="input mono" style={{ flex: 1 }} value={r.url} onChange={(e) => setR({ ...r, url: e.target.value })} placeholder="{{host}}/path" aria-label="URL" /></div>
          <Field label={t('http.headers')} hint={t('hw2.new.headersHint')}><textarea className="input mono" rows={3} value={headersText} onChange={(e) => setHeadersText(e.target.value)} placeholder="Content-Type: application/json" /></Field>
          <Field label={t('http.requestBody')}><textarea className="input mono" rows={4} value={r.body} onChange={(e) => setR({ ...r, body: e.target.value })} /></Field>
          <div className="row gap-s"><button className="btn ghost" onClick={() => setMode('curl')}>{t('hw2.new.curl')}</button><span className="grow" /><button className="btn" onClick={onClose}>{t('hw2.cancel')}</button><button className="btn primary" disabled={busy} onClick={() => void save()}>{t('hw2.new.add')}</button></div>
        </>)}
        {err && <p className="gx-note err" style={{ margin: 0 }}>{err}</p>}
      </div>
    </Modal>
  );
}
