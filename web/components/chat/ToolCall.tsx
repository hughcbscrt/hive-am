'use client';
import { createContext, useContext, useEffect, useId, useState, type ReactNode } from 'react';
import { BookOpen, Bot, Paperclip, Check, ChevronRight, Copy, FilePen, FilePlus, FileText, Globe, ListChecks, MessageSquare, MousePointerClick, Search, Terminal, Volume2, VolumeX, Waypoints, Wrench } from 'lucide-react';
import { fmtDur } from '@/lib/format';
import { translate as tr, useI18n } from '@/lib/i18n/index';
import type { Block } from '@/lib/types';

type Tool = Extract<Block, { type: 'tool' }>;
type Obj = Record<string, any>;

/** `pill` and `tip` are the short label and the tooltip of the compact view's pill. */
interface Described { icon: ReactNode; label: string; summary: string; body: ReactNode | null; kind?: 'shell'; command?: string; pill: string; tip: string }
type Kind = Omit<Described, 'pill' | 'tip'> & Partial<Pick<Described, 'pill' | 'tip'>>;

/** Lets the chat expand or collapse every tool row at once. null = each row decides for itself. */
export const ToolsOpen = createContext<boolean | null>(null);

const tilde = (p: string) => p.replace(/^\/home\/[^/]+/, '~');

export function CopyBtn({ text, label, compact = false }: { text: string; label?: string; /** icon only (the label stays as tooltip) */ compact?: boolean }) {
  const { t } = useI18n();
  label ??= t('common.copy');
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className={`copybtn ${compact ? 'compact' : ''}`} aria-label={label} title={label}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1200); }).catch(() => undefined); }}>
      {ok ? <Check size={13} /> : <Copy size={13} />}{compact ? null : ok ? t('common.copied') : label}
    </button>
  );
}

const entries0 = (o: Obj) => Object.keys(o).some((k) => k !== 'tabId');
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));
const pick = (o: Obj, ...keys: string[]) => { for (const k of keys) if (o?.[k] != null && o[k] !== '') return o[k]; return undefined; };

function Diff({ oldText, newText }: { oldText: string; newText: string }) {
  return (
    <div className="diff">
      {oldText.split('\n').map((l, i) => <div key={'o' + i} className="del"><b>−</b>{l}</div>)}
      {newText.split('\n').map((l, i) => <div key={'n' + i} className="add"><b>+</b>{l}</div>)}
    </div>
  );
}

function Kv({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="kv">{rows.filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}</dl>;
}

const base = (p: string) => p.replace(/[\\/]+$/, '').replace(/^.*[\\/]/, '');
const join = (a: string, b: string) => (b ? `${a}: ${b}` : a);

/** Turn a provider-specific tool call (Claude / OpenCode / Kiro naming) into something readable. */
export function describe(tool: Tool): Described {
  const d = kind(tool);
  return { ...d, pill: d.pill || d.label, tip: d.tip || join(d.label, d.summary) };
}

function kind(tool: Tool): Kind {
  const input = (tool.input && typeof tool.input === 'object' ? tool.input : {}) as Obj;
  const raw = tool.name;
  const mcp = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(raw);
  const n = (mcp ? mcp[2] : raw).toLowerCase().replace(/[^a-z]/g, '');

  // OpenCode runs MCP tools from inside a code block: `await tools.hive.channel_reply({ text: "…" })`.
  const wrapped = typeof input.code === 'string' ? /tools\.hive\.channel_reply\(\s*\{\s*text\s*:\s*("(?:[^"\\]|\\.)*")/.exec(input.code) : null;
  let wrappedText: string | undefined;
  if (wrapped) { try { wrappedText = JSON.parse(wrapped[1]); } catch { /* not a plain string: fall through to the code view */ } }
  if (n.endsWith('channelreply') || wrappedText !== undefined) {
    const text = wrappedText ?? str(input.text);
    return { icon: <MessageSquare size={14} />, label: tr('tool.channelReply'), summary: text.replace(/\s+/g, ' ').slice(0, 140), body: <pre className="codebox pre-wrap">{text}</pre> };
  }
  const wrappedSkill = typeof input.code === 'string' ? /tools\.hive\.skill_read\(\s*\{\s*name\s*:\s*("(?:[^"\\]|\\.)*")/.exec(input.code) : null;
  if (n.endsWith('skillread') || wrappedSkill) {
    let nm = str(input.name); if (wrappedSkill) { try { nm = JSON.parse(wrappedSkill[1]); } catch { /* keep */ } }
    return { icon: <BookOpen size={14} />, label: tr('tool.skillRead'), summary: nm, body: null, pill: join(tr('tool.skillRead'), nm) };
  }
  const wrappedSend = typeof input.code === 'string' ? /tools\.hive\.channel_send_file\(\s*\{\s*path\s*:\s*("(?:[^"\\]|\\.)*")/.exec(input.code) : null;
  if (n.endsWith('channelsendfile') || wrappedSend) {
    let p = str(input.path); if (wrappedSend) { try { p = JSON.parse(wrappedSend[1]); } catch { /* keep */ } }
    const cap = str(input.caption);
    return { icon: <Paperclip size={14} />, label: tr('tool.channelSendFile'), summary: p.replace(/^.*[\\/]/, ''), pill: join(tr('tool.channelSendFile'), base(p)), tip: join(tr('tool.channelSendFile'), p), body: <Kv rows={[[tr('tool.k.path'), <span key="p" className="mono">{p}</span>], ...(cap ? [[tr('tool.k.caption'), <span key="c">{cap}</span>] as [string, ReactNode]] : [])]} /> };
  }
  const wrappedMute = typeof input.code === 'string' ? /tools\.hive\.channel_mute\(\s*\{\s*muted\s*:\s*(true|false)/.exec(input.code) : null;
  if (n.endsWith('channelmute') || wrappedMute) {
    const muted = wrappedMute ? wrappedMute[1] === 'true' : input.muted !== false;
    return { icon: muted ? <VolumeX size={14} /> : <Volume2 size={14} />, label: tr(muted ? 'tool.channelMute' : 'tool.channelUnmute'), summary: '', body: null };
  }
  if (mcp?.[1] === 'hive' && mcp[2] === 'dispatch')
    return { icon: <Waypoints size={14} />, label: tr('tool.delegate'), summary: `${str(input.agent)}: ${str(input.task).slice(0, 90)}`, pill: join(tr('tool.delegate'), str(input.agent)), tip: `${str(input.agent)}: ${str(input.task).slice(0, 300)}`, body: <Kv rows={[[tr('tool.k.subagent'), <b key="a">{str(input.agent)}</b>], [tr('tool.k.task'), <span key="t" className="pre-wrap">{str(input.task)}</span>]]} /> };
  if (mcp?.[1] === 'hive') return { icon: <Waypoints size={14} />, label: tr('tool.roster'), summary: '', body: null };

  if (['bash', 'shell', 'executebash', 'execute', 'run', 'runcommand', 'command'].includes(n) || (input.command && n.includes('bash'))) {
    const cmd = str(pick(input, 'command', 'cmd', 'code', 'script'));
    return {
      icon: <Terminal size={14} />, label: tr('tool.shell'), kind: 'shell', command: cmd, summary: cmd, pill: `$ ${cmd.trim().split('\n')[0]}`, tip: cmd,
      body: (<>
        <div className="cmdhead"><span className="eyebrow">{tr('tool.command')}</span><CopyBtn text={cmd} label={tr('tool.copyCommand')} /></div>
        <pre className="cmd"><span className="prompt">$</span> {cmd}</pre>
        {input.description && <p className="hint" style={{ margin: '2px 0 0' }}>{str(input.description)}</p>}
        <Kv rows={[[tr('tool.k.tool'), <code key="n">{raw}</code>], [tr('tool.k.workdir'), input.cwd || input.workdir ? <code key="c">{tilde(str(input.cwd ?? input.workdir))}</code> : ''], [tr('tool.k.timeout'), input.timeout ? fmtDur(Number(input.timeout)) : ''], [tr('tool.k.background'), input.run_in_background ? tr('common.yes') : '']]} />
      </>),
    };
  }
  if (['read', 'fsread', 'view', 'cat'].includes(n)) {
    const p = str(pick(input, 'file_path', 'filePath', 'path', 'file'));
    return { icon: <FileText size={14} />, label: tr('tool.read'), summary: tilde(p) || str(input.operations ? JSON.stringify(input.operations).slice(0, 80) : ''), pill: base(p), tip: p, body: <Kv rows={[[tr('tool.k.path'), <code key="p">{p}</code>], [tr('tool.k.offset'), str(input.offset ?? '')], [tr('tool.k.limit'), str(input.limit ?? '')]]} /> };
  }
  if (['write', 'fswrite', 'create', 'writefile'].includes(n)) {
    const p = str(pick(input, 'file_path', 'filePath', 'path')); const c = str(pick(input, 'content', 'file_text', 'text'));
    return { icon: <FilePlus size={14} />, label: tr('tool.write'), summary: tr('tool.writeSummary', { path: tilde(p), count: c.split('\n').length }), pill: base(p), tip: p, body: (<><Kv rows={[[tr('tool.k.path'), <code key="p">{p}</code>]]} /><pre className="codebox">{c.slice(0, 4000)}{c.length > 4000 ? '\n…' : ''}</pre></>) };
  }
  if (['edit', 'strreplace', 'strreplaceeditor', 'patch', 'replace'].includes(n)) {
    const p = str(pick(input, 'file_path', 'filePath', 'path'));
    return { icon: <FilePen size={14} />, label: tr('tool.edit'), summary: tilde(p), pill: base(p), tip: p, body: (<><Kv rows={[[tr('tool.k.path'), <code key="p">{p}</code>], [tr('tool.k.replaceAll'), input.replace_all ? tr('common.yes') : '']]} /><Diff oldText={str(pick(input, 'old_string', 'oldString', 'old_str'))} newText={str(pick(input, 'new_string', 'newString', 'new_str'))} /></>) };
  }
  if (n === 'multiedit' && Array.isArray(input.edits)) {
    const p = str(input.file_path);
    return { icon: <FilePen size={14} />, label: tr('tool.edit'), summary: tr('tool.editSummary', { path: tilde(p), count: input.edits.length }), pill: base(p), tip: p, body: (<><Kv rows={[[tr('tool.k.path'), <code key="p">{p}</code>]]} />{input.edits.map((e: Obj, i: number) => <Diff key={i} oldText={str(e.old_string)} newText={str(e.new_string)} />)}</>) };
  }
  if (['grep', 'glob', 'search', 'find', 'ls', 'list', 'codesearch'].includes(n)) {
    const pat = str(pick(input, 'pattern', 'query', 'glob', 'path'));
    return { icon: <Search size={14} />, label: raw.charAt(0).toUpperCase() + raw.slice(1), summary: pat, pill: pat, body: <Kv rows={Object.entries(input).map(([k, v]) => [k, <code key={k}>{str(v)}</code>] as [string, ReactNode])} /> };
  }
  if (['webfetch', 'websearch', 'fetch', 'browser'].includes(n)) {
    const q = str(pick(input, 'url', 'query'));
    return { icon: <Globe size={14} />, label: raw, summary: q, pill: q, body: <Kv rows={Object.entries(input).map(([k, v]) => [k, <span key={k} className="pre-wrap">{str(v)}</span>] as [string, ReactNode])} /> };
  }
  if (['task', 'agent', 'subagent'].includes(n)) {
    return { icon: <Bot size={14} />, label: tr('tool.subagent'), summary: str(pick(input, 'description', 'subagent_type')), pill: join(tr('tool.subagent'), str(pick(input, 'description', 'subagent_type'))), body: <Kv rows={[[tr('tool.k.type'), str(input.subagent_type ?? '')], [tr('tool.k.description'), str(input.description ?? '')], [tr('tool.k.prompt'), <span key="p" className="pre-wrap">{str(input.prompt ?? '').slice(0, 1500)}</span>]]} /> };
  }
  if (n === 'todowrite' && Array.isArray(input.todos)) {
    const done = input.todos.filter((x: Obj) => x.status === 'completed').length;
    return { icon: <ListChecks size={14} />, label: tr('tool.plan'), summary: tr('tool.planSummary', { done, total: input.todos.length }), pill: join(tr('tool.plan'), tr('tool.planSummary', { done, total: input.todos.length })), body: <ul className="todos">{input.todos.map((x: Obj, i: number) => <li key={i} data-s={x.status}><i />{str(x.content)}</li>)}</ul> };
  }
  if (mcp?.[1] === 'claude-in-chrome') {
    const act = str(input.action);
    // `computer` is one tool for every click, keystroke and screenshot: the action says which.
    const detail = str(pick(input, 'url', 'query', 'text', 'ref', 'value')) || (Array.isArray(input.coordinate) ? input.coordinate.join(', ') : '');
    const nav = n === 'navigate' || n === 'tabscreatemcp' || n === 'tabscontextmcp' || n === 'tabsclosemcp';
    const label = tr(n === 'navigate' ? 'tool.chrome.navigate' : n === 'tabscreatemcp' ? 'tool.chrome.tabNew' : n === 'tabsclosemcp' ? 'tool.chrome.tabClose' : n.startsWith('tabs') ? 'tool.chrome.tabs' : n === 'computer' ? 'tool.chrome.act' : n === 'readpage' || n === 'getpagetext' ? 'tool.chrome.read' : n === 'find' ? 'tool.chrome.find' : n === 'forminput' ? 'tool.chrome.form' : n === 'javascripttool' ? 'tool.chrome.js' : 'tool.chrome.other');
    return {
      icon: nav ? <Globe size={14} /> : <MousePointerClick size={14} />, label, summary: [n === 'computer' || n === 'javascripttool' ? act.replace(/_/g, ' ') : '', detail].filter(Boolean).join(' · ').slice(0, 140),
      body: entries0(input) ? <Kv rows={Object.entries(input).filter(([k]) => k !== 'tabId').map(([k, v]) => [k, <span key={k} className="pre-wrap">{str(v)}</span>] as [string, ReactNode])} /> : null,
    };
  }
  const entries = Object.entries(input);
  return {
    icon: <Wrench size={14} />, label: mcp ? `${mcp[1]} · ${mcp[2]}` : raw, summary: entries.length ? str(entries[0][1]).slice(0, 100) : '',
    body: entries.length ? <pre className="codebox">{JSON.stringify(input, null, 2)}</pre> : null,
  };
}

/** Re-renders every half second while `active`: the live timer of a running tool. */
export function useTick(active: boolean) {
  const [, set] = useState(0);
  useEffect(() => { if (!active) return; const i = setInterval(() => set((x) => x + 1), 500); return () => clearInterval(i); }, [active]);
}

/** The exit code a shell call printed, if any. */
export const toolExit = (tool: Tool, d: Described) => (d.kind === 'shell' && tool.output !== undefined ? /(?:^|\n)Exit code:?\s*(-?\d+)/i.exec(tool.output)?.[1] : undefined);
/** A call that failed: an error, or a shell command that exited with a code other than 0. */
export const toolFailed = (tool: Tool, d = describe(tool)) => { const exit = toolExit(tool, d); return !!tool.error || (exit !== undefined && exit !== '0'); };

/** What a tool call did: its input (command, diff, path...) and, once done, its output. Shared by the card and the compact view's pill. */
export function ToolDetail({ tool, body }: { tool: Tool; body: ReactNode | null }) {
  const { t } = useI18n();
  const done = tool.output !== undefined;
  const out = tool.output ?? '';
  return (
    <div className="tbody">
      {body}
      {done && <div className="tout"><div className="cmdhead"><span className="eyebrow">{t('tool.output')}</span>{out && <CopyBtn text={out} label={t('tool.copyOutput')} />}</div><pre>{out ? (out.length > 12000 ? out.slice(0, 12000) + `\n${t('tool.truncated')}` : out) : t('tool.noOutput')}</pre></div>}
    </div>
  );
}

export function ToolCall({ tool, streaming }: { tool: Tool; streaming?: boolean }) {
  const { t } = useI18n();
  const d = describe(tool);
  const done = tool.output !== undefined;
  const running = !done && !!streaming;
  useTick(running);
  const dur = tool.durationMs ?? (running && tool.startedAt ? Date.now() - tool.startedAt : undefined);
  const out = tool.output ?? '';
  const lines = out ? out.split('\n').length : 0;
  const exit = toolExit(tool, d);
  const forced = useContext(ToolsOpen);
  const [mine, setMine] = useState(false);
  useEffect(() => { if (forced !== null) setMine(forced); }, [forced]);
  return (
    <details className={`fold tool ${d.kind === 'shell' ? 'is-shell' : ''} ${tool.error ? 'err' : ''} ${running ? 'running' : ''}`} open={mine} onToggle={(e) => setMine((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <span className="tico">{d.icon}</span>
        <b className="tlabel">{d.label}</b>
        <span className="tsum mono" title={d.command ?? d.summary}>{d.kind === 'shell' && <span className="prompt">$ </span>}{d.summary}</span>
        <span className="tmeta">
          {exit !== undefined && exit !== '0' && <span className="tbad">{t('tool.exit', { code: exit })}</span>}
          {tool.error && exit === undefined && <span className="tbad">{t('tool.failed')}</span>}
          {done && !tool.error && lines > 0 && <span>{t('tool.lines', { count: lines })}</span>}
          {dur !== undefined && <span className={running ? 'live' : ''}>{fmtDur(dur)}</span>}
          {running && <i className="dot run" />}
        </span>
        <ChevronRight size={14} className="chev" />
      </summary>
      <ToolDetail tool={tool} body={d.body} />
    </details>
  );
}


export interface ChangedFile { path: string; created: boolean; added: number; removed: number; hunks: { old: string; new: string }[]; content?: string }
const WRITES = ['write', 'fswrite', 'create', 'writefile'];
const EDITS = ['edit', 'strreplace', 'strreplaceeditor', 'patch', 'replace', 'multiedit'];
const nl = (v: unknown) => (typeof v === 'string' && v ? v.split('\n').length : 0);

/** Files the agent wrote or edited in a reply (successful calls only), one row per path. */
export function changedFiles(blocks: Block[]): ChangedFile[] {
  const out = new Map<string, ChangedFile>();
  for (const b of blocks) {
    if (b.type !== 'tool' || b.error) continue;
    const input = (b.input && typeof b.input === 'object' ? b.input : {}) as Obj;
    const n = (/^mcp__.+?__(.+)$/.exec(b.name)?.[1] ?? b.name).toLowerCase().replace(/[^a-z]/g, '');
    const isWrite = WRITES.includes(n); if (!isWrite && !EDITS.includes(n)) continue;
    const path = str(pick(input, 'file_path', 'filePath', 'path')); if (!path) continue;
    const edits: Obj[] = Array.isArray(input.edits) ? input.edits : [input];
    const added = isWrite ? nl(pick(input, 'content', 'file_text', 'text')) : edits.reduce((a, e) => a + nl(pick(e, 'new_string', 'newString', 'new_str')), 0);
    const removed = isWrite ? 0 : edits.reduce((a, e) => a + nl(pick(e, 'old_string', 'oldString', 'old_str')), 0);
    const prev = out.get(path);
    const hunks = [...(prev?.hunks ?? [])];
    if (!isWrite) for (const e of edits) hunks.push({ old: str(pick(e, 'old_string', 'oldString', 'old_str')), new: str(pick(e, 'new_string', 'newString', 'new_str')) });
    out.set(path, { path, created: (prev?.created ?? false) || isWrite, added: (prev?.added ?? 0) + added, removed: (prev?.removed ?? 0) + removed, hunks, content: isWrite ? str(pick(input, 'content', 'file_text', 'text')) : prev?.content });
  }
  return [...out.values()];
}

export function ChangedFiles({ blocks, compact = false }: { blocks: Block[]; /** a pill that starts closed (compact view) instead of a card */ compact?: boolean }) {
  const { t } = useI18n();
  const files = changedFiles(blocks);
  const forced = useContext(ToolsOpen);
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => { if (forced !== null) setOpen(forced); }, [forced]);
  if (!files.length) return null;
  if (compact) {
    const label = t('chat.changedFiles', { count: files.length });
    const added = files.reduce((a, f) => a + f.added, 0), removed = files.reduce((a, f) => a + f.removed, 0);
    return (
      <>
        <div className="pillrow">
          <button type="button" className="pill" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((o) => !o)}>
            <span className="pico"><FilePen size={13} /></span><span className="plabel">{label}</span>
            {(added > 0 || removed > 0) && <span className="pmeta">{added > 0 && <span className="cf-add">+{added}</span>}{removed > 0 && <span className="cf-del">−{removed}</span>}</span>}
          </button>
        </div>
        {open && <div id={id} role="region" aria-label={label} className="pill-detail changed"><FileList files={files} /></div>}
      </>
    );
  }
  return (
    <details className="fold changed" open={files.length <= 5}>
      <summary><FilePen size={14} />{t('chat.changedFiles', { count: files.length })}<ChevronRight size={14} className="chev" /></summary>
      <FileList files={files} />
    </details>
  );
}

function FileList({ files }: { files: ChangedFile[] }) {
  const { t } = useI18n();
  return (
    <div className="cf-list">
      {files.map((f) => (
        <details key={f.path} className="cf-file">
          <summary>
            <ChevronRight size={12} className="chev" />
            <code title={f.path}>{tilde(f.path)}</code>
            <span className="cf-meta">
              {f.created && <em>{t('chat.fileWritten')}</em>}
              {f.added > 0 && <span className="cf-add">+{f.added}</span>}
              {f.removed > 0 && <span className="cf-del">−{f.removed}</span>}
            </span>
          </summary>
          <div className="cf-body">
            {f.hunks.map((h, i) => <Diff key={i} oldText={h.old} newText={h.new} />)}
            {f.content !== undefined && f.hunks.length === 0 && <pre className="codebox">{f.content.slice(0, 6000)}{f.content.length > 6000 ? '\n…' : ''}</pre>}
          </div>
        </details>
      ))}
    </div>
  );
}
