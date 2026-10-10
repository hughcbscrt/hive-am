'use client';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, Copy, Download, Eraser, Pause, Play, Search, WrapText, ZoomIn, ZoomOut } from 'lucide-react';
import { useI18n } from '@/lib/i18n/index';
import { useLogStream } from '@/lib/useLogStream';

const SHOWN = 4000;       // rows drawn; the rest is kept (and downloaded) but not drawn
const LEVEL_ERR = /\b(error|fatal|exception|panic|fail(ed|ure)?|traceback)\b/i, LEVEL_WARN = /\b(warn(ing)?|deprecated)\b/i;
const COLORS = ['#0f8f9e', '#c0399a', '#7a4de0', '#d4663f', '#2f8f5b', '#9a7400', '#2f5bea', '#c2412d'];

/**
 * The logs of an object on a whole screen: search (highlighting, or only the lines that match), follow the end, wrap, text size, pause,
 * clear, copy and download. For a cluster each line starts with `[member]`: members get a colour and can be hidden.
 */
export function LogPane({ id, members }: { id: string; members?: string[] }) {
  const { t } = useI18n();
  const [paused, setPaused] = useState(false);
  const { text, clear } = useLogStream(id, { paused });
  const [q, setQ] = useState('');
  const [only, setOnly] = useState(false);
  const [follow, setFollow] = useState(true);
  const [wrap, setWrap] = useState(true);
  const [size, setSize] = useState(12.5);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { try { const s = Number(localStorage.getItem('hive-am.logsize')); if (s >= 10 && s <= 20) setSize(s); } catch { /* none */ } }, []);
  const zoom = (d: number) => setSize((s) => { const n = Math.max(10, Math.min(20, s + d)); try { localStorage.setItem('hive-am.logsize', String(n)); } catch { /* none */ } return n; });

  const all = useMemo(() => (text ? text.split('\n') : []), [text]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out: { line: string; member?: string; level: '' | 'err' | 'warn'; hit: boolean }[] = [];
    for (const line of all) {
      const m = members ? /^\[([^\]]+)\] /.exec(line) : null;
      if (m && hidden.has(m[1])) continue;
      const hit = !!needle && line.toLowerCase().includes(needle);
      if (only && needle && !hit) continue;
      out.push({ line, member: m?.[1], level: LEVEL_ERR.test(line) ? 'err' : LEVEL_WARN.test(line) ? 'warn' : '', hit });
    }
    return out;
  }, [all, q, only, hidden, members]);
  const shown = rows.length > SHOWN ? rows.slice(rows.length - SHOWN) : rows;
  const hits = q.trim() ? rows.filter((r) => r.hit).length : 0;

  useEffect(() => { const el = box.current; if (el && follow) el.scrollTop = el.scrollHeight; }, [shown, follow]);
  const onScroll = () => { const el = box.current; if (!el) return; const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 40; if (!atEnd && follow) setFollow(false); else if (atEnd && !follow) setFollow(true); };

  const highlight = (line: string) => {
    const needle = q.trim(); if (!needle) return line;
    const parts: React.ReactNode[] = []; const low = line.toLowerCase(), nl = needle.toLowerCase(); let i = 0, k = 0;
    for (let at = low.indexOf(nl); at >= 0; at = low.indexOf(nl, i)) { parts.push(line.slice(i, at), <mark key={k++}>{line.slice(at, at + needle.length)}</mark>); i = at + needle.length; }
    parts.push(line.slice(i)); return parts.map((p, j) => <Fragment key={j}>{p}</Fragment>);
  };
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([all.join('\n')], { type: 'text/plain' })); a.download = `${id.slice(0, 8)}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };

  return (
    <div className="lp">
      <div className="lp-bar">
        <div className="search lp-search"><Search size={14} /><input className="input" placeholder={t('lp.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('lp.search')} />{hits > 0 && <span className="lp-hits">{t('lp.matches', { count: hits })}</span>}</div>
        <label className="row gap-s small"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />{t('lp.only')}</label>
        <span className="grow" />
        <button className={`btn ghost icon sm ${wrap ? 'on' : ''}`} aria-pressed={wrap} onClick={() => setWrap((w) => !w)} aria-label={t('lp.wrap')} title={t('lp.wrap')}><WrapText size={15} /></button>
        <button className="btn ghost icon sm" onClick={() => zoom(-1)} aria-label={t('lp.smaller')} title={t('lp.smaller')}><ZoomOut size={15} /></button>
        <button className="btn ghost icon sm" onClick={() => zoom(1)} aria-label={t('lp.larger')} title={t('lp.larger')}><ZoomIn size={15} /></button>
        <button className={`btn ghost icon sm ${paused ? 'on' : ''}`} aria-pressed={paused} onClick={() => setPaused((p) => !p)} aria-label={paused ? t('lp.resume') : t('lp.pause')} title={paused ? t('lp.resume') : t('lp.pause')}>{paused ? <Play size={15} /> : <Pause size={15} />}</button>
        <button className="btn ghost icon sm" onClick={clear} aria-label={t('lp.clear')} title={t('lp.clear')}><Eraser size={15} /></button>
        <button className="btn ghost icon sm" onClick={() => void navigator.clipboard?.writeText(all.join('\n'))} aria-label={t('lp.copy')} title={t('lp.copy')}><Copy size={15} /></button>
        <button className="btn ghost icon sm" onClick={download} aria-label={t('lp.download')} title={t('lp.download')}><Download size={15} /></button>
      </div>
      {members && members.length > 0 && (
        <div className="lp-chips">{members.map((m, i) => (
          <button key={m} className={`lp-chip ${hidden.has(m) ? 'off' : ''}`} style={{ ['--c' as never]: COLORS[i % COLORS.length] }} aria-pressed={!hidden.has(m)} onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(m)) n.delete(m); else n.add(m); return n; })}>{m}</button>))}</div>
      )}
      <div className={`lp-body mono ${wrap ? 'wrap' : ''}`} ref={box} onScroll={onScroll} tabIndex={0} style={{ fontSize: size }}>
        {text === null ? <p className="muted">{t('git.loading')}</p> : shown.length === 0 ? <p className="muted">{t('obj.logs.empty')}</p> : shown.map((r, i) => {
          const mi = r.member ? members?.indexOf(r.member) ?? -1 : -1;
          return <div key={i} className={`lp-row ${r.level} ${r.hit ? 'hit' : ''}`} style={mi >= 0 ? { ['--c' as never]: COLORS[mi % COLORS.length] } : undefined}>{r.member && mi >= 0 ? <><b className="lp-src">[{r.member}]</b>{highlight(r.line.slice(r.member.length + 3))}</> : highlight(r.line)}</div>;
        })}
      </div>
      <div className="lp-foot muted small">
        <span>{t('lp.lines', { count: rows.length })}{rows.length > SHOWN ? ` · ${t('lp.shown', { count: SHOWN })}` : ''}{paused ? ` · ${t('lp.paused')}` : ''}</span>
        {!follow && <button className="btn sm" onClick={() => { setFollow(true); const el = box.current; if (el) el.scrollTop = el.scrollHeight; }}><ArrowDownToLine size={14} />{t('lp.follow')}</button>}
      </div>
    </div>
  );
}
