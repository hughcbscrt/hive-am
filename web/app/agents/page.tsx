'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { useHive } from '@/lib/store';
import { PROVIDERS, ago, shortPath } from '@/lib/meta';
import type { Provider, Role } from '@/lib/types';
import { Hex, RoleChip, Segmented, StatusChip } from '@/components/ui';
import { NewAgentDrawer } from '@/components/agents/NewAgentDrawer';
import { useI18n } from '@/lib/i18n';

export default function Agents() {
  const { t } = useI18n();
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
        <div><h1>{t('nav.agents')}</h1><p>{t('agents.subtitle')}</p></div>
        <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} />{t('newAgent.title')}</button>
      </div>
      <div className="row wrap" style={{ marginBottom: 16 }}>
        <div className="search grow" style={{ maxWidth: 360 }}><Search size={16} /><input className="input" placeholder={t('agents.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('agents.searchLabel')} /></div>
        <Segmented value={role} onChange={setRole} options={[{ id: 'all', label: t('common.all') }, { id: 'orchestrator', label: t('agents.filter.orchestrators') }, { id: 'worker', label: t('agents.filter.workers') }]} />
        <Segmented value={prov} onChange={setProv} options={[{ id: 'all', label: t('agents.filter.anyProvider') }, ...(Object.keys(PROVIDERS) as Provider[]).map((p) => ({ id: p, label: PROVIDERS[p].short }))]} />
      </div>
      {ready && agents.length === 0 ? (
        <div className="empty"><Hex size="lg" queen label="+" /><h3>{t('agents.empty.title')}</h3><p>{t('agents.empty.body')}</p><button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} />{t('newAgent.create')}</button></div>
      ) : list.length === 0 ? (
        <div className="empty"><h3>{t('agents.noMatch.title')}</h3><p>{t('agents.noMatch.body')}</p><button className="btn" onClick={() => { setQ(''); setRole('all'); setProv('all'); }}>{t('common.clearFilters')}</button></div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="table">
            <thead><tr><th>{t('agents.col.agent')}</th><th>{t('agents.col.providerModel')}</th><th>{t('form.colony')}</th><th>{t('colony.folder')}</th><th>{t('agents.col.status')}</th><th>{t('agents.col.updated')}</th></tr></thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} onClick={() => router.push(`/agents/${a.id}`)}>
                  <td><div className="name-cell"><Hex agent={a} /><div><b><Link href={`/agents/${a.id}`} onClick={(e) => e.stopPropagation()}>{a.name}</Link></b><span>{a.description || (a.role === 'orchestrator' ? t('agents.orchestratorLine', { count: a.worker_ids.length }) : t('role.worker'))}</span></div></div></td>
                  <td><div style={{ fontWeight: 600 }}>{PROVIDERS[a.provider].label}</div><span className="muted small">{a.model || t('model.cliDefault')}</span></td>
                  <td>{(() => { const c = colonies.find((x) => x.id === a.colony_id); return c ? <span className="chip"><i className="cdot" style={{ background: c.color || 'var(--honey)', margin: 0 }} />{c.name}</span> : <span className="muted small">—</span>; })()}</td>
                  <td className="mono muted small">{shortPath(a.effective.cwd)}{a.effective.inherited.includes('cwd') ? ' ·' : ''}{a.effective.inherited.includes('cwd') && <span className="muted"> {t('agents.colonyWord')}</span>}</td>
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
