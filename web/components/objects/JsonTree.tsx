'use client';
import { useState } from 'react';
import { ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { useI18n } from '@/lib/i18n/index';

/**
 * A JSON answer as a tree you can fold. Every value has a button that copies a reference to it for another request
 * (`{{login.response.body.$.items[0].id}}`) when the request has a name (`refBase`), or the value itself when it does not.
 */
export function JsonTree({ value, refBase }: { value: unknown; refBase?: string }) {
  return <div className="jt mono"><Node k={null} v={value} path="$" refBase={refBase} depth={0} /></div>;
}

const short = (s: string) => (s.length > 160 ? `${s.slice(0, 160)}…` : s);
function Node({ k, v, path, refBase, depth }: { k: string | number | null; v: unknown; path: string; refBase?: string; depth: number }) {
  const { t } = useI18n();
  const isObj = v !== null && typeof v === 'object';
  const [open, setOpen] = useState(depth < 2);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const text = refBase ? `{{${refBase}.${path}}}` : typeof v === 'string' ? v : JSON.stringify(v);
    void navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200);
  };
  const label = k === null ? null : <span className="jt-k">{typeof k === 'number' ? k : JSON.stringify(k)}<i>: </i></span>;
  const copyBtn = <button type="button" className="jt-copy" onClick={copy} title={refBase ? t('hw2.copyRef') : t('iv.copy')} aria-label={refBase ? t('hw2.copyRef') : t('iv.copy')}>{copied ? t('hw2.copied') : <Copy size={11} />}</button>;
  if (!isObj) {
    const cls = typeof v === 'string' ? 'jt-s' : typeof v === 'number' ? 'jt-n' : 'jt-b';
    return <div className="jt-row">{label}<span className={cls}>{typeof v === 'string' ? JSON.stringify(short(v)) : String(v)}</span>{copyBtn}</div>;
  }
  const entries: [string | number, unknown][] = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v as object);
  const arr = Array.isArray(v);
  return (
    <div>
      <div className="jt-row">
        <button type="button" className="jt-fold" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>
        {label}<span className="jt-p">{arr ? '[' : '{'}</span>{!open && <span className="muted"> {entries.length} {arr ? '…' : '…'} </span>}{!open && <span className="jt-p">{arr ? ']' : '}'}</span>}
        {copyBtn}
      </div>
      {open && (<>
        <div className="jt-kids">{entries.map(([ek, ev]) => <Node key={String(ek)} k={ek} v={ev} path={arr ? `${path}[${ek}]` : /^[A-Za-z_]\w*$/.test(String(ek)) ? `${path}.${ek}` : `${path}["${ek}"]`} refBase={refBase} depth={depth + 1} />)}</div>
        <div className="jt-row"><span className="jt-p">{arr ? ']' : '}'}</span></div>
      </>)}
    </div>
  );
}
