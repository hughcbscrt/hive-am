'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Eraser } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';

const MAX_CHARS = 200_000;       // what the view keeps; older lines scroll off
const POLL_MS = 1200;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** The latest output of an object, following it while it is open (new lines are asked for with the cursor of the previous call). */
export function LogView({ id, height = 220 }: { id: string; height?: number | string }) {
  const { t } = useI18n();
  const [text, setText] = useState<string | null>(null);
  const cursor = useRef<string>('');
  const box = useRef<HTMLPreElement>(null);
  const stick = useRef(true);
  const [away, setAway] = useState(false);

  useEffect(() => {
    let dead = false, timer: ReturnType<typeof setTimeout>;
    setText(null); cursor.current = ''; stick.current = true; setAway(false);
    const tick = async () => {
      try {
        const q = cursor.current ? `after=${encodeURIComponent(cursor.current)}` : 'tail=300';
        const r = await api.get<{ text: string; cursor: string; reset?: boolean }>(`/objects/${id}/logs?${q}`);
        if (dead) return;
        cursor.current = r.cursor || cursor.current;
        const add = r.text.replace(ANSI, '');
        setText((cur) => {
          const base = r.reset ? '' : cur ?? '';
          if (!add) return cur ?? '';
          const joined = base && !base.endsWith('\n') && !add.startsWith('\n') ? `${base}\n${add}` : base + add;
          return joined.length > MAX_CHARS ? joined.slice(joined.length - MAX_CHARS) : joined;
        });
      } catch { /* the next tick tries again */ }
      if (!dead) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => { dead = true; clearTimeout(timer); };
  }, [id]);

  useEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [text]);
  const onScroll = () => { const el = box.current; if (!el) return; const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 24; stick.current = atEnd; setAway(!atEnd); };
  const toEnd = () => { const el = box.current; if (el) { el.scrollTop = el.scrollHeight; stick.current = true; setAway(false); } };

  return (
    <div className="logv">
      <pre ref={box} className="logv-body mono" style={{ height }} onScroll={onScroll} tabIndex={0}>{text === null ? t('git.loading') : text.trim() ? text : t('obj.logs.empty')}</pre>
      <div className="logv-tools">
        {away && <button className="btn sm" onClick={toEnd}><ArrowDownToLine size={14} />{t('obj.logs.bottom')}</button>}
        <button className="btn ghost icon sm" onClick={() => setText('')} aria-label={t('obj.logs.clear')} title={t('obj.logs.clear')}><Eraser size={14} /></button>
      </div>
    </div>
  );
}
