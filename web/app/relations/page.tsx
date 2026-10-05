'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, BaseEdge, Controls, EdgeLabelRenderer, getBezierPath, Handle, Position, ReactFlow, applyNodeChanges,
  type Connection, type Edge, type EdgeProps, type Node, type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { LayoutGrid, X } from 'lucide-react';
import { useHive } from '@/lib/store';
import { api } from '@/lib/api';
import { PROVIDERS } from '@/lib/meta';
import type { Agent } from '@/lib/types';
import { Hex, useToast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

/** One colour per orchestrator, so overlapping lines can still be told apart. */
const LINE_COLORS = ['#e8a317', '#2f5bea', '#c0399a', '#0f8f9e', '#7a4de0', '#d4663f', '#2f8f5b', '#9a7400'];
const STORE_KEY = 'hive-rel-pos-v2';
const GAP_X = 190, ROW_Y = 280;

interface NodeData extends Record<string, unknown> { agent: Agent; dim: boolean; active: boolean }
interface EdgeData extends Record<string, unknown> { color: string; dim: boolean; active: boolean; show: boolean; label: string; onRemove: () => void }

function AgentNode({ data }: { data: NodeData }) {
  const { t } = useI18n();
  const a = data.agent;
  return (
    <div className={`rnode ${data.dim ? 'dim' : ''} ${data.active ? 'active' : ''}`}>
      {a.role === 'worker' && <Handle type="target" position={Position.Top} />}
      <Hex agent={a} />
      <b>{a.name}</b>
      <small>{a.role === 'orchestrator' ? t('role.orchestrator') : PROVIDERS[a.provider].short}</small>
      {a.role === 'orchestrator' && <Handle type="source" position={Position.Bottom} />}
    </div>
  );
}

/** A line with a ✕ in the middle: one click to disconnect. */
function LinkEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<EdgeData>>) {
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.35 });
  const d = data!;
  return (
    <>
      <BaseEdge id={id} path={path} interactionWidth={26} style={{ stroke: d.color, strokeWidth: d.active ? 4 : 2.5, opacity: d.dim ? 0.15 : 1, transition: 'opacity .15s, stroke-width .15s' }} />
      {d.show && (
        <EdgeLabelRenderer>
          <button className="edge-x nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }} onClick={d.onRemove} aria-label={d.label} title={d.label}><X size={13} strokeWidth={3} /></button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { agent: AgentNode };
const edgeTypes = { link: LinkEdge };

/** Orchestrators on top; each one's workers in a row beneath it. Workers nobody directs go to the far right. */
function autoLayout(agents: Agent[]): Record<string, { x: number; y: number }> {
  const qs = agents.filter((a) => a.role === 'orchestrator');
  const ws = agents.filter((a) => a.role === 'worker');
  const owner = (w: Agent) => qs.find((q) => q.worker_ids.includes(w.id));
  const out: Record<string, { x: number; y: number }> = {};
  let x = 0;
  for (const q of qs) {
    const mine = ws.filter((w) => owner(w)?.id === q.id);
    const n = Math.max(1, mine.length);
    mine.forEach((w, i) => (out[w.id] = { x: x + i * GAP_X, y: ROW_Y }));
    out[q.id] = { x: x + ((n - 1) * GAP_X) / 2, y: 0 };
    x += n * GAP_X + GAP_X * 0.6;
  }
  ws.filter((w) => !owner(w)).forEach((w, i) => (out[w.id] = { x: x + i * GAP_X, y: ROW_Y }));
  return out;
}

export default function Relations() {
  const { t, locale } = useI18n();
  const { agents, refresh, ready } = useHive();
  const toast = useToast();
  const [dragged, setDragged] = useState<Record<string, { x: number; y: number }>>({});
  const [nodes, setNodes] = useState<Node<NodeData>[]>([]);
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const loaded = useRef(false);

  useEffect(() => { try { setDragged(JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}')); } catch { /* ignore */ } loaded.current = true; }, []);

  const layout = useMemo(() => autoLayout(agents), [agents]);
  useEffect(() => {
    setNodes(agents.map((a) => ({ id: a.id, type: 'agent', position: dragged[a.id] ?? layout[a.id] ?? { x: 0, y: 0 }, data: { agent: a, dim: false, active: false } })));
  }, [agents, layout, dragged]);

  const qIndex = useMemo(() => new Map(agents.filter((a) => a.role === 'orchestrator').map((q, i) => [q.id, i])), [agents]);
  const focus = hoverNode ?? sel;
  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? '?';

  const assign = useCallback(async (qid: string, ids: string[], msg: string) => {
    try { await api.put(`/orchestrators/${qid}/workers`, { worker_ids: ids }); await refresh(['agents']); toast(msg); }
    catch (e) { toast(e instanceof Error ? e.message : t('rel.updateFailed'), 'err'); }
  }, [refresh, toast]);
  const disconnect = useCallback((qid: string, wid: string) => {
    const q = agents.find((a) => a.id === qid); if (!q) return;
    void assign(qid, q.worker_ids.filter((w) => w !== wid), t('rel.disconnected', { worker: name(wid), orchestrator: q.name }));
  }, [agents, assign]); // eslint-disable-line react-hooks/exhaustive-deps
  const connect = useCallback((qid: string, wid: string) => {
    const q = agents.find((a) => a.id === qid); if (!q || q.worker_ids.includes(wid)) return;
    void assign(qid, [...q.worker_ids, wid], t('rel.connected', { worker: name(wid), orchestrator: q.name }));
  }, [agents, assign]); // eslint-disable-line react-hooks/exhaustive-deps

  const edges: Edge<EdgeData>[] = useMemo(() => agents.filter((a) => a.role === 'orchestrator').flatMap((q) => q.worker_ids.map((w) => {
    const id = `${q.id}>${w}`;
    const related = !!focus && (q.id === focus || w === focus);
    return {
      id, source: q.id, target: w, type: 'link' as const, animated: agents.find((x) => x.id === w)?.status === 'running',
      data: { color: LINE_COLORS[(qIndex.get(q.id) ?? 0) % LINE_COLORS.length], dim: !!focus && !related, active: related || hoverEdge === id, show: related || hoverEdge === id, label: t('rel.disconnectLabel', { worker: name(w), orchestrator: q.name }), onRemove: () => disconnect(q.id, w) },
    };
  })), [agents, focus, hoverEdge, qIndex, disconnect, locale]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const rel = new Set<string>(focus ? [focus] : []);
    if (focus) for (const e of edges) if (e.source === focus || e.target === focus) { rel.add(e.source); rel.add(e.target); }
    return nodes.map((n) => ({ ...n, selected: n.id === sel, data: { ...n.data, dim: !!focus && !rel.has(n.id), active: n.id === focus } }));
  }, [nodes, edges, focus, sel]);

  const onNodesChange = useCallback((c: NodeChange<Node<NodeData>>[]) => {
    setNodes((n) => applyNodeChanges(c, n));
    const done = c.filter((x) => x.type === 'position' && !x.dragging && x.position);
    if (done.length) setDragged((d) => { const next = { ...d }; for (const x of done) if (x.type === 'position' && x.position) next[x.id] = x.position; try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* ignore */ } return next; });
  }, []);
  const arrange = () => { setDragged({}); try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ } setFitKey((k) => k + 1); toast(t('rel.layoutReset')); };
  const onConnect = (c: Connection) => { if (c.source && c.target) connect(c.source, c.target); };

  const selected = agents.find((a) => a.id === sel);
  const orchestrators = agents.filter((a) => a.role === 'orchestrator');
  const workers = agents.filter((a) => a.role === 'worker');

  return (
    <div className="page full rel">
      <div className="rel-hud"><h1>{t('nav.relations')}</h1><p>{t('rel.hud')}</p></div>
      <div className="rel-tools"><button className="btn sm" onClick={arrange}><LayoutGrid size={14} />{t('rel.autoArrange')}</button></div>

      {ready && agents.length === 0 ? (
        <div className="empty" style={{ margin: '140px auto', maxWidth: 420, background: 'var(--surface)' }}><h3>{t('rel.empty.title')}</h3><p>{t('rel.empty.body')}</p></div>
      ) : (
        <ReactFlow key={fitKey} nodes={shown} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          onNodesChange={onNodesChange} onConnect={onConnect}
          onNodeMouseEnter={(_, n) => setHoverNode(n.id)} onNodeMouseLeave={() => setHoverNode(null)} onNodeClick={(_, n) => setSel((s) => (s === n.id ? null : n.id))} onPaneClick={() => setSel(null)}
          onEdgeMouseEnter={(_, e) => setHoverEdge(e.id)} onEdgeMouseLeave={() => setHoverEdge(null)}
          fitView fitViewOptions={{ padding: 0.35, maxZoom: 1.1 }} minZoom={0.3} proOptions={{ hideAttribution: true }} deleteKeyCode={null} nodesConnectable>
          <Background gap={28} color="var(--line-strong)" />
          <Controls showInteractive={false} />
        </ReactFlow>
      )}

      {selected && (
        <aside className="rel-panel card">
          <div className="row gap-l"><Hex agent={selected} /><div className="grow"><b style={{ fontFamily: 'var(--font-display)', fontSize: 17 }}>{selected.name}</b><div className="muted small">{t(`role.${selected.role}`)}</div></div>
            <button className="btn ghost icon sm" onClick={() => setSel(null)} aria-label={t('common.close')}><X size={16} /></button></div>
          {selected.role === 'orchestrator' ? (
            <>
              <div className="eyebrow">{t('rel.delegatesTo', { count: selected.worker_ids.length })}</div>
              {selected.worker_ids.length === 0 && <p className="muted small" style={{ margin: 0 }}>{t('rel.noWorkers')}</p>}
              {selected.worker_ids.map((w) => (
                <div key={w} className="relrow"><span className="grow">{name(w)}</span><button className="btn sm" onClick={() => disconnect(selected.id, w)}>{t('rel.disconnect')}</button></div>
              ))}
              <select className="select" value="" onChange={(e) => e.target.value && connect(selected.id, e.target.value)} aria-label={t('rel.connectWorker')}>
                <option value="">{t('rel.connectWorker')}</option>
                {workers.filter((w) => !selected.worker_ids.includes(w.id)).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </>
          ) : (
            <>
              <div className="eyebrow">{t('rel.directedBy')}</div>
              {orchestrators.filter((q) => q.worker_ids.includes(selected.id)).length === 0 && <p className="muted small" style={{ margin: 0 }}>{t('rel.noOrchestrators')}</p>}
              {orchestrators.filter((q) => q.worker_ids.includes(selected.id)).map((q) => (
                <div key={q.id} className="relrow"><i className="cdot" style={{ background: LINE_COLORS[(qIndex.get(q.id) ?? 0) % LINE_COLORS.length], margin: 0 }} /><span className="grow">{q.name}</span><button className="btn sm" onClick={() => disconnect(q.id, selected.id)}>{t('rel.disconnect')}</button></div>
              ))}
              <select className="select" value="" onChange={(e) => e.target.value && connect(e.target.value, selected.id)} aria-label={t('rel.connectOrchestrator')}>
                <option value="">{t('rel.connectOrchestrator')}</option>
                {orchestrators.filter((q) => !q.worker_ids.includes(selected.id)).map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
              </select>
            </>
          )}
        </aside>
      )}
    </div>
  );
}
