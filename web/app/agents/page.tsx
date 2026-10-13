'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useHiveData } from '@/lib/store';
import { usePersistentState } from '@/lib/hooks/usePersistentState';
import { PROVIDERS, ago, shortPath } from '@/lib/meta';
import type { Provider, Role } from '@/lib/types';
import { Banner, EmptyState, Hex, RoleChip, SearchInput, Segmented, StatusChip } from '@/components/ui';
import { NewAgentDrawer } from '@/components/agents/NewAgentDrawer';
import { useI18n } from '@/lib/i18n';

export default function Agents() {
  const { t } = useI18n();
  const { agents, colonies, ready, error, retry } = useHiveData();
  const router = useRouter();
  const [q, setQ] = usePersistentState('hive-am.agents.q', '');
  const [role, setRole] = usePersistentState<'all' | Role>('hive-am.agents.role', 'all');
  const [prov, setProv] = usePersistentState<'all' | Provider>('hive-am.agents.provider', 'all');
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
      {!ready && error && <Banner kind="err"><div className="row gap-s wrap"><span className="grow">{t('cx.loadFailed')} {error}</span><button className="btn sm" onClick={() => void retry()}>{t('cx.retry')}</button></div></Banner>}
      <div className="row wrap agents-filters">
        <SearchInput className="grow" value={q} onChange={setQ} placeholder={t('agents.searchPlaceholder')} label={t('agents.searchLabel')} />
        <Segmented value={role} onChange={setRole} options={[{ id: 'all', label: t('common.all') }, { id: 'orchestrator', label: t('agents.filter.orchestrators') }, { id: 'worker', label: t('agents.filter.workers') }]} />
        <Segmented value={prov} onChange={setProv} options={[{ id: 'all', label: t('agents.filter.anyProvider') }, ...(Object.keys(PROVIDERS) as Provider[]).map((p) => ({ id: p, label: PROVIDERS[p].short }))]} />
      </div>
      {ready && agents.length === 0 ? (
        <EmptyState icon={<Hex size="lg" queen label="+" />} title={t('agents.empty.title')} body={t('agents.empty.body')} action={<button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} />{t('newAgent.create')}</button>} />
      ) : !ready ? (
        <div className="card comb-skel" role="status" aria-label={t('cx.loading')}><div className="skel" style={{ width: '100%', height: 48 }} /><div className="skel" style={{ width: '100%', height: 48 }} /><div className="skel" style={{ width: '100%', height: 48 }} /></div>
      ) : list.length === 0 ? (
        <EmptyState title={t('agents.noMatch.title')} body={t('agents.noMatch.body')} action={<button className="btn" onClick={() => { setQ(''); setRole('all'); setProv('all'); }}>{t('common.clearFilters')}</button>} />
      ) : (
        <div className="card table-scroll">
          <table className="table">
            <thead><tr><th>{t('agents.col.agent')}</th><th>{t('agents.col.providerModel')}</th><th>{t('form.colony')}</th><th>{t('colony.folder')}</th><th>{t('agents.col.status')}</th><th>{t('agents.col.updated')}</th></tr></thead>
            <tbody>
              {list.map((a) => {
                const open = () => router.push(`/agents/${a.id}`);
                const c = colonies.find((x) => x.id === a.colony_id);
                return (
                <tr key={a.id} className="row-link" tabIndex={0} aria-label={t('cx.openAgent', { name: a.name })} onClick={open}
                  onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } }}>
                  <td><div className="name-cell"><Hex agent={a} /><div><b><Link href={`/agents/${a.id}`} onClick={(e) => e.stopPropagation()}>{a.name}</Link></b><span>{a.description || (a.role === 'orchestrator' ? t('agents.orchestratorLine', { count: a.worker_ids.length }) : t('role.worker'))}</span></div></div></td>
                  <td><div className="fw-600">{PROVIDERS[a.provider].label}</div><span className="muted small">{a.model || t('model.cliDefault')}</span></td>
                  <td>{c ? <span className="chip"><i className="cdot cx-chip-dot" style={{ background: c.color || 'var(--honey)' }} />{c.name}</span> : <span className="muted small">—</span>}</td>
                  <td className="mono muted small">{shortPath(a.effective.cwd)}{a.effective.inherited.includes('cwd') ? ' ·' : ''}{a.effective.inherited.includes('cwd') && <span className="muted"> {t('agents.colonyWord')}</span>}</td>
                  <td><div className="row gap-s wrap"><RoleChip role={a.role} /><StatusChip status={a.status} /></div></td>
                  <td className="muted small">{ago(a.updated_at)}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {creating && <NewAgentDrawer onClose={() => setCreating(false)} />}
    </div>
  );
}
