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
  const [text, setText] = useState<string | null>(null);
  const cursor = useRef('');
  const gen = useRef(0);

  useEffect(() => { setText(null); cursor.current = ''; gen.current++; }, [id]);
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
        setText((cur) => {
          const base = r.reset ? '' : cur ?? '';
          if (!add) return cur ?? '';
          const joined = base && !base.endsWith('\n') && !add.startsWith('\n') ? `${base}\n${add}` : base + add;
          return joined.length > max ? joined.slice(joined.length - max) : joined;
        });
      } catch { /* the next tick tries again */ }
      if (!dead) timer = setTimeout(tick, pollMs);
    };
    void tick();
    return () => { dead = true; clearTimeout(timer); };
  }, [id, paused, max, pollMs]);

  const clear = useCallback(() => setText(''), []);
  return { text, clear };
}
