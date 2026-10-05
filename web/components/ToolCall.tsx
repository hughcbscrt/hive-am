'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Bot, Check, ChevronRight, Copy, FilePen, FilePlus, FileText, Globe, ListChecks, Search, Terminal, Waypoints, Wrench } from 'lucide-react';
import { fmtDur } from '@/lib/format';
import type { Block } from '@/lib/types';

type Tool = Extract<Block, { type: 'tool' }>;
type Obj = Record<string, any>;

interface Described { icon: ReactNode; label: string; summary: string; body: ReactNode | null; kind?: 'shell'; command?: string }

/** Lets the chat expand or collapse every tool row at once. null = each row decides for itself. */
export const ToolsOpen = createContext<boolean | null>(null);

const tilde = (p: string) => p.replace(/^\/home\/[^/]+/, '~');

export function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="copybtn" aria-label={label} title={label}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1200); }).catch(() => undefined); }}>
      {ok ? <Check size={13} /> : <Copy size={13} />}{ok ? 'Copied' : label}
    </button>
  );
}

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

/** Turn a provider-specific tool call (Claude / OpenCode / Kiro naming) into something readable. */
export function describe(t: Tool): Described {
  const input = (t.input && typeof t.input === 'object' ? t.input : {}) as Obj;
  const raw = t.name;
  const mcp = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(raw);
  const n = (mcp ? mcp[2] : raw).toLowerCase().replace(/[^a-z]/g, '');

  if (mcp?.[1] === 'hive' && mcp[2] === 'dispatch')
    return { icon: <Waypoints size={14} />, label: 'Delegate', summary: `${str(input.agent)} — ${str(input.task).slice(0, 90)}`, body: <Kv rows={[['Subagent', <b key="a">{str(input.agent)}</b>], ['Task', <span key="t" className="pre-wrap">{str(input.task)}</span>]]} /> };
  if (mcp?.[1] === 'hive') return { icon: <Waypoints size={14} />, label: 'Team roster', summary: '', body: null };

  if (['bash', 'shell', 'executebash', 'execute', 'run', 'runcommand', 'command'].includes(n) || (input.command && n.includes('bash'))) {
    const cmd = str(pick(input, 'command', 'cmd', 'code', 'script'));
    return {
      icon: <Terminal size={14} />, label: 'Shell', kind: 'shell', command: cmd, summary: cmd,
      body: (<>
        <div className="cmdhead"><span className="eyebrow">Command</span><CopyBtn text={cmd} label="Copy command" /></div>
        <pre className="cmd"><span className="prompt">$</span> {cmd}</pre>
        {input.description && <p className="hint" style={{ margin: '2px 0 0' }}>{str(input.description)}</p>}
        <Kv rows={[['Tool', <code key="n">{raw}</code>], ['Working dir', input.cwd || input.workdir ? <code key="c">{tilde(str(input.cwd ?? input.workdir))}</code> : ''], ['Timeout', input.timeout ? fmtDur(Number(input.timeout)) : ''], ['Background', input.run_in_background ? 'yes' : '']]} />
      </>),
    };
  }
  if (['read', 'fsread', 'view', 'cat'].includes(n)) {
    const p = str(pick(input, 'file_path', 'filePath', 'path', 'file'));
    return { icon: <FileText size={14} />, label: 'Read', summary: tilde(p) || str(input.operations ? JSON.stringify(input.operations).slice(0, 80) : ''), body: <Kv rows={[['Path', <code key="p">{p}</code>], ['Offset', str(input.offset ?? '')], ['Limit', str(input.limit ?? '')]]} /> };
  }
  if (['write', 'fswrite', 'create', 'writefile'].includes(n)) {
    const p = str(pick(input, 'file_path', 'filePath', 'path')); const c = str(pick(input, 'content', 'file_text', 'text'));
    return { icon: <FilePlus size={14} />, label: 'Write', summary: `${tilde(p)} · ${c.split('\n').length} lines`, body: (<><Kv rows={[['Path', <code key="p">{p}</code>]]} /><pre className="codebox">{c.slice(0, 4000)}{c.length > 4000 ? '\n…' : ''}</pre></>) };
  }
  if (['edit', 'strreplace', 'strreplaceeditor', 'patch', 'replace'].includes(n)) {
    const p = str(pick(input, 'file_path', 'filePath', 'path'));
    return { icon: <FilePen size={14} />, label: 'Edit', summary: tilde(p), body: (<><Kv rows={[['Path', <code key="p">{p}</code>], ['Replace all', input.replace_all ? 'yes' : '']]} /><Diff oldText={str(pick(input, 'old_string', 'oldString', 'old_str'))} newText={str(pick(input, 'new_string', 'newString', 'new_str'))} /></>) };
  }
  if (n === 'multiedit' && Array.isArray(input.edits)) {
    const p = str(input.file_path);
    return { icon: <FilePen size={14} />, label: 'Edit', summary: `${tilde(p)} · ${input.edits.length} changes`, body: (<><Kv rows={[['Path', <code key="p">{p}</code>]]} />{input.edits.map((e: Obj, i: number) => <Diff key={i} oldText={str(e.old_string)} newText={str(e.new_string)} />)}</>) };
  }
  if (['grep', 'glob', 'search', 'find', 'ls', 'list', 'codesearch'].includes(n)) {
    const pat = str(pick(input, 'pattern', 'query', 'glob', 'path'));
    return { icon: <Search size={14} />, label: raw.charAt(0).toUpperCase() + raw.slice(1), summary: pat, body: <Kv rows={Object.entries(input).map(([k, v]) => [k, <code key={k}>{str(v)}</code>] as [string, ReactNode])} /> };
  }
  if (['webfetch', 'websearch', 'fetch', 'browser'].includes(n)) {
    const q = str(pick(input, 'url', 'query'));
    return { icon: <Globe size={14} />, label: raw, summary: q, body: <Kv rows={Object.entries(input).map(([k, v]) => [k, <span key={k} className="pre-wrap">{str(v)}</span>] as [string, ReactNode])} /> };
  }
  if (['task', 'agent', 'subagent'].includes(n)) {
    return { icon: <Bot size={14} />, label: 'Subagent', summary: str(pick(input, 'description', 'subagent_type')), body: <Kv rows={[['Type', str(input.subagent_type ?? '')], ['Description', str(input.description ?? '')], ['Prompt', <span key="p" className="pre-wrap">{str(input.prompt ?? '').slice(0, 1500)}</span>]]} /> };
  }
  if (n === 'todowrite' && Array.isArray(input.todos)) {
    const done = input.todos.filter((x: Obj) => x.status === 'completed').length;
    return { icon: <ListChecks size={14} />, label: 'Plan', summary: `${done}/${input.todos.length} done`, body: <ul className="todos">{input.todos.map((x: Obj, i: number) => <li key={i} data-s={x.status}><i />{str(x.content)}</li>)}</ul> };
  }
  const entries = Object.entries(input);
  return {
    icon: <Wrench size={14} />, label: mcp ? `${mcp[1]} · ${mcp[2]}` : raw, summary: entries.length ? str(entries[0][1]).slice(0, 100) : '',
    body: entries.length ? <pre className="codebox">{JSON.stringify(input, null, 2)}</pre> : null,
  };
}

function useTick(active: boolean) {
  const [, set] = useState(0);
  useEffect(() => { if (!active) return; const i = setInterval(() => set((x) => x + 1), 500); return () => clearInterval(i); }, [active]);
}

export function ToolCall({ tool, streaming }: { tool: Tool; streaming?: boolean }) {
  const d = describe(tool);
  const done = tool.output !== undefined;
  const running = !done && !!streaming;
  useTick(running);
  const dur = tool.durationMs ?? (running && tool.startedAt ? Date.now() - tool.startedAt : undefined);
  const out = tool.output ?? '';
  const lines = out ? out.split('\n').length : 0;
  const exit = d.kind === 'shell' && done ? /(?:^|\n)Exit code:?\s*(-?\d+)/i.exec(out)?.[1] : undefined;
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
          {exit !== undefined && exit !== '0' && <span className="tbad">exit {exit}</span>}
          {tool.error && exit === undefined && <span className="tbad">failed</span>}
          {done && !tool.error && lines > 0 && <span>{lines} {lines === 1 ? 'line' : 'lines'}</span>}
          {dur !== undefined && <span className={running ? 'live' : ''}>{fmtDur(dur)}</span>}
          {running && <i className="dot run" />}
        </span>
        <ChevronRight size={14} className="chev" />
      </summary>
      <div className="tbody">
        {d.body}
        {done && <div className="tout"><div className="cmdhead"><span className="eyebrow">Output</span>{out && <CopyBtn text={out} label="Copy output" />}</div><pre>{out ? (out.length > 12000 ? out.slice(0, 12000) + '\n… (truncated)' : out) : '(no output)'}</pre></div>}
      </div>
    </details>
  );
}
