'use client';
import { useMemo } from 'react';
import { useI18n } from '@/lib/i18n/index';
import { fmtBytes } from '@/lib/format';
import type { HttpHistoryEntry } from '@/lib/types';

type Op = { t: ' ' | '+' | '-'; s: string };

/** Line diff (longest common subsequence). Past a size it only marks the lines that differ at the same position. */
export function diffLines(a: string[], b: string[]): Op[] {
  if (a.length * b.length > 4_000_000) return [...a.map((s) => ({ t: '-' as const, s })), ...b.map((s) => ({ t: '+' as const, s }))];
  const n = a.length, m = b.length; const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: Op[] = []; let i = 0, j = 0;
  while (i < n && j < m) { if (a[i] === b[j]) { out.push({ t: ' ', s: a[i] }); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: '-', s: a[i++] }); else out.push({ t: '+', s: b[j++] }); }
  while (i < n) out.push({ t: '-', s: a[i++] }); while (j < m) out.push({ t: '+', s: b[j++] });
  return out;
}
const pretty = (e: HttpHistoryEntry): string => {
  const b = e.run?.body ?? '';
  try { return JSON.stringify(JSON.parse(b), null, 2); } catch { return b; }
};

/** Two runs side by side in one view: status, time, size, the headers that changed and the answer as a line diff. */
export function RunDiff({ before, after }: { before: HttpHistoryEntry; after: HttpHistoryEntry }) {
  const { t } = useI18n();
  const ops = useMemo(() => diffLines(pretty(before).split('\n'), pretty(after).split('\n')), [before, after]);
  const hb = Object.fromEntries((before.run?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]));
  const ha = Object.fromEntries((after.run?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]));
  const IGNORE = /^(date|age|etag|x-request-id|x-correlation-id|set-cookie|server-timing|content-length)$/;
  const hchanges = [...new Set([...Object.keys(hb), ...Object.keys(ha)])].filter((k) => hb[k] !== ha[k] && !IGNORE.test(k));
  const changed = ops.filter((o) => o.t !== ' ').length;
  // long unchanged stretches are folded
  const rows: (Op | { fold: number })[] = []; let run: Op[] = [];
  const flush = () => { if (run.length > 8) { rows.push(...run.slice(0, 3), { fold: run.length - 6 }, ...run.slice(-3)); } else rows.push(...run); run = []; };
  for (const o of ops) { if (o.t === ' ') run.push(o); else { flush(); rows.push(o); } } flush();
  const stat = (e: HttpHistoryEntry) => (e.run ? `${e.run.status} · ${e.run.durationMs} ms · ${fmtBytes(e.run.size)}` : t('hw2.diff.error'));
  return (
    <div className="rd">
      <div className="rd-head">
        <div><span className="muted small">{t('hw2.diff.before')} · {new Date(before.at).toLocaleTimeString()}</span><div className="mono">{stat(before)}</div></div>
        <div><span className="muted small">{t('hw2.diff.after')} · {new Date(after.at).toLocaleTimeString()}</span><div className="mono">{stat(after)}</div></div>
      </div>
      {hchanges.length > 0 && (<><div className="eyebrow">{t('http.headers')}</div><div className="rd-hdrs mono small">{hchanges.map((k) => <div key={k}><b>{k}</b>: {hb[k] !== undefined && <span className="rd-del">{hb[k]}</span>} {ha[k] !== undefined && <span className="rd-add">{ha[k]}</span>}</div>)}</div></>)}
      <div className="eyebrow" style={{ marginTop: 10 }}>{t('hw2.diff.body')} · {changed === 0 ? t('hw2.diff.same') : t('hw2.diff.lines', { count: changed })}</div>
      <div className="rd-body mono">
        {rows.map((r, i) => 'fold' in r ? <div key={i} className="rd-fold">{t('hw2.diff.fold', { count: r.fold })}</div> : <div key={i} className={`rd-l ${r.t === '+' ? 'add' : r.t === '-' ? 'del' : ''}`}><span>{r.t}</span>{r.s || ' '}</div>)}
      </div>
    </div>
  );
}
