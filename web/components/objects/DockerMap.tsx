'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Box, ChevronUp, Folder, HardDrive, Info, Layers, Network, RefreshCw, Settings2 } from 'lucide-react';
import { neighbourhood, related, type DockerMapGraph, type MapKind, type MapNode } from '@/lib/dockerGraph';
import { useDockerLists } from '@/lib/useDocker';
import { useI18n } from '@/lib/i18n/index';
import { useHive } from '@/lib/store';
import type { DockerConfig, ObjectView } from '@/lib/types';
import { Banner } from '@/components/ui';
import { InspectView } from './ServiceDetail';
import { DockerRaw } from './DockerRaw';

const ICON: Record<MapKind, typeof Box> = { image: Layers, container: Box, volume: HardDrive, folder: Folder, network: Network };

/**
 * The Relations tab of a Docker resource: the map of its neighbourhood (see web/lib/dockerGraph.ts), in three columns: images, containers,
 * and volumes, folders of this machine and networks. Read only. Choosing a node lights what it is joined to and shows its detail below,
 * where **Inspect** opens in place (no window over another). Lines are drawn only for the node chosen or under the pointer, from where the
 * nodes really are, again whenever the map changes size or scrolls.
 */
export function DockerMap({ object: o }: { object: ObjectView }) {
  const { t } = useI18n();
  const c = o.config as DockerConfig;
  const lists = useDockerLists(true);
  const { containers, images, volumes, networks, reload } = lists;
  // What Docker has changes when the resource starts or stops: read it again then (the first reading is the hook's own).
  const status = useRef(o.state.status);
  useEffect(() => { if (status.current !== o.state.status) { status.current = o.state.status; reload(); } }, [o.state.status, reload]);
  const g = useMemo(() => (containers ? neighbourhood(o.id, c, { containers, images, volumes, networks }) : null), [o.id, c, containers, images, volumes, networks]);
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const active = hover ?? sel;
  const lit = useMemo(() => (g ? related(g, active) : new Set<string>()), [g, active]);
  const choose = (k: string) => { setSel((s) => (s === k ? null : k)); setOpen(false); };
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && sel && !(e.target as HTMLElement)?.closest?.('.modal')) { setSel(null); setOpen(false); } };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [sel]);

  if (lists.error && !containers?.length) return <div className="dm"><Banner kind="warn" action={<button type="button" className="btn sm" onClick={reload}><RefreshCw size={14} />{t('dk.refresh')}</button>}>{t('map.noDocker')}<span className="muted small mono"> · {lists.error}</span></Banner></div>;
  if (!g) return <div className="dm"><p className="gx-note">{t('git.loading')}</p></div>;
  const all = [...g.images, ...g.containers, ...g.volumes, ...g.folders, ...g.networks];
  const node = all.find((n) => n.key === sel) ?? null;
  const empty = !g.containers.length && !g.images.length;

  return (
    <div className="dm">
      <div className="dm-head">
        <p className="muted small res-m0 grow">{t('map.hint')}</p>
        <span className="dm-legend muted small" aria-hidden><i className="dm-own-mark" />{t('map.legend.own')}<i className="dm-line-mark" />{t('map.legend.line')}</span>
        <button type="button" className="btn ghost icon sm" onClick={reload} aria-label={t('dk.refresh')} title={t('dk.refresh')}><RefreshCw size={14} /></button>
      </div>
      {g.fromSettings && <Banner kind="info">{t('map.fromSettings')}</Banner>}
      {empty ? <p className="muted small">{t(`map.empty.${c.mode}`)}</p> : (
        <Lines g={g} active={active}>
          <Column title={t('map.col.images')} nodes={g.images} lit={lit} active={active} sel={sel} onPick={choose} onHover={setHover} />
          <Column title={t('map.col.containers')} nodes={g.containers} lit={lit} active={active} sel={sel} onPick={choose} onHover={setHover} />
          <div className="dm-col">
            <Column title={t('map.col.volumes')} nodes={g.volumes} lit={lit} active={active} sel={sel} onPick={choose} onHover={setHover} inner />
            <Column title={t('map.col.folders')} nodes={g.folders} lit={lit} active={active} sel={sel} onPick={choose} onHover={setHover} inner />
            <Column title={t('map.col.networks')} nodes={g.networks} lit={lit} active={active} sel={sel} onPick={choose} onHover={setHover} inner />
          </div>
        </Lines>
      )}
      <Detail g={g} node={node} object={o} open={open} onOpen={setOpen} />
    </div>
  );
}

/** One column (or one group of the right column, `inner`): its title and count, and its nodes. A group with nothing is not shown. */
function Column({ title, nodes, lit, active, sel, onPick, onHover, inner = false }: {
  title: string; nodes: MapNode[]; lit: Set<string>; active: string | null; sel: string | null;
  onPick: (k: string) => void; onHover: (k: string | null) => void; inner?: boolean;
}) {
  if (inner && !nodes.length) return null;
  return (
    <div className={inner ? 'dm-group' : 'dm-col'}>
      <div className="eyebrow">{title} · {nodes.length}</div>
      {nodes.map((n) => <MapNodeButton key={n.key} n={n} state={n.key === sel ? 'sel' : n.key === active ? 'hot' : lit.has(n.key) ? 'lit' : active ? 'dim' : ''} onPick={onPick} onHover={onHover} />)}
    </div>
  );
}

function MapNodeButton({ n, state, onPick, onHover }: { n: MapNode; state: string; onPick: (k: string) => void; onHover: (k: string | null) => void }) {
  const { t } = useI18n();
  const Icon = ICON[n.kind];
  const sub = n.kind === 'container'
    ? [t(n.state === 'running' ? 'map.running' : 'map.stopped'), n.own ? t('map.own') : n.managed ? t('map.hive') : ''].filter(Boolean).join(' · ')
    : [n.kind === 'folder' ? t('map.kind.folder') : n.kind === 'volume' ? t(n.anonymous ? 'map.kind.anonymous' : 'map.kind.volume') : n.kind === 'network' ? (n.builtin ? t('map.kind.builtin') : n.driver || t('map.kind.network')) : '',
      n.missing ? t('map.missing') : t('dk.inUse', { count: n.users ?? 0 }), n.more ? t('map.more', { count: n.more }) : ''].filter(Boolean).join(' · ');
  return (
    <button type="button" className={`dm-node ${n.kind} ${n.own ? 'own' : ''} ${state}`} data-k={n.key} aria-pressed={state === 'sel'}
      onClick={() => onPick(n.key)} onMouseEnter={() => onHover(n.key)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(n.key)} onBlur={() => onHover(null)}>
      <span className="dm-node-top"><Icon size={14} aria-hidden className="dm-ico" /><span className={`dm-name ${n.kind === 'container' ? '' : 'mono'}`} title={n.name}>{n.name}</span>
        {n.kind === 'container' && <span className={`dm-dot ${n.state === 'running' ? 'run' : ''}`} aria-hidden />}</span>
      <span className="dm-sub">{sub}</span>
    </button>
  );
}

/**
 * The map with its lines: an SVG over the columns, with one curve from each container to what it uses, only for the active node. The ends
 * are measured from the nodes on screen and measured again when the map changes size (a narrow window, a font that loads) or anything
 * around it scrolls.
 */
function Lines({ g, active, children }: { g: DockerMapGraph; active: string | null; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<{ d: string; k: string }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const measure = useCallback(() => {
    const el = box.current; if (!el) return;
    const b = el.getBoundingClientRect();
    setSize({ w: el.scrollWidth, h: el.scrollHeight });
    if (!active) { setPaths([]); return; }
    const at = (k: string) => { const n = el.querySelector<HTMLElement>(`[data-k="${CSS.escape(k)}"]`); if (!n) return null; const r = n.getBoundingClientRect(); return { l: r.left - b.left + el.scrollLeft, r: r.right - b.left + el.scrollLeft, y: r.top - b.top + el.scrollTop + r.height / 2 }; };
    const out: { d: string; k: string }[] = [];
    for (const e of g.edges) {
      if (e.from !== active && e.to !== active) continue;
      const a = at(e.from), o = at(e.to); if (!a || !o) continue;
      // An image is to the left of its containers; volumes, folders and networks to the right.
      const left = e.to.startsWith('image:');
      const x1 = left ? a.l : a.r, x2 = left ? o.r : o.l, dx = (x2 - x1) / 2;
      out.push({ k: `${e.from}>${e.to}`, d: `M${x1},${a.y} C${x1 + dx},${a.y} ${x2 - dx},${o.y} ${x2},${o.y}` });
    }
    setPaths(out);
  }, [g, active]);
  useLayoutEffect(() => { measure(); }, [measure]);
  useEffect(() => {
    const el = box.current; if (!el) return;
    let raf = 0;
    const later = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    const ro = new ResizeObserver(later); ro.observe(el);
    window.addEventListener('scroll', later, true); window.addEventListener('resize', later);
    void document.fonts?.ready.then(later);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('scroll', later, true); window.removeEventListener('resize', later); };
  }, [measure]);
  return (
    <div ref={box} className={`dm-map ${active ? 'has-active' : ''}`}>
      <svg className="dm-lines" width={size.w} height={size.h} viewBox={`0 0 ${size.w || 1} ${size.h || 1}`} aria-hidden>
        {paths.map((p) => <path key={p.k} d={p.d} />)}
      </svg>
      {children}
    </div>
  );
}

/** What is chosen, below the map: what it is and what it is joined to, and **Inspect** opened in place. */
function Detail({ g, node: n, object: o, open, onOpen }: { g: DockerMapGraph; node: MapNode | null; object: ObjectView; open: boolean; onOpen: (v: boolean) => void }) {
  const { t } = useI18n();
  const { objects } = useHive();
  if (!n) return <div className="dm-detail"><p className="muted small res-m0">{t('map.pick')}</p></div>;
  const joined = [...related(g, n.key)].map((k) => k.slice(k.indexOf(':') + 1));
  const Icon = ICON[n.kind];
  const ref = encodeURIComponent(n.name);
  // A container of a hive-am resource opens its Inspect (what is configured and what Docker says, with the raw JSON); anything else, the
  // raw docker inspect. A folder of this machine is not something Docker inspects.
  const raw = <DockerRaw key={n.key} src={`/docker/inspect?kind=${n.kind}&ref=${ref}`} />;
  const other = n.object && n.object !== o.id && objects.some((x) => x.id === n.object) ? n.object : undefined;
  const compose = (o.config as DockerConfig).mode === 'compose';
  const inspect = n.kind === 'folder' || n.missing ? null
    : n.kind !== 'container' ? raw
    : n.own ? (compose ? (n.service ? <InspectView key={n.key} objectId={o.id} service={n.service} /> : raw) : <InspectView key={n.key} objectId={o.id} />)
    : other ? <InspectView key={n.key} objectId={other} /> : raw;
  const settingsOf = n.kind === 'container' ? (n.own ? o.id : other) : undefined;
  const what = n.kind === 'container'
    ? t(n.own ? 'map.d.own' : n.managed ? 'map.d.hive' : 'map.d.foreign', { image: n.image ?? '' })
    : n.kind === 'folder' ? t('map.d.folder') : n.kind === 'network' && n.builtin ? t('map.d.builtin', { count: n.users ?? 0 })
    : n.missing ? t('map.d.missing') : t('map.d.users', { count: n.users ?? 0 });
  return (
    <div className={`dm-detail ${open ? 'open' : ''}`}>
      <div className="dm-d-head">
        <Icon size={16} aria-hidden className="dm-ico" />
        <div className="grow dm-d-title"><b className={n.kind === 'container' ? '' : 'mono'}>{n.name}</b><p className="muted small res-m0">{what}{n.more ? ` ${t('map.more', { count: n.more })}` : ''}</p></div>
        {settingsOf && <Link className="btn sm" href={`/resources/${settingsOf}?tab=config`}><Settings2 size={14} />{t('map.edit')}</Link>}
        {inspect && <button type="button" className="btn sm" aria-expanded={open} onClick={() => onOpen(!open)}>{open ? <ChevronUp size={14} /> : <Info size={14} />}{t(open ? 'map.inspect.close' : 'svc.inspect')}</button>}
      </div>
      {joined.length > 0 && <div className="chips dm-joined">{joined.map((x) => <span key={x} className="chip-pick mono">{x}</span>)}</div>}
      {open && inspect && <div className="dm-inspect">{inspect}</div>}
    </div>
  );
}
