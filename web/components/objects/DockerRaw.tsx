'use client';
import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, Eye, EyeOff } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { useGitPrefs } from '@/lib/git/gitPrefs';
import { useHighlighted } from '@/lib/git/useHighlighted';
import { CodeCell } from '@/components/git/Code';
import { GitSettings } from '@/components/git/GitSettings';
import { ROW_H, VirtualLines } from '@/components/git/VirtualLines';
import { Banner } from '@/components/ui';

interface Raw { available: boolean; error?: string; text: string; masked: number }

/**
 * The whole `docker inspect` as highlighted JSON, with the code explorer's pieces (highlighting in a worker past 15 000 characters, only
 * the rows on screen in the DOM, its theme and whitespace settings). The server hides the values of secret-looking variables; Reveal asks
 * for them again in the clear. Copy copies exactly what is shown. `src` is the API path without `reveal`.
 */
export function DockerRaw({ src }: { src: string }) {
  const { t } = useI18n();
  const prefs = useGitPrefs();
  const [reveal, setReveal] = useState(false);
  const [r, setR] = useState<Raw | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [at, setAt] = useState(-1);
  const [hit, setHit] = useState<{ line: number; key: number } | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    api.get<Raw>(`${src}${src.includes('?') ? '&' : '?'}reveal=${reveal ? 1 : 0}`).then((x) => { if (live) { setR(x); setErr(''); } }).catch((e) => { if (live) setErr(e instanceof Error ? e.message : 'error'); });
    return () => { live = false; };
  }, [src, reveal]);

  const text = r?.text ?? '';
  const html = useHighlighted(text, 'inspect.json');
  const raws = useMemo(() => text.split('\n'), [text]);
  const widest = useMemo(() => raws.reduce((m, l) => Math.max(m, l.length), 0), [raws]);
  const matches = useMemo(() => { const n = q.trim().toLowerCase(); return n ? raws.flatMap((l, i) => (l.toLowerCase().includes(n) ? [i] : [])) : []; }, [raws, q]);
  const go = (dir: 1 | -1) => {
    if (!matches.length) return;
    const i = at < 0 ? (dir > 0 ? 0 : matches.length - 1) : (at + dir + matches.length) % matches.length;
    setAt(i); setHit({ line: matches[i], key: Date.now() });
  };
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ } };

  if (err) return <p className="gx-note err res-m0">{err}</p>;
  if (!r) return <p className="gx-note">{t('git.loading')}</p>;
  if (!r.available) return <Banner kind="warn">{t('raw.noDocker')}{r.error && <span className="muted small mono"> · {r.error}</span>}</Banner>;
  const current = at >= 0 ? matches[at] : -1;
  return (
    <div className="dr gx" data-gx-theme={prefs.theme} style={{ ['--g-tab' as never]: prefs.tabSize }}>
      <div className="dr-bar">
        <input className="input mono dr-find" value={q} placeholder={t('raw.find')} aria-label={t('raw.find')}
          onChange={(e) => { setQ(e.target.value); setAt(-1); setHit(null); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1); } }} />
        <span className="muted small dr-count" aria-live="polite">{q.trim() ? (matches.length ? t('raw.matches', { at: at < 0 ? 0 : at + 1, count: matches.length }) : t('raw.noMatch')) : ''}</span>
        <button className="btn ghost icon sm" disabled={!matches.length} onClick={() => go(-1)} aria-label={t('raw.prev')} title={t('raw.prev')}><ChevronUp size={14} /></button>
        <button className="btn ghost icon sm" disabled={!matches.length} onClick={() => go(1)} aria-label={t('raw.next')} title={t('raw.next')}><ChevronDown size={14} /></button>
        <span className="grow" />
        <GitSettings compact />
        <button className="btn ghost sm" onClick={() => setReveal((v) => !v)} aria-pressed={reveal}>{reveal ? <EyeOff size={14} /> : <Eye size={14} />}{t(reveal ? 'raw.hide' : 'raw.reveal')}</button>
        <button className="btn sm" onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />}{t(copied ? 'common.copied' : 'raw.copy')}</button>
      </div>
      <p className="dr-note muted small">{!reveal && r.masked > 0 ? `${t('raw.masked', { count: r.masked })} ` : ''}{t('raw.warn')}</p>
      <div className="dr-code vf"><div className="vf-main">
        <VirtualLines count={html.length} width={`calc(6ch + 16px + ${widest}ch + 40px)`}
          reveal={hit ? { top: Math.max(0, hit.line - 4) * ROW_H, bottom: (hit.line + 4) * ROW_H, key: hit.key } : undefined}
          render={(i) => (
            <div key={i} className={`vl-row ${i === current ? 'm-hit' : ''}`}>
              <div className="vl-ln">{i + 1}</div>
              <div className="vl-cd"><CodeCell html={html[i]} ws={prefs.whitespace} /></div>
            </div>
          )} />
      </div></div>
    </div>
  );
}
