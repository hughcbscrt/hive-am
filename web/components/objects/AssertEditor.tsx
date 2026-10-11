'use client';
import { useEffect, useState } from 'react';
import { Plus, Save, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n/index';
import { ASSERT_OPS, getAssertions, setAssertions, type Assertion } from '@/lib/httpText';
import { editHttpSource, readHttpSource } from '@/lib/httpFiles';
import { useToast } from '@/components/ui';
import { HelpPopover } from '@/components/HelpPopover';

const KINDS: Assertion['k'][] = ['status', 'time', 'header', 'body', 'text'];
const NO_VALUE = new Set(['exists', '2xx']);

/**
 * Checks on the answer without writing code: status, time, a header, a value of the JSON or a text. They are saved in the file as a
 * response handler (the next run reports each one), so the file stays the one source of truth.
 */
export function AssertEditor({ objectId, file, line, onSaved }: { objectId: string; file: string; line: number; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState<Assertion[]>([]);
  const [base, setBase] = useState('[]');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    readHttpSource(objectId, file).then((content) => { if (!live) return; const a = getAssertions(content, line); setRows(a); setBase(JSON.stringify(a)); }).catch(() => undefined);
    return () => { live = false; };
  }, [objectId, file, line]);
  const dirty = JSON.stringify(rows) !== base;
  const set = (i: number, patch: Partial<Assertion>) => setRows((r) => r.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const clean = rows.filter((a) => a.k === 'status' || a.k === 'time' || (a.k === 'header' || a.k === 'body' ? !!a.name?.trim() : true));
      await editHttpSource(objectId, file, (content) => setAssertions(content, line, clean));
      setRows(clean); setBase(JSON.stringify(clean)); toast(t('hw2.saved')); onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="ae">
      <div className="row gap-s"><b>{t('hw2.assert.title')}</b><HelpPopover size="sm" label={t('common.help')} title={t('hw2.help.how')}>{t('hw2.assert.hint')}</HelpPopover><span className="grow" />
        <button className="btn sm" onClick={() => setRows((r) => [...r, { k: 'status', op: '2xx' }])}><Plus size={13} />{t('hw2.assert.add')}</button>
        <button className="btn primary sm" disabled={!dirty || busy} onClick={() => void save()}><Save size={13} />{t('hw2.assert.save')}</button></div>
      <div style={{ height: 8 }} />
      {rows.map((a, i) => (
        <div key={i} className="ae-row">
          <select className="select" value={a.k} onChange={(e) => { const k = e.target.value as Assertion['k']; set(i, { k, op: ASSERT_OPS[k][0], name: undefined, v: '' }); }} aria-label={t('hw2.assert.kind')}>{KINDS.map((k) => <option key={k} value={k}>{t(`hw2.assert.k.${k}`)}</option>)}</select>
          {(a.k === 'header' || a.k === 'body') && <input className="input mono" value={a.name ?? ''} placeholder={a.k === 'header' ? 'Content-Type' : '$.data.id'} onChange={(e) => set(i, { name: e.target.value })} aria-label={t('obj.f.name')} />}
          <select className="select" value={a.op} onChange={(e) => set(i, { op: e.target.value })} aria-label={t('hw2.assert.op')}>{ASSERT_OPS[a.k].map((o) => <option key={o} value={o}>{o === 'exists' ? t('hw2.assert.exists') : o === '2xx' ? t('hw2.assert.ok') : o === 'contains' ? t('hw2.assert.contains') : o}</option>)}</select>
          {!NO_VALUE.has(a.op) && <input className="input mono" value={a.v ?? ''} placeholder={a.k === 'time' ? 'ms' : t('hw.session.value')} onChange={(e) => set(i, { v: e.target.value })} aria-label={t('hw.session.value')} />}
          <button className="btn ghost icon sm" onClick={() => setRows((r) => r.filter((_, n) => n !== i))} aria-label={t('hw2.assert.remove')}><X size={14} /></button>
        </div>))}
      {err && <p className="gx-note err">{err}</p>}
    </div>
  );
}
