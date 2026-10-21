'use client';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { MessageSquare, Pencil, Send, Trash2, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { MAX_CHARS, MAX_COMMENTS, anchorLine, buildMessage, rangeLabel, type DiffComment } from '@/lib/git/diffComments';
import type { DiffCommentsStore } from '@/lib/git/useDiffComments';
import type { SendResult } from '@/components/chat/Chat';
import { Banner, ConfirmDialog } from '@/components/ui';
import { CopyBtn } from '@/components/chat/ToolCall';

/** What the agent page gives the Changes explorer: the stored comments, how to send them and the state of the chat. */
export interface DiffCommentsCtl extends DiffCommentsStore {
  send: (text: string) => Promise<SendResult>;
  /** Viewing an earlier conversation: the chat cannot send. */
  readOnly: boolean;
  /** The agent is working: the message will wait in its queue. */
  busy: boolean;
  agentName: string;
  onViewChat: () => void;
}

const SAY_GAP = 500;
/** A polite live region that says at most one message every 500 ms (the latest wins). */
export function useSay(): [string, (text: string) => void] {
  const [said, setSaid] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const last = useRef(0);
  const say = useCallback((text: string) => {
    clearTimeout(timer.current); setSaid('');
    timer.current = setTimeout(() => { last.current = Date.now(); setSaid(text); }, Math.max(0, last.current + SAY_GAP - Date.now()));
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [said, say];
}

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/**
 * The floating editor under the selected lines (the `overlay` of VirtualLines, looking like the peek). Escape or Cancel with unsaved text
 * asks first; Ctrl/⌘+Enter saves. On a phone it is a bottom sheet kept above the on-screen keyboard.
 */
export function CommentEditor({ path, range, initial, saved, editing, locked, mac, onChange, onSave, onCancel, onDelete }: {
  path: string; range: string; /** The text it opens with (a draft brought back, or the comment being edited). */ initial: string; /** What is stored ('' for a new comment): anything else is unsaved. */ saved: string;
  editing: boolean; locked: boolean; mac: boolean;
  onChange: (text: string) => void; onSave: (text: string) => void; onCancel: () => void; onDelete?: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(initial);
  const [asking, setAsking] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null), keep = useRef<HTMLButtonElement>(null), box = useRef<HTMLDivElement>(null);
  const id = useId();
  const dirty = text !== saved && !(saved === '' && !text.trim());
  useEffect(() => { area.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => { if (asking) keep.current?.focus(); }, [asking]);
  // Three rows, growing to eight.
  useLayoutEffect(() => {
    const el = area.current; if (!el) return;
    el.style.height = 'auto';
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.style.height = `${Math.min(el.scrollHeight, line * 8 + 16)}px`;
  }, [text]);
  // Above the on-screen keyboard when the editor is a bottom sheet.
  useEffect(() => {
    const vv = window.visualViewport; if (!vv) return;
    const fit = () => box.current?.style.setProperty('--dc-kb', `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`);
    fit(); vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit);
    return () => { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); };
  }, []);

  const change = (v: string) => { setText(v); onChange(v); };
  const cancel = () => { if (dirty) setAsking(true); else onCancel(); };
  const save = () => { if (text.trim()) onSave(text); };
  const keyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (asking) { setAsking(false); area.current?.focus(); } else cancel(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !asking) { e.preventDefault(); save(); }
  };
  const left = MAX_CHARS - text.length;
  return (
    <div ref={box} className="vl-peek dc-editor" role="group" aria-label={t('diffc.editor.title', { file: fileName(path), range })} onKeyDown={keyDown} inert={locked}>
      <div className="vl-peek-head"><MessageSquare size={13} aria-hidden /><b title={path}>{fileName(path)}</b><span className="muted">{range}</span></div>
      <div className="dc-ed-body">
        <label htmlFor={id} className="sr-only">{t('diffc.editor.label')}</label>
        <textarea ref={area} id={id} className="input dc-text" rows={3} maxLength={MAX_CHARS} value={text} onChange={(e) => change(e.target.value)} placeholder={t('diffc.editor.placeholder')} aria-describedby={`${id}-hint`} />
        {left <= 200 && <p className="dc-left" aria-live="polite">{t('diffc.editor.left', { count: left })}</p>}
        {asking ? (
          <div className="dc-ask" role="group" aria-label={t('diffc.editor.discard')}>
            <span className="grow">{t('diffc.editor.discard')}</span>
            <button ref={keep} type="button" className="btn sm" onClick={() => { setAsking(false); area.current?.focus(); }}>{t('diffc.editor.keep')}</button>
            <button type="button" className="btn sm danger" onClick={onCancel}>{t('diffc.editor.drop')}</button>
          </div>
        ) : (
          <div className="dc-ed-foot">
            {editing && onDelete && <button type="button" className="btn ghost sm danger" onClick={onDelete}><Trash2 size={13} />{t('diffc.delete')}</button>}
            <span className="grow dc-ed-hint" id={`${id}-hint`}>{t('diffc.editor.hint', { keys: mac ? '⌘ Enter' : 'Ctrl+Enter' })}</span>
            <button type="button" className="btn ghost sm" onClick={cancel}>{t('common.cancel')}</button>
            <button type="button" className="btn primary sm" disabled={!text.trim()} onClick={save}>{editing ? t('diffc.editor.save') : t('diffc.editor.add')}</button>
          </div>
        )}
      </div>
    </div>
  );
}

type Sent = { queued: boolean; name: string } | null;

/**
 * The foot of the Changes tab while there are comments: how many, the Review list, Discard all and the one button that sends them
 * all to the agent as a single chat message. Comments are only deleted once the server accepted the message.
 */
/** How wide the scroller holding the bar shows (the explorer can be wider than a phone), as `--dc-vw` for the bar's style. */
function useShownWidth(): [(el: HTMLElement | null) => void, CSSProperties | undefined] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [w, setW] = useState<number>();
  useEffect(() => {
    if (!el) return;
    let box = el.parentElement;
    while (box && !/auto|scroll|hidden/.test(getComputedStyle(box).overflowX)) box = box.parentElement;
    const scroller = box ?? document.documentElement;
    const measure = () => setW(scroller.clientWidth);
    const ro = new ResizeObserver(measure); ro.observe(scroller); measure();
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w ? { ['--dc-vw' as never]: `${w}px` } : undefined];
}

export function DiffCommentsBar({ ctl, sending, setSending, onGoTo }: { ctl: DiffCommentsCtl; sending: boolean; setSending: (v: boolean) => void; onGoTo: (c: DiffComment, edit: boolean) => void }) {
  const { t } = useI18n();
  const { items } = ctl;
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent>(null);
  const [said, say] = useSay();
  const reviewBtn = useRef<HTMLButtonElement>(null), errBox = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [barRef, barStyle] = useShownWidth();

  useEffect(() => { if (!sent) return; const h = setTimeout(() => setSent(null), 8000); return () => clearTimeout(h); }, [sent]);
  useEffect(() => { if (error) errBox.current?.focus(); }, [error]);
  useEffect(() => { if (!items.length) { setOpen(false); setPreview(false); } }, [items.length]);

  const send = async () => {
    if (sending || ctl.readOnly || !items.length) return;
    const queued = ctl.busy, name = ctl.agentName;
    setSending(true); setError(null);
    const r = await ctl.send(buildMessage(items, t));
    setSending(false);
    if (r.ok) { ctl.clear(); setSent({ queued, name }); }
    else setError(r.error);
  };
  const remove = (c: DiffComment) => { ctl.remove(c.id); say(t('diffc.announce.deleted', { count: items.length - 1 })); };

  const region = <div className="sr-only" aria-live="polite">{said}</div>;
  if (!items.length) {
    if (!sent) return region;
    return (
      <div ref={barRef} style={barStyle} className="dc-bar done" role="region" aria-label={t('diffc.bar.label')}>
        {region}
        <div className="dc-sent" role="status">
          <span className="grow">{t(sent.queued ? 'diffc.sentQueued' : 'diffc.sent', { name: sent.name })}</span>
          <button type="button" className="btn sm" onClick={() => { setSent(null); ctl.onViewChat(); }}>{t('diffc.viewChat')}</button>
          <button type="button" className="btn ghost icon sm" onClick={() => setSent(null)} aria-label={t('common.close')} title={t('common.close')}><X size={14} /></button>
        </div>
      </div>
    );
  }

  const files = new Set(items.map((c) => c.path));
  const outdated = items.filter((c) => c.outdated).length;
  const byFile = [...files].sort().map((p) => ({ path: p, list: items.filter((c) => c.path === p).sort((a, b) => anchorLine(a) - anchorLine(b)) }));
  const closeList = () => { setOpen(false); reviewBtn.current?.focus(); };
  return (
    <div ref={barRef} style={barStyle} className="dc-bar" role="region" aria-label={t('diffc.bar.label')}>
      {region}
      {open && (
        <div id={listId} className="dc-list" role="group" aria-label={t('diffc.review.title')} inert={sending} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); closeList(); } }}>
          <div className="dc-list-head"><b className="grow">{t('diffc.review.title')}</b><button type="button" className="btn ghost icon sm" onClick={closeList} aria-label={t('common.close')} title={t('common.close')}><X size={15} /></button></div>
          <div className="dc-list-body">
            {byFile.map((f) => (
              <section key={f.path} className="dc-file">
                <h4 title={f.path}><b>{fileName(f.path)}</b> <span className="muted mono">{f.path}</span></h4>
                <ul>
                  {f.list.map((c) => {
                    const range = rangeLabel(c, t), aria = t('diffc.itemAria', { file: fileName(c.path), range });
                    return (
                      <li key={c.id} className="dc-item">
                        <button type="button" className="dc-item-go" onClick={() => onGoTo(c, false)} aria-label={`${aria}: ${c.text}`}>
                          <span className="dc-item-top"><span className="dc-range">{range}</span>{c.outdated && <span className="chip dc-chip" title={c.gone ? t('diffc.outdated.gone') : t('diffc.outdated.hint')}>{t('diffc.outdated')}</span>}</span>
                          <span className="dc-item-text">{c.text}</span>
                          {c.outdated && <span className="dc-item-why">{c.gone ? t('diffc.outdated.gone') : t('diffc.outdated.hint')}</span>}
                        </button>
                        <button type="button" className="btn ghost icon sm" onClick={() => onGoTo(c, true)} aria-label={`${t('diffc.edit')}: ${aria}`} title={t('diffc.edit')}><Pencil size={14} /></button>
                        <button type="button" className="btn ghost icon sm danger" onClick={() => remove(c)} aria-label={`${t('diffc.delete')}: ${aria}`} title={t('diffc.delete')}><Trash2 size={14} /></button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
          <div className="dc-list-foot">
            <button type="button" className="btn ghost sm" aria-expanded={preview} onClick={() => setPreview((p) => !p)}>{preview ? t('diffc.preview.hide') : t('diffc.preview')}</button>
            <CopyBtn text={buildMessage(items, t)} label={t('diffc.copy')} />
          </div>
          {preview && <pre className="mono dc-msg" tabIndex={0}>{buildMessage(items, t)}</pre>}
        </div>
      )}
      {error && (
        <div ref={errBox} tabIndex={-1} className="dc-err">
          <Banner kind="err" action={<button type="button" className="btn sm" onClick={() => void send()}>{t('diffc.retry')}</button>}>{t('diffc.sendError')}{error ? ` ${error}` : ''}</Banner>
        </div>
      )}
      {ctl.busy && !ctl.readOnly && <p className="dc-note">{t('diffc.busy', { name: ctl.agentName })}</p>}
      {ctl.readOnly && <p className="dc-note">{t('diffc.readOnly')}</p>}
      {items.length >= MAX_COMMENTS && <p className="dc-note">{t('diffc.limit', { max: MAX_COMMENTS })}</p>}
      <div className="dc-row" inert={sending}>
        <div className="dc-sum">
          <MessageSquare size={15} aria-hidden />
          <span>{t('diffc.bar.count', { count: items.length })} · {t('diffc.bar.files', { count: files.size })}</span>
          {outdated > 0 && <span className="chip dc-chip">{t('diffc.outdated.count', { count: outdated })}</span>}
          <button ref={reviewBtn} type="button" className="btn ghost sm" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen((o) => !o)}>{t('diffc.review')}</button>
        </div>
        <div className="dc-acts">
          {items.length >= 2 && <button type="button" className="btn ghost icon sm" onClick={() => setAsking(true)} aria-label={t('diffc.clear')} title={t('diffc.clear')}><Trash2 size={15} /></button>}
          <button type="button" className="btn primary sm dc-send" disabled={sending || ctl.readOnly} aria-busy={sending} onClick={() => void send()} aria-label={sending ? t('diffc.sending') : t('diffc.sendAria', { count: items.length, name: ctl.agentName })}>
            <Send size={14} aria-hidden />{sending ? t('diffc.sending') : t('diffc.send', { count: items.length })}
          </button>
        </div>
      </div>
      {asking && <ConfirmDialog danger title={t('diffc.clear.title', { count: items.length })} body={t('diffc.clear.body')} confirmLabel={t('diffc.clear.go')} onClose={() => setAsking(false)} onConfirm={() => ctl.clear()} />}
    </div>
  );
}
