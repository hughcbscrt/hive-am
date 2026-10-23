/**
 * The relations map of a Docker resource: only its neighbourhood, never the whole machine. Its containers (one it creates, an existing
 * one, or the containers of its compose project), their image, the volumes and folders of this machine they mount and their networks, and
 * the other containers that share one of those. A shared image, volume, folder or network draws at most `cap` (12) of those containers and
 * says how many more there are; Docker's own networks (bridge, host, none) draw none, only how many use them. Folders of this machine (bind
 * mounts) and volumes are different kinds of node. Pure, so a script can check it without a browser.
 */
import type { DockerConfig } from './types';
import type { DockerContainer, DockerImage, DockerNetwork, DockerVolume } from './useDocker';

export type MapKind = 'image' | 'container' | 'volume' | 'folder' | 'network';
export interface MapNode {
  key: string; kind: MapKind; name: string;
  /** Part of this resource: its container(s), or what they use. */ own: boolean;
  /** A container: its state, image, the hive-am resource that created it and its compose service. */
  state?: string; image?: string; object?: string; service?: string; managed?: boolean;
  /** How many containers of this machine use it, and how many of those are not drawn. */ users?: number; more?: number;
  /** One of Docker's own networks: its users are only counted. */ builtin?: boolean;
  /** A volume Docker named itself. */ anonymous?: boolean;
  /** Configured but not on this machine (a container not created yet, an image not pulled). */ missing?: boolean;
  driver?: string;
}
/** A line from a container (`from`) to what it uses (`to`). */
export interface MapEdge { from: string; to: string }
export interface DockerMapGraph {
  images: MapNode[]; containers: MapNode[]; volumes: MapNode[]; folders: MapNode[]; networks: MapNode[]; edges: MapEdge[];
  /** Nothing of this resource is in Docker: the nodes come from its settings (a container hive-am has not created yet). */
  fromSettings: boolean;
}
export interface MapLists { containers: DockerContainer[]; images?: DockerImage[] | null; volumes?: DockerVolume[] | null; networks?: DockerNetwork[] | null }

export const MAP_CAP = 12;
const BUILTIN = ['bridge', 'host', 'none'];
const ANONYMOUS = /^[0-9a-f]{64}$/;

/** `nginx` and `nginx:latest` are the same image. */
export const imageKey = (ref: string) => (/:[^/]*$/.test(ref) || ref.includes('@') ? ref : `${ref}:latest`);
/** A mount source that is a folder of this machine (a bind mount) rather than a volume name. */
export const isFolderSource = (source: string) => /^[/~.]/.test(source);
/** The name hive-am gives to a container it creates (as in server/src/objects/docker.ts). */
const containerName = (id: string) => `hive-am-${id.slice(0, 8)}`;
/** The project name compose uses when none is set: the folder of the file, lowercase, only letters, digits, - and _. */
export const composeProject = (c: DockerConfig) => c.project
  || (c.file ?? '').split('/').slice(-2, -1)[0]?.toLowerCase().replace(/[^a-z0-9_-]/g, '').replace(/^[^a-z0-9]+/, '') || '';

/** The containers that are this resource. */
export function ownContainers(id: string, c: DockerConfig, containers: DockerContainer[]): DockerContainer[] {
  if (c.mode === 'container') return containers.filter((x) => x.name === containerName(id) || x.object === id);
  if (c.mode === 'existing') {
    const ref = c.container ?? '';
    const hex = /^[0-9a-f]{4,64}$/.test(ref);
    return containers.filter((x) => x.name === ref || (hex && (x.id.startsWith(ref) || ref.startsWith(x.id))));
  }
  const project = composeProject(c);
  return containers.filter((x) => !!project && x.project === project && (!c.services?.length || c.services.includes(x.service ?? '')));
}

const key = (kind: MapKind, name: string) => `${kind}:${kind === 'image' ? imageKey(name) : name}`;
const uses = (x: DockerContainer, n: MapNode) => n.kind === 'image' ? imageKey(x.image) === imageKey(n.name)
  : n.kind === 'network' ? x.networks.includes(n.name) : x.mounts.includes(n.name);
/** Running first, then by name: the ones drawn when there are more than the cap. */
const order = (a: DockerContainer, b: DockerContainer) => Number(b.state === 'running') - Number(a.state === 'running') || a.name.localeCompare(b.name);
const byName = (a: MapNode, b: MapNode) => Number(b.own) - Number(a.own) || a.name.localeCompare(b.name);

export function neighbourhood(id: string, c: DockerConfig, lists: MapLists, cap = MAP_CAP): DockerMapGraph {
  const all = lists.containers;
  const own = ownContainers(id, c, all);
  const targets = new Map<string, MapNode>();
  const add = (kind: MapKind, name: string) => { if (name && !targets.has(key(kind, name))) targets.set(key(kind, name), { key: key(kind, name), kind, name, own: true }); };
  for (const x of own) {
    add('image', x.image);
    for (const m of x.mounts) add(isFolderSource(m) ? 'folder' : 'volume', m);
    for (const n of x.networks) add('network', n);
  }
  // A container hive-am has not created yet: what it will use, from its settings.
  const fromSettings = !own.length && c.mode === 'container';
  if (fromSettings) {
    add('image', c.image ?? '');
    for (const v of c.volumes ?? []) { const src = v.split(':')[0]; add(isFolderSource(src) ? 'folder' : 'volume', src); }
    add('network', c.network || 'bridge');
    for (const n of c.extraNetworks ?? []) add('network', n);
  }
  const drawn = new Map<string, DockerContainer>(own.map((x) => [x.name, x]));
  const ownNames = new Set(own.map((x) => x.name));
  for (const n of targets.values()) {
    const users = all.filter((x) => uses(x, n));
    n.users = users.length;
    if (n.kind === 'network' && BUILTIN.includes(n.name)) { n.builtin = true; continue; }
    for (const x of users.filter((u) => !ownNames.has(u.name)).sort(order).slice(0, cap)) drawn.set(x.name, x);
  }
  const containers: MapNode[] = [...drawn.values()].map((x) => ({
    key: key('container', x.name), kind: 'container', name: x.name, own: ownNames.has(x.name), state: x.state, image: x.image, object: x.object, service: x.service, managed: x.managed,
  }));
  const edges: MapEdge[] = [];
  for (const x of drawn.values()) for (const n of targets.values()) if (uses(x, n)) edges.push({ from: key('container', x.name), to: n.key });
  for (const n of targets.values()) {
    const shown = [...drawn.values()].filter((x) => uses(x, n)).length;
    n.more = Math.max(0, (n.users ?? 0) - shown);
    if (n.kind === 'image') { const i = lists.images?.find((m) => imageKey(m.ref) === imageKey(n.name)); n.missing = !!lists.images && !i && !own.length; }
    if (n.kind === 'volume') { const v = lists.volumes?.find((m) => m.name === n.name); n.anonymous = v?.anonymous ?? ANONYMOUS.test(n.name); n.driver = v?.driver; n.missing = !!lists.volumes && !v; }
    if (n.kind === 'network') { const w = lists.networks?.find((m) => m.name === n.name); n.driver = w?.driver; n.missing = !!lists.networks && !w; }
  }
  const of = (k: MapKind) => [...targets.values()].filter((n) => n.kind === k).sort(byName);
  return { images: of('image'), containers: containers.sort(byName), volumes: of('volume'), folders: of('folder'), networks: of('network'), edges, fromSettings };
}

/** The nodes joined to `k` by a line (for a container, what it uses; for anything else, the containers drawn that use it). */
export function related(g: DockerMapGraph, k: string | null): Set<string> {
  const out = new Set<string>();
  if (!k) return out;
  for (const e of g.edges) { if (e.from === k) out.add(e.to); if (e.to === k) out.add(e.from); }
  return out;
}
