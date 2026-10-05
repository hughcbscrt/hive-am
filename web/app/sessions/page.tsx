'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useHive } from '@/lib/store';
import { PROVIDERS, ago, shortPath } from '@/lib/meta';
import { fmtCost, fmtTokens, totalTokens } from '@/lib/format';
import type { ChatMessage, Provider, SessionRow } from '@/lib/types';
import { ProviderBadge, Segmented } from '@/components/ui';

export default function Sessions() {
  const { agents } = useHive();
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [q, setQ] = useState('');
  const [prov, setProv] = useState<'all' | Provider>('all');
  const [sel, setSel] = useState<SessionRow | null>(null);
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);

  useEffect(() => { api.get<SessionRow[]>('/sessions').then(setRows).catch(() => setRows([])); }, []);
  useEffect(() => {
    setMsgs(null); if (!sel) return;
    api.get<{ messages: ChatMessage[] }>(`/agents/${sel.agent_id}/history?session=${encodeURIComponent(sel.session_id)}`).then((r) => setMsgs(r.messages)).catch(() => setMsgs([]));
  }, [sel]);

  const list = useMemo(() => (rows ?? []).filter((r) => (prov === 'all' || r.provider === prov) && (!q || `${r.agent_name} ${r.preview} ${r.cwd}`.toLowerCase().includes(q.toLowerCase()))), [rows, q, prov]);
  const byDay = useMemo(() => {
    const g = new Map<string, SessionRow[]>();
    for (const r of list) { const k = new Date(r.last_seen).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }); g.set(k, [...(g.get(k) ?? []), r]); }
    return [...g.entries()];
  }, [list]);
  const agent = sel && agents.find((a) => a.id === sel.agent_id);

  return (
    <div className="page">
      <div className="page-head"><div><h1>Sessions</h1><p>Every conversation your agents have had, read straight from Claude Code, OpenCode and Kiro. Other sessions on this machine are not shown.</p></div></div>
      <div className="row wrap" style={{ marginBottom: 16 }}>
        <div className="search grow" style={{ maxWidth: 380 }}><Search size={16} /><input className="input" placeholder="Search by agent, folder or first message" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search sessions" /></div>
        <Segmented value={prov} onChange={setProv} options={[{ id: 'all', label: 'All' }, ...(Object.keys(PROVIDERS) as Provider[]).map((p) => ({ id: p, label: PROVIDERS[p].short }))]} />
      </div>
      {rows && !rows.length ? (
        <div className="empty"><h3>No sessions yet</h3><p>Send a message to any agent and its session will appear here.</p><Link className="btn primary" href="/agents">Go to agents</Link></div>
      ) : (
        <div className="sess-grid">
          <div className="card" style={{ overflow: 'hidden' }}>
            {rows === null && <p className="muted" style={{ padding: 20 }}>Reading sessions…</p>}
            {byDay.map(([day, items]) => (
              <div key={day}>
                <div className="eyebrow" style={{ padding: '12px 16px 6px', background: 'var(--surface-2)' }}>{day}</div>
                {items.map((r) => (
                  <button key={r.agent_id + r.session_id} className="sess" aria-current={sel?.session_id === r.session_id} onClick={() => setSel(r)}>
                    <div className="row"><b style={{ fontFamily: 'var(--font-display)' }}>{r.agent_name}</b><ProviderBadge provider={r.provider} />{r.current && <span className="chip honey">Current</span>}{r.kind === 'delegation' && <span className="chip">Delegated by {r.from_name ?? 'orchestrator'}</span>}<span className="grow" /><span className="muted small">{ago(r.last_seen)}</span></div>
                    <div className="pv">{r.preview || r.task || 'Empty session'}</div>
                    <div className="muted small mono">{shortPath(r.cwd)} · {r.message_count} messages</div>
                    <div className="sessmeta">{totalTokens(r.usage) > 0 && <span>{fmtTokens(totalTokens(r.usage))} tokens</span>}{r.usage.credits ? <span>{r.usage.credits.toFixed(2)} credits</span> : null}{r.cost !== null && <span>≈ {fmtCost(r.cost)}</span>}{r.tool_calls > 0 && <span>{r.tool_calls} tool calls</span>}{r.model && <span className="mono">{r.model.replace(/^claude-/, '')}</span>}</div>
                  </button>
                ))}
              </div>
            ))}
            {rows && rows.length > 0 && !list.length && <p className="muted" style={{ padding: 20 }}>No sessions match.</p>}
          </div>
          <div className="card" style={{ position: 'sticky', top: 20, minHeight: 300 }}>
            {!sel ? <div className="empty" style={{ border: 0 }}><p>Select a session to read its transcript.</p></div> : (
              <>
                <div className="row" style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)' }}>
                  <div className="grow"><b style={{ fontFamily: 'var(--font-display)', fontSize: 17 }}>{sel.agent_name}</b><div className="muted small mono">{sel.session_id}</div></div>
                  {agent && <Link className="btn sm primary" href={`/agents/${agent.id}`}>Open agent</Link>}
                </div>
                <div className="transcript col" style={{ gap: 16 }}>
                  {msgs === null ? <p className="muted">Loading transcript…</p> : msgs.length === 0 ? <p className="muted">The CLI has no readable messages for this session.</p> : msgs.map((m) => (
                    <div key={m.id} className={`msg ${m.role}`}>
                      {m.role === 'user' ? <div className="bubble">{m.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('')}</div> :
                        m.blocks.filter((b) => b.type === 'text').map((b, i) => <div key={i} className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{(b as { text: string }).text}</ReactMarkdown></div>)}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
