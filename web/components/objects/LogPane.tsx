'use client';
import { Fragment, memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, Copy, Download, Eraser, Pause, Play, Search, WrapText, ZoomIn, ZoomOut } from 'lucide-react';
import { useI18n } from '@/lib/i18n/index';
import { useLogStream } from '@/lib/useLogStream';
import { SERIES_COLORS as COLORS } from '@/lib/meta';

const SHOWN = 2000;
const CHUNK = 50;       // rows drawn; the rest is kept (and downloaded) but not drawn
const LEVEL_ERR = /\b(error|fatal|exception|panic|fail(ed|ure)?|traceback)\b/i, LEVEL_WARN = /\b(warn(ing)?|deprecated)\b/i;

/**
 * The logs of an object on a whole screen: search (highlighting, or only the lines that match), follow the end, wrap, text size, pause,
 * clear, copy and download. For a cluster each line starts with `[member]`: members get a colour and can be hidden.
 */
export function LogPane({ id, members, initialFilter }: { id: string; members?: string[]; /** Opens with this text searched, showing only the matching lines (e.g. the lines of one service). */ initialFilter?: string }) {
  const { t } = useI18n();
  const [paused, setPaused] = useState(false);
  const { text, dropped, clear } = useLogStream(id, { paused });
  const [q, setQ] = useState(initialFilter ?? '');
  const dq = useDeferredValue(q);       // typing stays instant; the lines catch up a moment later
  const [only, setOnly] = useState(!!initialFilter);
  const [follow, setFollow] = useState(true);
  const [wrap, setWrap] = useState(true);
  const [size, setSize] = useState(12.5);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { try { const s = Number(localStorage.getItem('hive-am.logsize')); if (s >= 10 && s <= 20) setSize(s); } catch { /* none */ } }, []);
  const zoom = (d: number) => setSize((s) => { const n = Math.max(10, Math.min(20, s + d)); try { localStorage.setItem('hive-am.logsize', String(n)); } catch { /* none */ } return n; });

  const all = useMemo(() => (text ? text.split('\n') : []), [text]);
  const rows = useMemo(() => {
    const needle = dq.trim().toLowerCase();
    const out: { line: string; idx: number; member?: string }[] = [];
    for (let i = 0; i < all.length; i++) {
      const line = all[i];
      const m = members ? /^\[([^\]]+)\] /.exec(line) : null;
      if (m && hidden.has(m[1])) continue;
      if (only && needle && !line.toLowerCase().includes(needle)) continue;
      out.push({ line, idx: dropped + i, member: m?.[1] });
    }
    return out;
  }, [all, dq, only, hidden, members, dropped]);
  const shown = rows.length > SHOWN ? rows.slice(rows.length - SHOWN) : rows;
  // The rows go in blocks of CHUNK lines (by their absolute number): a block that did not change is not even looked at again, which is what
  // keeps a chatty log smooth (drawing the 2000 rows again on every poll froze the pane).
  const chunks = useMemo(() => { const m = new Map<number, typeof shown>(); for (const r of shown) { const c = Math.floor(r.idx / CHUNK); const a = m.get(c); if (a) a.push(r); else m.set(c, [r]); } return [...m]; }, [shown]);
  const hits = useMemo(() => { const n = dq.trim().toLowerCase(); return n ? rows.filter((r) => r.line.toLowerCase().includes(n)).length : 0; }, [rows, dq]);

  useEffect(() => { const el = box.current; if (el && follow) el.scrollTop = el.scrollHeight; }, [shown, follow]);
  const onScroll = () => { const el = box.current; if (!el) return; const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 40; if (!atEnd && follow) setFollow(false); else if (atEnd && !follow) setFollow(true); };

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
        {text === null ? <p className="muted">{t('git.loading')}</p> : shown.length === 0 ? <p className="muted">{t('obj.logs.empty')}</p> : chunks.map(([c, rs]) => <Chunk key={c} rows={rs} members={members} needle={dq.trim()} />)}
      </div>
      <div className="lp-foot muted small">
        <span>{t('lp.lines', { count: rows.length })}{rows.length > SHOWN ? ` · ${t('lp.shown', { count: SHOWN })}` : ''}{paused ? ` · ${t('lp.paused')}` : ''}</span>
        {!follow && <button className="btn sm" onClick={() => { setFollow(true); const el = box.current; if (el) el.scrollTop = el.scrollHeight; }}><ArrowDownToLine size={14} />{t('lp.follow')}</button>}
      </div>
    </div>
  );
}

/** One line. */
function Row({ line, member, mi, needle }: { line: string; member?: string; mi: number; needle: string }) {
  const level = LEVEL_ERR.test(line) ? 'err' : LEVEL_WARN.test(line) ? 'warn' : '';
  const body = member && mi >= 0 ? line.slice(member.length + 3) : line;
  let hit = false;
  const parts: React.ReactNode[] = [];
  if (needle) {
    const low = body.toLowerCase(), nl = needle.toLowerCase(); let i = 0, k = 0;
    for (let at = low.indexOf(nl); at >= 0; at = low.indexOf(nl, i)) { hit = true; parts.push(body.slice(i, at), <mark key={k++}>{body.slice(at, at + needle.length)}</mark>); i = at + needle.length; }
    parts.push(body.slice(i));
  }
  const text = needle ? parts.map((p, j) => <Fragment key={j}>{p}</Fragment>) : body;
  return <div className={`lp-row ${level} ${hit ? 'hit' : ''}`} style={mi >= 0 ? { ['--c' as never]: COLORS[mi % COLORS.length] } : undefined}>{member && mi >= 0 ? <><b className="lp-src">[{member}]</b>{text}</> : text}</div>;
}

type LogRow = { line: string; idx: number; member?: string };
const Chunk = memo(function Chunk({ rows, members, needle }: { rows: LogRow[]; members?: string[]; needle: string }) {
  return <>{rows.map((r) => <Row key={r.idx} line={r.line} member={r.member} mi={r.member ? members?.indexOf(r.member) ?? -1 : -1} needle={needle} />)}</>;
}, (a, b) => a.needle === b.needle && a.members === b.members && a.rows.length === b.rows.length && a.rows.every((r, i) => r.idx === b.rows[i].idx && r.line === b.rows[i].line));
