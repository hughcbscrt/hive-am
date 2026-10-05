'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { useHive } from '@/lib/store';
import { PROVIDERS, ago, shortPath } from '@/lib/meta';
import type { Provider, Role } from '@/lib/types';
import { Hex, RoleChip, Segmented, StatusChip } from '@/components/ui';
import { NewAgentDrawer } from '@/components/NewAgentDrawer';

export default function Agents() {
  const { agents, colonies, ready } = useHive();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [role, setRole] = useState<'all' | Role>('all');
  const [prov, setProv] = useState<'all' | Provider>('all');
  const [creating, setCreating] = useState(false);
  const list = useMemo(() => agents.filter((a) =>
    (role === 'all' || a.role === role) && (prov === 'all' || a.provider === prov) &&
    (!q || `${a.name} ${a.description} ${a.cwd}`.toLowerCase().includes(q.toLowerCase()))), [agents, q, role, prov]);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Agents</h1><p>Each agent is a pointer to a native CLI session. Close the browser or lose power — reopening an agent resumes its real conversation.</p></div>
        <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} />New agent</button>
      </div>
      <div className="row wrap" style={{ marginBottom: 16 }}>
        <div className="search grow" style={{ maxWidth: 360 }}><Search size={16} /><input className="input" placeholder="Search by name, description or folder" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search agents" /></div>
        <Segmented value={role} onChange={setRole} options={[{ id: 'all', label: 'All' }, { id: 'orchestrator', label: 'Orchestrators' }, { id: 'worker', label: 'Workers' }]} />
        <Segmented value={prov} onChange={setProv} options={[{ id: 'all', label: 'Any provider' }, ...(Object.keys(PROVIDERS) as Provider[]).map((p) => ({ id: p, label: PROVIDERS[p].short }))]} />
      </div>
      {ready && agents.length === 0 ? (
        <div className="empty"><Hex size="lg" queen label="+" /><h3>No agents yet</h3><p>Pick a type to start fast, or configure one from scratch.</p><button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} />Create agent</button></div>
      ) : list.length === 0 ? (
        <div className="empty"><h3>Nothing matches</h3><p>Try a different search or clear the filters.</p><button className="btn" onClick={() => { setQ(''); setRole('all'); setProv('all'); }}>Clear filters</button></div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="table">
            <thead><tr><th>Agent</th><th>Provider · model</th><th>Colony</th><th>Folder</th><th>Status</th><th>Updated</th></tr></thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} onClick={() => router.push(`/agents/${a.id}`)}>
                  <td><div className="name-cell"><Hex agent={a} /><div><b><Link href={`/agents/${a.id}`} onClick={(e) => e.stopPropagation()}>{a.name}</Link></b><span>{a.description || (a.role === 'orchestrator' ? `Orchestrator · ${a.worker_ids.length} workers` : 'Worker')}</span></div></div></td>
                  <td><div style={{ fontWeight: 600 }}>{PROVIDERS[a.provider].label}</div><span className="muted small">{a.model || 'CLI default'}</span></td>
                  <td>{(() => { const c = colonies.find((x) => x.id === a.colony_id); return c ? <span className="chip"><i className="cdot" style={{ background: c.color || 'var(--honey)', margin: 0 }} />{c.name}</span> : <span className="muted small">—</span>; })()}</td>
                  <td className="mono muted small">{shortPath(a.effective.cwd)}{a.effective.inherited.includes('cwd') ? ' ·' : ''}{a.effective.inherited.includes('cwd') && <span className="muted"> colony</span>}</td>
                  <td><div className="row gap-s wrap"><RoleChip role={a.role} /><StatusChip status={a.status} /></div></td>
                  <td className="muted small">{ago(a.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <NewAgentDrawer onClose={() => setCreating(false)} />}
    </div>
  );
}
