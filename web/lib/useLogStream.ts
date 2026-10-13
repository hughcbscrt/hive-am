'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/**
 * The output of an object, kept up to date: the first call brings the last lines, each next one only what is new (with the cursor of the
 * previous call). `paused` stops asking. `max` is how many characters are kept; the oldest go first.
 */
export function useLogStream(id: string, { max = 800_000, pollMs = 1000, paused = false }: { max?: number; pollMs?: number; paused?: boolean } = {}) {
  // `dropped` counts the lines that fell off the front, so a line keeps the same number while newer ones arrive (stable keys for the view).
  const [st, setSt] = useState<{ text: string | null; dropped: number }>({ text: null, dropped: 0 });
  const cursor = useRef('');
  const gen = useRef(0);

  useEffect(() => { setSt({ text: null, dropped: 0 }); cursor.current = ''; gen.current++; }, [id]);
  useEffect(() => {
    if (paused) return;
    let dead = false, timer: ReturnType<typeof setTimeout>; const mine = gen.current;
    const tick = async () => {
      try {
        const q = cursor.current ? `after=${encodeURIComponent(cursor.current)}` : 'tail=2000';
        const r = await api.get<{ text: string; cursor: string; reset?: boolean }>(`/objects/${id}/logs?${q}`);
        if (dead || mine !== gen.current) return;
        cursor.current = r.cursor || cursor.current;
        const add = r.text.replace(ANSI, '');
        setSt((cur) => {
          if (!add && !r.reset) return cur;
          const base = r.reset ? '' : cur.text ?? '';
          const joined = !add ? base : base && !base.endsWith('\n') && !add.startsWith('\n') ? `${base}\n${add}` : base + add;
          if (joined.length <= max) return { text: joined, dropped: r.reset ? 0 : cur.dropped };
          const cut = joined.length - max, gone = joined.slice(0, cut);
          return { text: joined.slice(cut), dropped: (r.reset ? 0 : cur.dropped) + gone.split('\n').length - 1 };
        });
      } catch { /* the next tick tries again */ }
      if (!dead) timer = setTimeout(tick, pollMs);
    };
    void tick();
    return () => { dead = true; clearTimeout(timer); };
  }, [id, paused, max, pollMs]);

  const clear = useCallback(() => setSt((c) => ({ text: '', dropped: c.dropped + (c.text ? c.text.split('\n').length : 0) })), []);
  return { text: st.text, dropped: st.dropped, clear };
}
