'use client';
import { useEffect, useRef } from 'react';
import '@xterm/xterm/css/xterm.css';
import { useI18n } from '@/lib/i18n';

const WS = () => `ws://${location.hostname}:${process.env.NEXT_PUBLIC_HIVE_WS_PORT ?? 4400}/ws/terminal`;
const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const palette = () => ({ background: css('--bg-deep', '#0c1411'), foreground: css('--ink', '#e7eee9'), cursor: css('--honey', '#e8a317'), cursorAccent: css('--bg-deep', '#0c1411'), selectionBackground: 'rgba(232,163,23,.35)' });

/** One terminal of the server shown with xterm.js. It keeps working while hidden; coming back to it shows the same screen. */
export function XTerm({ id, visible, onEnded }: { id: string; visible: boolean; onEnded: (code: number | null) => void }) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const api = useRef<{ fit: () => void; focus: () => void } | null>(null);
  const shown = useRef(visible); shown.current = visible;

  useEffect(() => {
    let dead = false, ws: WebSocket | null = null, retry: ReturnType<typeof setTimeout> | undefined, ended = false, tries = 0;
    let term: import('@xterm/xterm').Terminal | null = null, fit: import('@xterm/addon-fit').FitAddon | null = null, ro: ResizeObserver | null = null, mo: MutationObserver | null = null;
    const send = (m: object) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
    const resize = () => { if (!term || !fit || !box.current?.offsetParent) return; try { fit.fit(); send({ t: 'resize', cols: term.cols, rows: term.rows }); } catch { /* not laid out yet */ } };

    (async () => {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit'), import('@xterm/addon-web-links')]);
      if (dead || !box.current) return;
      term = new Terminal({ fontFamily: css('--font-mono', 'ui-monospace, monospace'), fontSize: 13, lineHeight: 1.15, cursorBlink: true, scrollback: 5000, theme: palette(), allowProposedApi: false });
      fit = new FitAddon(); term.loadAddon(fit); term.loadAddon(new WebLinksAddon());
      term.open(box.current);
      api.current = { fit: resize, focus: () => term?.focus() };
      if (shown.current) { resize(); term.focus(); }                // opened while it is the tab in view: ready to type
      term.onData((d) => send({ t: 'in', d }));
      ro = new ResizeObserver(resize); ro.observe(box.current);
      mo = new MutationObserver(() => { if (term) term.options.theme = palette(); }); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

      const connect = () => {
        ws = new WebSocket(`${WS()}?id=${encodeURIComponent(id)}`);
        ws.onopen = () => { tries = 0; };
        ws.onmessage = (m) => {
          const msg = JSON.parse(m.data);
          if (msg.t === 'init') { term!.reset(); resize(); }                               // what follows is the whole screen again
          else if (msg.t === 'out') term!.write(msg.d);
          else if (msg.t === 'exit') { ended = true; term!.write(`\r\n\x1b[2m[${t('dock.ended', { code: msg.code })}]\x1b[0m\r\n`); onEnded(msg.code); }
          else if (msg.t === 'gone') { ended = true; term!.write(`\r\n\x1b[2m[${t('dock.gone')}]\x1b[0m\r\n`); onEnded(null); }
        };
        ws.onclose = () => { if (!dead && !ended) retry = setTimeout(connect, Math.min(5000, 600 * 2 ** tries++)); };
      };
      connect();
    })();

    return () => { dead = true; clearTimeout(retry); ro?.disconnect(); mo?.disconnect(); ws?.close(); term?.dispose(); api.current = null; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (visible) { const h = setTimeout(() => { api.current?.fit(); api.current?.focus(); }, 30); return () => clearTimeout(h); } }, [visible]);
  return <div className="xterm-box" ref={box} />;
}
