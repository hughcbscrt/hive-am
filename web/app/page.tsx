'use client';
import Link from 'next/link';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Boxes, Hexagon, Maximize2, Minus, Plus, RotateCcw, Settings2, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { useHiveData } from '@/lib/store';
import { usePersistentState } from '@/lib/hooks/usePersistentState';
import { api } from '@/lib/api';
import { CLUSTER_COLOR, PROVIDERS, ago, shortPath } from '@/lib/meta';
import type { Agent, Colony, ObjectView } from '@/lib/types';
import { Banner, EmptyState, Hex, useToast } from '@/components/ui';
import { Menu, MenuItem } from '@/components/Menu';
import { NewAgentDrawer } from '@/components/agents/NewAgentDrawer';
import { ColonyEditor } from '@/components/agents/ColonyEditor';
import { AgentEditDrawer } from '@/components/agents/AgentEditDrawer';
import { DeleteAgentModal } from '@/components/agents/DeleteAgentModal';
import { HelpPopover } from '@/components/HelpPopover';
import { AgentDetails, AnchoredCard } from '@/components/agents/AgentCard';
import { useI18n } from '@/lib/i18n';
import { ObjectPanel } from '@/components/objects/ObjectPanel';
import { ObjectEditor } from '@/components/objects/ObjectEditor';
import { KIND } from '@/components/objects/meta';

const S = 74; // hex circumradius
const W = Math.sqrt(3) * S, H = 2 * S;
const PAD = 26;      // breathing room between the cells and the colony outline
const LABEL = 50;    // space above a cluster for its name
const GAP = 36;
const ROW_MAX = 880;
const ZOOM_MIN = 0.4, ZOOM_MAX = 2.5;
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

interface Cell { agent: Agent | null; object?: ObjectView; x: number; y: number }
interface Cluster { key: string; colony: Colony | null; cells: Cell[]; x: number; y: number; w: number; h: number }

/** Queens first, then the workers they connect to, then the rest, so direct connections sit close together. */
function orderMembers(members: Agent[]): Agent[] {
  const out: Agent[] = members.filter((a) => a.role === 'orchestrator');
  for (const q of [...out]) for (const id of q.worker_ids) { const w = members.find((a) => a.id === id); if (w && !out.includes(w)) out.push(w); }
  for (const a of members) if (!out.includes(a)) out.push(a);
  return out;
}

/** Where a person put things by hand: a colony (its top-left corner) or a free agent / resource (its centre), in the canvas's own pixels. */
type Place = Record<string, { x: number; y: number }>;

function layout(agents: Agent[], colonies: Colony[], objects: ObjectView[], place: Place = {}): { clusters: Cluster[]; width: number; height: number } {
  const inColony = (id: string | null) => !!id && colonies.some((c) => c.id === id);
  const groups: { key: string; colony: Colony | null; members: Agent[]; things: ObjectView[] }[] = colonies.map((c) => ({ key: c.id, colony: c, members: agents.filter((a) => a.colony_id === c.id), things: objects.filter((o) => o.colony_id === c.id) }));
  groups.push({ key: 'free', colony: null, members: agents.filter((a) => !inColony(a.colony_id)), things: objects.filter((o) => !inColony(o.colony_id)) });
  const clusters: Cluster[] = [];
  let cx = 0, cy = 0, rowH = 0;
  for (const g of groups) {
    if (!g.members.length && !g.things.length && !g.colony && agents.length + objects.length > 0) continue; // no empty "free" bucket once anything exists
    const ordered = orderMembers(g.members);
    const coords = spiral(ordered.length + g.things.length + 1).map(toXY);
    const minX = Math.min(...coords.map((p) => p.x)) - W / 2, maxXc = Math.max(...coords.map((p) => p.x)) + W / 2;
    const minY = Math.min(...coords.map((p) => p.y)) - H / 2, maxYc = Math.max(...coords.map((p) => p.y)) + H / 2;
    const w = maxXc - minX + PAD * 2, h = maxYc - minY + PAD * 2 + LABEL;
    // A colony put somewhere by hand leaves the flow: the others close up around it.
    const mine = g.colony ? place[g.key] : undefined;
    if (!mine && cx > 0 && cx + w > ROW_MAX) { cx = 0; cy += rowH + GAP; rowH = 0; }
    const x0 = mine ? mine.x : cx, y0 = mine ? mine.y : cy;
    // Agents first, then the objects of the colony, then one empty cell to add an agent.
    const cells: Cell[] = coords.map((p, i) => {
      const agent = ordered[i] ?? null, object = g.things[i - ordered.length];
      const own = !g.colony ? place[(agent ?? object)?.id ?? ''] : undefined;   // free agents and resources can each be moved
      return { agent, object, x: own ? own.x : x0 + (p.x - minX) + PAD, y: own ? own.y : y0 + (p.y - minY) + PAD + LABEL };
    });
    clusters.push({ key: g.key, colony: g.colony, cells, x: x0, y: y0, w, h });
    if (!mine) { cx += w + GAP; rowH = Math.max(rowH, h); }
  }
  // The canvas is as big as what is on it.
  let width = 0, height = 0;
  for (const c of clusters) {
    if (c.colony) { width = Math.max(width, c.x + c.w); height = Math.max(height, c.y + c.h); }
    else for (const cell of c.cells) { width = Math.max(width, cell.x + W / 2 + PAD); height = Math.max(height, cell.y + H / 2 + PAD); }
  }
  return { clusters, width, height };
}

export default function Colony() {
  const { t } = useI18n();
  const { agents, colonies, objects, dispatches: feed, ready, error, retry, refresh } = useHiveData();
  const toast = useToast();
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ colonyId?: string; manager?: boolean; objectId?: string } | null>(null);
  const [editing, setEditing] = useState<Colony | 'new' | null>(null);
  const [editingAgent, setEditingAgent] = useState<string | null>(null);
  const [creatingObject, setCreatingObject] = useState<{ colonyId?: string } | null>(null);

  // What a person dragged and how far they zoomed (both kept in this browser), and the drag in progress.
  const [place, savePlace] = usePersistentState<Place>('hive-colony-layout', {});
  const [drag, setDrag] = useState<{ key: string; x: number; y: number } | null>(null);
  const [storedZoom, setStoredZoom] = usePersistentState<number>('hive-colony-zoom', 1);
  const zoom = storedZoom >= ZOOM_MIN && storedZoom <= ZOOM_MAX ? storedZoom : 1;
  const setZoom = (z: number) => setStoredZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100)));
  const placed = useMemo(() => (drag ? { ...place, [drag.key]: { x: drag.x, y: drag.y } } : place), [place, drag]);
  const { clusters, width, height } = useMemo(() => layout(agents, colonies, objects, placed), [agents, colonies, objects, placed]);
  const margin = 40;
  // Scale the whole comb down (never up) so it always fits the panel without sideways scrolling.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth)); ro.observe(el); setAvail(el.clientWidth);
    return () => ro.disconnect();
  }, [ready, agents.length === 0]);
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const wheel = (e: WheelEvent) => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); setZoom(zoomRef.current * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); };
    el.addEventListener('wheel', wheel, { passive: false }); return () => el.removeEventListener('wheel', wheel);
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const fullW = width + margin * 2, fullH = height + margin * 2;
  // The comb always starts fitting the panel (never scaled up on its own); the zoom is on top of that.
  const fit = avail ? Math.min(1, (avail - 24) / fullW) : 1;
  const k = fit * zoom;
  const dragRef = useRef<{ key: string; sx: number; sy: number; ox: number; oy: number; min: { x: number; y: number }; moved: boolean; last?: { x: number; y: number } } | null>(null);
  const swallow = useRef(false);   // the click that ends a drag is not a click
  const startDrag = (e: React.PointerEvent<HTMLElement>, key: string, ox: number, oy: number, min = { x: 0, y: 0 }) => {
    if (e.button !== 0) return;
    dragRef.current = { key, sx: e.clientX, sy: e.clientY, ox, oy, min, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* none */ }
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return;
    const dx = (e.clientX - d.sx) / k, dy = (e.clientY - d.sy) / k;
    if (!d.moved && Math.hypot(dx, dy) * k < 6) return;
    d.moved = true; d.last = { x: Math.max(d.min.x, d.ox + dx), y: Math.max(d.min.y, d.oy + dy) };
    setDrag({ key: d.key, ...d.last });
  };
  const endDrag = () => {
    const d = dragRef.current; dragRef.current = null;
    if (!d?.moved || !d.last) return;
    swallow.current = true; setTimeout(() => { swallow.current = false; }, 0);
    savePlace({ ...place, [d.key]: d.last }); setDrag(null);
  };
  // Keyboard alternative to dragging (A12): arrows nudge the focused colony label or free hex, Shift takes bigger steps.
  const keyMove = (e: React.KeyboardEvent, key: string, ox: number, oy: number, min = { x: 0, y: 0 }) => {
    const d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[e.key];
    if (!d || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault(); const step = e.shiftKey ? 64 : 16;
    savePlace({ ...place, [key]: { x: Math.max(min.x, ox + d[0] * step), y: Math.max(min.y, oy + d[1] * step) } });
  };
  const dragProps = (key: string, ox: number, oy: number, min?: { x: number; y: number }) => ({ onPointerDown: (e: React.PointerEvent<HTMLElement>) => startDrag(e, key, ox, oy, min), onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: endDrag });
  const pos = new Map<string, { x: number; y: number }>();
  for (const c of clusters) for (const cell of c.cells) { if (cell.agent) pos.set(cell.agent.id, { x: cell.x + margin, y: cell.y + margin }); if (cell.object) pos.set(cell.object.id, { x: cell.x + margin, y: cell.y + margin }); }
  // A cluster is joined to the objects it groups.
  const clusterLinks = objects.filter((o) => o.kind === 'cluster').flatMap((b) => (b.config as { members: string[] }).members.map((m) => ({ from: b.id, to: m })));
  // An agent that looks after a resource (chosen on the resource, or from the agent's form).
  const managerLinks = objects.filter((o) => o.manager_id && pos.has(o.manager_id) && pos.has(o.id)).map((o) => ({ from: o.manager_id!, to: o.id }));
  const managedBy = (agentId: string) => objects.filter((o) => o.manager_id === agentId);
  const [deleting, setDeleting] = useState<string | null>(null);
  const selected = agents.find((a) => a.id === sel) ?? null;
  const selectedObject = objects.find((o) => o.id === sel) ?? null;
  // The card of what is selected opens beside its hex, so the element has to be found once the canvas is drawn.
  const [pinEl, setPinEl] = useState<Element | null>(null);
  useLayoutEffect(() => { setPinEl(sel ? document.querySelector(`[data-sid="${sel}"]`) : null); }, [sel, agents.length, objects.length]);
  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) setSel(null); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [sel]);
  // Connections of the agent under the cursor, or else the selected one, are emphasised; everything else recedes.
  const focus = hover ?? sel;
  const links = agents.filter((a) => a.role === 'orchestrator').flatMap((q) => q.worker_ids.map((w) => ({ from: q.id, to: w })));
  const related = new Set<string>(focus ? [focus, ...[...links, ...clusterLinks, ...managerLinks].filter((l) => l.from === focus || l.to === focus).flatMap((l) => [l.from, l.to])] : []);
  const ups = (id: string) => agents.filter((q) => q.role === 'orchestrator' && q.worker_ids.includes(id));
  const running = agents.filter((a) => a.status === 'running').length;
  const objectsUp = objects.filter((o) => o.state.status === 'running').length;
  const queens = agents.filter((a) => a.role === 'orchestrator').length;
  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? t('colony.removedAgent');
  const tasksRunning = feed.filter((d) => d.status === 'running').length;
  const stats = [
    { id: 'agents', n: agents.length, label: t('stat.agents', { count: agents.length }), href: '/agents' },
    { id: 'colonies', n: colonies.length, label: t('stat.colonies', { count: colonies.length }) },
    { id: 'objects', n: objects.length, label: t('stat.objects', { count: objects.length }), href: '/resources', title: objects.length ? t('obj.running', { count: objectsUp }) : undefined },
    { id: 'queens', n: queens, label: t('stat.orchestrators', { count: queens }), href: '/agents' },
    { id: 'working', n: running, label: t('stat.working'), href: '/agents' },
    { id: 'tasks', n: tasksRunning, label: t('stat.tasks'), href: '#recent' },
  ] as { id: string; n: number; label: string; href?: string; title?: string }[];
  const selColony = selected ? colonies.find((c) => c.id === selected.colony_id) : undefined;

  const moveTo = async (a: Agent, colonyId: string) => {
    try { await api.patch(`/agents/${a.id}`, { colony_id: colonyId || null, overrides: [] }); await refresh(['agents', 'colonies']); toast(colonyId ? t('colony.joined', { name: a.name, colony: colonies.find((c) => c.id === colonyId)?.name ?? '' }) : t('colony.left', { name: a.name })); }
    catch (e) { toast(e instanceof Error ? e.message : t('colony.moveFailed'), 'err'); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><div className="row gap-s"><h1>{t('nav.colony')}</h1><HelpPopover label={t('colony.helpLabel')} title={t('colony.howTitle')}>{t('colony.howBody')}</HelpPopover></div><p>{t('colony.page.subtitle')}</p></div>
        <div className="cx-head-actions">
          <Menu label={t('cx.new')} icon={<Plus size={14} />}>{(close) => (<>
            <MenuItem icon={<Hexagon size={15} />} onClick={() => { close(); setCreating({}); }}>{t('newAgent.title')}</MenuItem>
            <MenuItem icon={<Settings2 size={15} />} onClick={() => { close(); setEditing('new'); }}>{t('colony.newTitle')}</MenuItem>
            <MenuItem icon={<Boxes size={15} />} onClick={() => { close(); setCreatingObject({}); }}>{t('obj.new')}</MenuItem>
          </>)}</Menu>
        </div>
      </div>
      <div className="stats">
        {stats.map((x) => {
          const body = <><b>{x.n}</b><span>{x.label}</span></>;
          return x.href
            ? <Link key={x.id} href={x.href} className="card stat" title={x.title} aria-label={`${x.n} ${x.label}. ${t('cx.stat.open', { label: x.label })}`}>{body}</Link>
            : <div key={x.id} className="card stat" title={x.title}>{body}</div>;
        })}
      </div>

      <div className="colony">
        <div className="comb-wrap" ref={wrapRef}>
          {!ready ? (
            error
              ? <div className="comb-skel"><Banner kind="err"><div className="row gap-s wrap"><span className="grow">{t('cx.loadFailed')} {error}</span><button className="btn sm" onClick={() => void retry()}>{t('cx.retry')}</button></div></Banner></div>
              : <div className="comb-skel" role="status" aria-label={t('cx.loading')}><div className="skel" style={{ width: 220, height: 190 }} /><div className="row gap-l"><div className="skel" style={{ width: 150, height: 130 }} /><div className="skel" style={{ width: 150, height: 130 }} /></div></div>
          ) : agents.length === 0 && colonies.length === 0 && objects.length === 0 ? (
            <div className="comb-empty-wrap"><EmptyState icon={<Hex size="lg" queen label="+" />} title={t('colony.empty.title')} body={t('colony.empty.body')}
              action={<div className="row"><button className="btn" onClick={() => setEditing('new')}><Plus size={16} />{t('colony.empty.createColony')}</button><button className="btn primary" onClick={() => setCreating({})}><Plus size={16} />{t('colony.empty.createAgent')}</button></div>} /></div>
          ) : (
            <div className="comb-box" style={{ width: fullW * k, height: fullH * k }}>
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
                    <button className={`colony-label draggable ${drag?.key === c.key ? 'dragging' : ''}`} style={{ left: c.x + c.w / 2 + margin, top: c.y + LABEL - 10 + margin, ['--c' as any]: c.colony.color || 'var(--honey)' }} {...dragProps(c.key, c.x, c.y)} onKeyDown={(e) => keyMove(e, c.key, c.x, c.y)} onClick={() => { if (!swallow.current) setEditing(c.colony!); }} title={`${c.colony.cwd ? t('colony.editHover', { path: shortPath(c.colony.cwd) }) : t('colony.editHoverShort')} · ${t('colony.dragHint')} · ${t('cx.moveHint')}`}>
                      <i className="cdot" />{c.colony.name}<small>{t('colony.agentCount', { count: c.cells.filter((x) => x.agent).length })}</small><Settings2 size={13} className="muted" />
                    </button>
                  ) : colonies.length > 0 && c.cells.some((x) => x.agent) ? (
                    <span className="colony-label cx-unplaced" style={{ left: c.x + c.w / 2 + margin, top: c.y + LABEL - 10 + margin }}><small>{t('common.noColony')}</small></span>
                  ) : null}
                  {c.cells.map((cell, i) => {
                    const a = cell.agent; const style = { left: cell.x + margin, top: cell.y + margin };
                    const o = cell.object;
                    if (o) {
                      const { icon: Icon, color } = KIND[o.kind];
                      return (
                        <button key={o.id} data-sid={o.id} className={`cell fill obj st-${o.state.status} ${o.state.status === 'running' ? 'running' : ''} ${focus && !related.has(o.id) ? 'dim' : ''} ${focus && related.has(o.id) && o.id !== focus ? 'linked' : ''} ${c.colony ? '' : 'draggable'}`} style={{ ...style, ['--c' as any]: color }} aria-pressed={sel === o.id}
                          onMouseEnter={() => setHover(o.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(o.id)} onBlur={() => setHover(null)}
                          {...(c.colony ? {} : { ...dragProps(o.id, cell.x, cell.y, { x: W / 2, y: H / 2 }), onKeyDown: (e: React.KeyboardEvent) => keyMove(e, o.id, cell.x, cell.y, { x: W / 2, y: H / 2 }) })}
                          onClick={() => { if (!swallow.current) setSel(o.id === sel ? null : o.id); }} aria-label={`${o.name}, ${t(`obj.kind.${o.kind}`)}, ${t(`obj.status.${o.state.status}`)}`} title={o.state.detail ? `${t(`obj.status.${o.state.status}`)}: ${o.state.detail}` : t(`obj.status.${o.state.status}`)}>
                          <span className="shape" />
                          <span className="label"><Icon size={16} /><b>{o.name}</b><small>{t(`obj.status.${o.state.status}`)}</small></span>
                          <span className={`pip o-${o.state.status}`} />
                          {o.manager_id && <span className="ltag top mgr" title={t('colony.managedBy', { name: name(o.manager_id) })}>⚙ {name(o.manager_id)}</span>}
                        </button>
                      );
                    }
                    if (!a) return (
                      <button key={c.key + 'g' + i} className="cell ghost" style={style} onClick={() => setCreating({ colonyId: c.colony?.id })} aria-label={c.colony ? t('colony.addTo', { name: c.colony.name }) : t('colony.addAgent')}>
                        <svg className="ghost-hex" viewBox="0 0 100 115" preserveAspectRatio="none" aria-hidden><polygon points="50,2 98,29 98,86 50,113 2,86 2,29" /></svg><span className="label"><Plus size={18} />{t('colony.addAgent')}</span>
                      </button>
                    );
                    return (
                      <button key={a.id} data-sid={a.id} className={`cell fill ${a.role === 'orchestrator' ? 'queen' : ''} ${a.status === 'running' ? 'running' : ''} ${focus && !related.has(a.id) ? 'dim' : ''} ${focus && related.has(a.id) && a.id !== focus ? 'linked' : ''} ${c.colony ? '' : 'draggable'}`}
                        onMouseEnter={() => setHover(a.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(a.id)} onBlur={() => setHover(null)}
                        style={{ ...style, ['--c' as any]: PROVIDERS[a.provider].color }} aria-pressed={sel === a.id}
                        {...(c.colony ? {} : { ...dragProps(a.id, cell.x, cell.y, { x: W / 2, y: H / 2 }), onKeyDown: (e: React.KeyboardEvent) => keyMove(e, a.id, cell.x, cell.y, { x: W / 2, y: H / 2 }), title: t('cx.moveHint') })}
                        onClick={() => { if (!swallow.current) setSel(a.id === sel ? null : a.id); }} aria-label={`${a.name}, ${t(`role.${a.role}`)}, ${PROVIDERS[a.provider].short}, ${t(`status.${a.status}`)}`}>
                        <span className="shape" />
                        <span className="label"><b>{a.name}</b><small>{PROVIDERS[a.provider].short}</small></span>
                        {a.status !== 'idle' && <span className={`pip ${a.status === 'error' ? 'err' : ''}`} />}
                        {managedBy(a.id).length > 0 && (
                          <span className="ltag top mgr" title={t('colony.manages', { names: managedBy(a.id).map((x) => x.name).join(', ') })}>⚙ {managedBy(a.id).length === 1 ? managedBy(a.id)[0].name : managedBy(a.id).length}</span>
                        )}
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
              {/* Connections sit above the cells and show for what is under the cursor or selected (the tags on the hexes say who is connected the rest of the time); ends stop at the cell borders. */}
              <svg className="links top" width={fullW} height={fullH} aria-hidden>
                {links.filter((l) => !!focus && (l.from === focus || l.to === focus)).map((l) => {
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
                {[...clusterLinks.map((l) => ({ ...l, kind: 'cluster' as const })), ...managerLinks.map((l) => ({ ...l, kind: 'manager' as const }))].filter((l) => !!focus && (l.from === focus || l.to === focus)).map((l) => {
                  const a = pos.get(l.from), b = pos.get(l.to); if (!a || !b) return null;
                  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, r = S * 0.62;
                  const color = l.kind === 'cluster' ? CLUSTER_COLOR : 'var(--link-manager)';
                  return (
                    <g key={l.kind + l.from + l.to}>
                      <line x1={a.x + ux * r} y1={a.y + uy * r} x2={b.x - ux * r} y2={b.y - uy * r} stroke="var(--surface)" strokeWidth={8} strokeLinecap="round" opacity={0.9} />
                      <line x1={a.x + ux * r} y1={a.y + uy * r} x2={b.x - ux * r} y2={b.y - uy * r} stroke={color} strokeWidth={3} strokeDasharray={l.kind === 'cluster' ? '3 5' : '8 5'} strokeLinecap="round" />
                      <circle cx={b.x - ux * r} cy={b.y - uy * r} r={5} fill={color} stroke="var(--surface)" strokeWidth={2} />
                    </g>
                  );
                })}
              </svg>
            </div>
            </div>
          )}
          <div className="comb-zoom" role="group" aria-label={t('colony.zoom')}>
            {Object.keys(place).length > 0 && <button className="btn ghost icon sm" onClick={() => savePlace({})} title={t('colony.layout.reset')} aria-label={t('colony.layout.reset')}><RotateCcw size={14} /></button>}
            <button className="btn ghost icon sm" onClick={() => setZoom(zoom / 1.2)} disabled={zoom <= ZOOM_MIN} title={t('colony.zoom.out')} aria-label={t('colony.zoom.out')}><Minus size={14} /></button>
            <button className="btn ghost sm zoom-pct" onClick={() => setZoom(1)} title={t('colony.zoom.fit')} aria-label={t('colony.zoom.fit')}>{Math.round(zoom * 100)}%</button>
            <button className="btn ghost icon sm" onClick={() => setZoom(zoom * 1.2)} disabled={zoom >= ZOOM_MAX} title={t('colony.zoom.in')} aria-label={t('colony.zoom.in')}><Plus size={14} /></button>
            <button className="btn ghost icon sm" onClick={() => setZoom(1)} title={t('colony.zoom.fit')} aria-label={t('colony.zoom.fit')}><Maximize2 size={14} /></button>
          </div>
          <div className="comb-legend">
            {(Object.keys(PROVIDERS) as (keyof typeof PROVIDERS)[]).map((p) => <span key={p} className="pbadge" style={{ '--c': PROVIDERS[p].color } as any}><i />{PROVIDERS[p].short}</span>)}
            <span className="pbadge" style={{ '--c': 'var(--honey)' } as any}><i />{t('role.orchestrator')}</span>
          </div>
        </div>

          {selectedObject ? <ObjectPanel key={selectedObject.id} object={selectedObject} target={pinEl} onClose={() => setSel(null)} onCreateManager={() => setCreating({ colonyId: selectedObject.colony_id ?? undefined, manager: true, objectId: selectedObject.id })} /> : selected ? (
            <AnchoredCard key={selected.id} target={pinEl} pinned width={340} label={selected.name} onClose={() => setSel(null)}>
              <div className="ap-corner row gap-s"><button className="btn ghost icon sm" onClick={() => setEditingAgent(selected.id)} aria-label={t('colony.settingsFor', { name: selected.name })} title={t('colony.agentSettings')}><SlidersHorizontal size={16} /></button><button className="btn ghost icon sm" onClick={() => setSel(null)} aria-label={t('common.close')} title={`${t('common.close')} (Esc)`}><X size={16} /></button></div>
              <AgentDetails agent={selected} hideColony />
              <div className="field ap-pin-field"><label>{t('form.colony')}</label>
                <select className="select" value={selColony?.id ?? ''} onChange={(e) => void moveTo(selected, e.target.value)}>
                  <option value="">{t('common.noColony')}</option>{colonies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="row ap-pin-actions">
                <Link className="btn primary grow" href={`/agents/${selected.id}`}>{t('colony.openChat')} <ArrowRight size={16} /></Link>
                <button className="btn danger icon" onClick={() => setDeleting(selected.id)} aria-label={t('agent.delete')} title={t('agent.delete')}><Trash2 size={16} /></button>
              </div>
            </AnchoredCard>
          ) : null}
      </div>
      <div className="card card-pad recent" id="recent">
        <div className="eyebrow recent-head">{t('colony.recent')}</div>
        {feed.length === 0 ? <p className="muted small m0">{t('colony.recentEmpty')}</p> :
          <div className="recent-grid">{feed.slice(0, 6).map((d) => (
            <div key={d.id} className="feed-item">
              <i className={`dot ${d.status === 'running' ? 'run' : d.status === 'done' ? 'ok' : 'err'}`} />
              <div>
                <div className="feed-line">{agents.some((x) => x.id === d.from_id) ? <Link href={`/agents/${d.from_id}`} aria-label={t('cx.openAgent', { name: name(d.from_id) })}>{name(d.from_id)}</Link> : <b>{name(d.from_id)}</b>} → {agents.some((x) => x.id === d.to_id) ? <Link href={`/agents/${d.to_id}`} aria-label={t('cx.openAgent', { name: name(d.to_id) })}>{name(d.to_id)}</Link> : <b>{name(d.to_id)}</b>}</div>
                <div className="muted small ellipsis">{d.task}</div>
                <div className="muted feed-when">{ago(d.created_at)}</div>
              </div>
            </div>
          ))}</div>}
      </div>
      {deleting && agents.find((a) => a.id === deleting) && <DeleteAgentModal agent={agents.find((a) => a.id === deleting)!} onClose={() => setDeleting(null)} onDeleted={() => setSel(null)} />}
      {creating && <NewAgentDrawer presetColonyId={creating.colonyId} presetObjectId={creating.objectId} manager={creating.manager} onClose={() => setCreating(null)} onCreated={(id) => setSel(id)} />}
      {editingAgent && agents.find((a) => a.id === editingAgent) && <AgentEditDrawer key={editingAgent} agent={agents.find((a) => a.id === editingAgent)!} onClose={() => setEditingAgent(null)} />}
      {creatingObject && <ObjectEditor presetColonyId={creatingObject.colonyId} onClose={() => setCreatingObject(null)} onSaved={(id) => setSel(id)} />}
      {editing && <ColonyEditor colony={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
