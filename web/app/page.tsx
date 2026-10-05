'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Plus, Settings2, SlidersHorizontal } from 'lucide-react';
import { useHive } from '@/lib/store';
import { api } from '@/lib/api';
import { PROVIDERS, ago, shortPath } from '@/lib/meta';
import type { Agent, Colony, Dispatch } from '@/lib/types';
import { Hex, ProviderBadge, RoleChip, StatusChip, useToast } from '@/components/ui';
import { NewAgentDrawer } from '@/components/NewAgentDrawer';
import { ColonyEditor } from '@/components/ColonyEditor';
import { AgentEditDrawer } from '@/components/AgentEditDrawer';
import { HelpPopover } from '@/components/HelpPopover';
import { useAgentCard } from '@/components/AgentCard';
import { useI18n } from '@/lib/i18n';

const S = 74; // hex circumradius
const W = Math.sqrt(3) * S, H = 2 * S;
const PAD = 26;      // breathing room between the cells and the colony outline
const LABEL = 50;    // space above a cluster for its name
const GAP = 36;
const ROW_MAX = 880;
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

/** Axial coordinates in a spiral from the centre: ring 0, then ring 1, ring 2… */
function spiral(n: number): [number, number][] {
  const out: [number, number][] = [[0, 0]];
  for (let k = 1; out.length < n; k++) {
    let q = DIRS[4][0] * k, r = DIRS[4][1] * k;
    for (let side = 0; side < 6; side++) for (let i = 0; i < k; i++) { out.push([q, r]); q += DIRS[side][0]; r += DIRS[side][1]; }
  }
  return out.slice(0, n);
}
const toXY = ([q, r]: [number, number]) => ({ x: W * (q + r / 2), y: S * 1.5 * r });
const hexPoints = (cx: number, cy: number, R: number) =>
  Array.from({ length: 6 }, (_, i) => { const a = ((60 * i - 30) * Math.PI) / 180; return `${(cx + R * Math.cos(a)).toFixed(1)},${(cy + R * Math.sin(a)).toFixed(1)}`; }).join(' ');

interface Cell { agent: Agent | null; x: number; y: number }
interface Cluster { key: string; colony: Colony | null; cells: Cell[]; x: number; y: number; w: number; h: number }

/** Queens first, then the workers they connect to, then the rest — so direct connections sit close together. */
function orderMembers(members: Agent[]): Agent[] {
  const out: Agent[] = members.filter((a) => a.role === 'orchestrator');
  for (const q of [...out]) for (const id of q.worker_ids) { const w = members.find((a) => a.id === id); if (w && !out.includes(w)) out.push(w); }
  for (const a of members) if (!out.includes(a)) out.push(a);
  return out;
}

function layout(agents: Agent[], colonies: Colony[]): { clusters: Cluster[]; width: number; height: number } {
  const groups: { key: string; colony: Colony | null; members: Agent[] }[] = colonies.map((c) => ({ key: c.id, colony: c, members: agents.filter((a) => a.colony_id === c.id) }));
  groups.push({ key: 'free', colony: null, members: agents.filter((a) => !a.colony_id || !colonies.some((c) => c.id === a.colony_id)) });
  const clusters: Cluster[] = [];
  let cx = 0, cy = 0, rowH = 0, maxX = 0;
  for (const g of groups) {
    if (!g.members.length && !g.colony && agents.length > 0) continue; // no empty "free" bucket once agents exist
    const ordered = orderMembers(g.members);
    const coords = spiral(ordered.length + 1).map(toXY);
    const minX = Math.min(...coords.map((p) => p.x)) - W / 2, maxXc = Math.max(...coords.map((p) => p.x)) + W / 2;
    const minY = Math.min(...coords.map((p) => p.y)) - H / 2, maxYc = Math.max(...coords.map((p) => p.y)) + H / 2;
    const w = maxXc - minX + PAD * 2, h = maxYc - minY + PAD * 2 + LABEL;
    if (cx > 0 && cx + w > ROW_MAX) { cx = 0; cy += rowH + GAP; rowH = 0; }
    const cells: Cell[] = coords.map((p, i) => ({ agent: ordered[i] ?? null, x: cx + (p.x - minX) + PAD, y: cy + (p.y - minY) + PAD + LABEL }));
    clusters.push({ key: g.key, colony: g.colony, cells, x: cx, y: cy, w, h });
    cx += w + GAP; rowH = Math.max(rowH, h); maxX = Math.max(maxX, cx - GAP);
  }
  return { clusters, width: maxX, height: cy + rowH };
}

export default function Colony() {
  const { t } = useI18n();
  const { agents, colonies, ready, refresh } = useHive();
  const toast = useToast();
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const card = useAgentCard();
  const [creating, setCreating] = useState<{ colonyId?: string } | null>(null);
  const [editing, setEditing] = useState<Colony | 'new' | null>(null);
  const [editingAgent, setEditingAgent] = useState<string | null>(null);
  const [feed, setFeed] = useState<Dispatch[]>([]);
  useEffect(() => { const load = () => api.get<Dispatch[]>('/dispatches').then(setFeed).catch(() => undefined); load(); const iv = setInterval(load, 6000); return () => clearInterval(iv); }, []);

  const { clusters, width, height } = useMemo(() => layout(agents, colonies), [agents, colonies]);
  const margin = 40;
  // Scale the whole comb down (never up) so it always fits the panel without sideways scrolling.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth)); ro.observe(el); setAvail(el.clientWidth);
    return () => ro.disconnect();
  }, [ready, agents.length === 0]);
  const fullW = width + margin * 2, fullH = height + margin * 2;
  const k = avail ? Math.min(1, (avail - 24) / fullW) : 1;
  const pos = new Map<string, { x: number; y: number }>();
  for (const c of clusters) for (const cell of c.cells) if (cell.agent) pos.set(cell.agent.id, { x: cell.x + margin, y: cell.y + margin });
  const selected = agents.find((a) => a.id === sel) ?? null;
  // Connections of the agent under the cursor, or else the selected one, are emphasised; everything else recedes.
  const focus = hover ?? sel;
  const links = agents.filter((a) => a.role === 'orchestrator').flatMap((q) => q.worker_ids.map((w) => ({ from: q.id, to: w })));
  const related = new Set<string>(focus ? [focus, ...links.filter((l) => l.from === focus || l.to === focus).flatMap((l) => [l.from, l.to])] : []);
  const ups = (id: string) => agents.filter((q) => q.role === 'orchestrator' && q.worker_ids.includes(id));
  const running = agents.filter((a) => a.status === 'running').length;
  const queens = agents.filter((a) => a.role === 'orchestrator').length;
  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? t('colony.removedAgent');
  const selColony = selected ? colonies.find((c) => c.id === selected.colony_id) : undefined;

  const moveTo = async (a: Agent, colonyId: string) => {
    try { await api.patch(`/agents/${a.id}`, { colony_id: colonyId || null, overrides: [] }); await refresh(['agents', 'colonies']); toast(colonyId ? t('colony.joined', { name: a.name, colony: colonies.find((c) => c.id === colonyId)?.name ?? '' }) : t('colony.left', { name: a.name })); }
    catch (e) { toast(e instanceof Error ? e.message : t('colony.moveFailed'), 'err'); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><div className="row gap-s"><h1>{t('nav.colony')}</h1><HelpPopover label={t('colony.helpLabel')} title={t('colony.howTitle')}>{t('colony.howBody')}</HelpPopover></div><p>{t('colony.page.subtitle')}</p></div>
        <div className="row">
          <button className="btn" onClick={() => setEditing('new')}><Plus size={16} />{t('colony.newTitle')}</button>
          <button className="btn primary" onClick={() => setCreating({})}><Plus size={16} />{t('newAgent.title')}</button>
        </div>
      </div>
      <div className="stats">
        <div className="card stat"><b>{agents.length}</b><span>{t('stat.agents', { count: agents.length })}</span></div>
        <div className="card stat"><b>{colonies.length}</b><span>{t('stat.colonies', { count: colonies.length })}</span></div>
        <div className="card stat"><b>{queens}</b><span>{t('stat.orchestrators', { count: queens })}</span></div>
        <div className="card stat"><b>{running}</b><span>{t('stat.working')}</span></div>
        <div className="card stat"><b>{feed.filter((d) => d.status === 'running').length}</b><span>{t('stat.tasks')}</span></div>
      </div>

      <div className="colony">
        <div className="comb-wrap" ref={wrapRef}>
          {!ready ? null : agents.length === 0 && colonies.length === 0 ? (
            <div className="empty" style={{ border: 0, minHeight: 520, justifyContent: 'center' }}>
              <Hex size="lg" queen label="+" />
              <h3>{t('colony.empty.title')}</h3>
              <p>{t('colony.empty.body')}</p>
              <div className="row"><button className="btn" onClick={() => setEditing('new')}><Plus size={16} />{t('colony.empty.createColony')}</button><button className="btn primary" onClick={() => setCreating({})}><Plus size={16} />{t('colony.empty.createAgent')}</button></div>
            </div>
          ) : (
            <div style={{ width: fullW * k, height: fullH * k, flex: 'none' }}>
            <div className="comb" style={{ width: fullW, height: fullH, transform: `scale(${k})`, transformOrigin: '0 0', ['--w' as any]: `${W * 0.9}px`, ['--h' as any]: `${H * 0.9}px` }}>
              <svg className="links" width={fullW} height={fullH}>
                {/* Colony outlines: every hex is stroked wide with round joins, so only the outer edge of the union survives. */}
                {clusters.filter((c) => c.colony).map((c) => {
                  const col = c.colony!.color || 'var(--honey)';
                  return (
                    <g key={c.key}>
                      {c.cells.map((cell, i) => <polygon key={'o' + i} points={hexPoints(cell.x + margin, cell.y + margin, S)} style={{ fill: col, stroke: col }} strokeWidth={(PAD - 4) * 2} strokeLinejoin="round" />)}
                      {c.cells.map((cell, i) => <polygon key={'i' + i} points={hexPoints(cell.x + margin, cell.y + margin, S)} style={{ fill: `color-mix(in srgb, ${col} 9%, var(--surface))`, stroke: `color-mix(in srgb, ${col} 9%, var(--surface))` }} strokeWidth={(PAD - 7) * 2} strokeLinejoin="round" />)}
                    </g>
                  );
                })}
              </svg>

              {clusters.map((c) => (
                <div key={c.key + 'l'}>
                  {c.colony ? (
                    <button className="colony-label" style={{ left: c.x + c.w / 2 + margin, top: c.y + LABEL - 10 + margin, ['--c' as any]: c.colony.color || 'var(--honey)' }} onClick={() => setEditing(c.colony!)} title={c.colony.cwd ? t('colony.editHover', { path: shortPath(c.colony.cwd) }) : t('colony.editHoverShort')}>
                      <i className="cdot" />{c.colony.name}<small>{t('colony.agentCount', { count: c.cells.filter((x) => x.agent).length })}</small><Settings2 size={13} className="muted" />
                    </button>
                  ) : colonies.length > 0 && c.cells.some((x) => x.agent) ? (
                    <span className="colony-label" style={{ left: c.x + c.w / 2 + margin, top: c.y + LABEL - 10 + margin, ['--c' as any]: 'var(--line-strong)', boxShadow: 'none', background: 'transparent' }}><small>{t('common.noColony')}</small></span>
                  ) : null}
                  {c.cells.map((cell, i) => {
                    const a = cell.agent; const style = { left: cell.x + margin, top: cell.y + margin };
                    if (!a) return (
                      <button key={c.key + 'g' + i} className="cell ghost" style={style} onClick={() => setCreating({ colonyId: c.colony?.id })} aria-label={c.colony ? t('colony.addTo', { name: c.colony.name }) : t('colony.addAgent')}>
                        <svg className="ghost-hex" viewBox="0 0 100 115" preserveAspectRatio="none" aria-hidden><polygon points="50,2 98,29 98,86 50,113 2,86 2,29" /></svg><span className="label"><Plus size={18} />{t('colony.addAgent')}</span>
                      </button>
                    );
                    return (
                      <button key={a.id} className={`cell fill ${a.role === 'orchestrator' ? 'queen' : ''} ${a.status === 'running' ? 'running' : ''} ${focus && !related.has(a.id) ? 'dim' : ''} ${focus && related.has(a.id) && a.id !== focus ? 'linked' : ''}`}
                        onMouseEnter={(e) => { setHover(a.id); card.bind(a.id).onMouseEnter(e); }} onMouseLeave={() => { setHover(null); card.bind(a.id).onMouseLeave(); }} onFocus={(e) => { setHover(a.id); card.bind(a.id).onFocus(e); }} onBlur={() => { setHover(null); card.bind(a.id).onBlur(); }}
                        style={{ ...style, ['--c' as any]: PROVIDERS[a.provider].color }} aria-pressed={sel === a.id}
                        onClick={() => setSel(a.id === sel ? null : a.id)} aria-label={`${a.name}, ${t(`role.${a.role}`)}, ${PROVIDERS[a.provider].short}, ${t(`status.${a.status}`)}`}>
                        <span className="shape" />
                        <span className="label"><b>{a.name}</b><small>{PROVIDERS[a.provider].short}</small></span>
                        {a.status !== 'idle' && <span className={`pip ${a.status === 'error' ? 'err' : ''}`} />}
                        {(a.role === 'orchestrator' ? a.worker_ids.length > 0 : ups(a.id).length > 0) && (
                          <span className="ltag" title={a.role === 'orchestrator' ? t('colony.delegatesTo', { count: a.worker_ids.length }) : t('colony.connectedTo', { names: ups(a.id).map((q) => q.name).join(', ') })}>
                            {a.role === 'orchestrator' ? `↓ ${a.worker_ids.length}` : `↑ ${ups(a.id).length === 1 ? ups(a.id)[0].name : ups(a.id).length}`}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
              {/* Connections sit above the cells so they stay visible when hexes touch; ends stop at the cell borders. */}
              <svg className="links top" width={fullW} height={fullH} aria-hidden>
                {links.map((l) => {
                  const a = pos.get(l.from), b = pos.get(l.to); if (!a || !b) return null;
                  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
                  const r = S * 0.62;
                  const x1 = a.x + ux * r, y1 = a.y + uy * r, x2 = b.x - ux * r, y2 = b.y - uy * r;
                  const live = agents.find((x) => x.id === l.to)?.status === 'running';
                  const emph = !!focus && (l.from === focus || l.to === focus);
                  const dim = !!focus && !emph;
                  return (
                    <g key={l.from + l.to} opacity={dim ? 0.18 : 1}>
                      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--surface)" strokeWidth={emph ? 8 : 5} strokeLinecap="round" opacity={0.85} />
                      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--honey)" strokeWidth={emph ? 3.5 : 2.2} strokeDasharray={live ? '7 6' : emph ? undefined : '1 6'} strokeLinecap="round">
                        {live && <animate attributeName="stroke-dashoffset" from="26" to="0" dur="0.8s" repeatCount="indefinite" />}
                      </line>
                      <circle cx={x2} cy={y2} r={emph ? 5.5 : 4} fill="var(--honey)" stroke="var(--surface)" strokeWidth={2} />
                    </g>
                  );
                })}
              </svg>
            </div>
            </div>
          )}
          <div className="comb-legend">
            {(Object.keys(PROVIDERS) as (keyof typeof PROVIDERS)[]).map((p) => <span key={p} className="pbadge" style={{ '--c': PROVIDERS[p].color } as any}><i />{PROVIDERS[p].short}</span>)}
            <span className="pbadge" style={{ '--c': 'var(--honey)' } as any}><i />{t('role.orchestrator')}</span>
          </div>
        </div>

        <aside className="side">
          {selected ? (
            <div className="card card-pad col" style={{ gap: 14, position: 'relative' }}>
              <button className="btn ghost icon sm card-corner" onClick={() => setEditingAgent(selected.id)} aria-label={t('colony.settingsFor', { name: selected.name })} title={t('colony.agentSettings')}><SlidersHorizontal size={17} /></button>
              <div className="row gap-l" style={{ paddingRight: 30 }}><Hex agent={selected} size="lg" /><div className="grow"><h2 style={{ fontSize: 22 }}>{selected.name}</h2><div className="row gap-s wrap" style={{ marginTop: 6 }}><RoleChip role={selected.role} /><StatusChip status={selected.status} /></div></div></div>
              {selected.description && <p style={{ margin: 0 }}>{selected.description}</p>}
              <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', fontSize: 13.5 }}>
                <dt className="muted">{t('form.provider')}</dt><dd style={{ margin: 0 }}><ProviderBadge provider={selected.provider} /></dd>
                <dt className="muted">{t('field.model')}</dt><dd style={{ margin: 0 }}>{selected.model || t('model.cliDefault')}</dd>
                <dt className="muted">{t('colony.folder')}</dt><dd className="mono" style={{ margin: 0, wordBreak: 'break-all' }}>{shortPath(selected.effective.cwd)}{selected.effective.inherited.includes('cwd') && <span className="muted"> · {t('colony.fromColony')}</span>}</dd>
                <dt className="muted">{t('colony.session')}</dt><dd className="mono" style={{ margin: 0 }}>{selected.session_id ? selected.session_id.slice(0, 13) + '…' : t('colony.noSession')}</dd>
                {selected.role === 'orchestrator' && (<><dt className="muted">{t('form.team')}</dt><dd style={{ margin: 0 }}>{selected.worker_ids.length ? selected.worker_ids.map(name).join(', ') : t('colony.noWorkers')}</dd></>)}
              </dl>
              <div className="field"><label>{t('form.colony')}</label>
                <select className="select" value={selColony?.id ?? ''} onChange={(e) => void moveTo(selected, e.target.value)}>
                  <option value="">{t('common.noColony')}</option>{colonies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <Link className="btn primary" href={`/agents/${selected.id}`}>{t('colony.openChat')} <ArrowRight size={16} /></Link>
            </div>
          ) : null}
          <div className="card card-pad">
            <div className="row" style={{ marginBottom: 6 }}><div className="eyebrow grow">{t('colony.recent')}</div></div>
            {feed.length === 0 ? <p className="muted small" style={{ margin: 0 }}>{t('colony.recentEmpty')}</p> :
              feed.slice(0, 6).map((d) => (
                <div key={d.id} className="feed-item">
                  <i className={`dot ${d.status === 'running' ? 'run' : d.status === 'done' ? 'ok' : 'err'}`} style={{ marginTop: 7 }} />
                  <div><b>{name(d.from_id)}</b> → <b>{name(d.to_id)}</b><div className="muted small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.task}</div><div className="muted" style={{ fontSize: 12 }}>{ago(d.created_at)}</div></div>
                </div>
              ))}
          </div>
        </aside>
      </div>
      {card.node}
      {creating && <NewAgentDrawer presetColonyId={creating.colonyId} onClose={() => setCreating(null)} onCreated={(id) => setSel(id)} />}
      {editingAgent && agents.find((a) => a.id === editingAgent) && <AgentEditDrawer key={editingAgent} agent={agents.find((a) => a.id === editingAgent)!} onClose={() => setEditingAgent(null)} />}
      {editing && <ColonyEditor colony={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
