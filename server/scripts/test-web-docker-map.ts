// The relations map of a Docker resource (web/lib/dockerGraph.ts): only its neighbourhood (its containers, their image, volumes, folders and
// networks, and the containers that share one of those), at most 12 neighbours per shared node with how many more, Docker's own networks
// not expanded, and folders of the machine told apart from volumes. No model, no browser, no Docker.
// Usage: HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-web-docker-map.ts
import './_guard.js';
import { MAP_CAP, composeProject, imageKey, isFolderSource, neighbourhood, ownContainers, related } from '../../web/lib/dockerGraph.ts';
import type { DockerContainer } from '../../web/lib/useDocker.ts';
let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); if (!ok) fail++; };

const ID = 'abcdef0123456789', MINE = 'hive-am-abcdef01';
const ctr = (name: string, o: Partial<DockerContainer> = {}): DockerContainer => ({ id: name.padEnd(12, '0').slice(0, 12), name, image: 'nginx', state: 'running', status: 'Up', ports: '', managed: false, mounts: [], networks: ['bridge'], ...o });
const names = (xs: { name: string }[]) => xs.map((x) => x.name);

// A container hive-am created, sharing a volume, a folder, a network and its image with others; one more container that shares nothing.
const many = Array.from({ length: 20 }, (_, i) => ctr(`peer-${String(i).padStart(2, '0')}`, { image: 'busybox', networks: [], mounts: ['shared'], state: i % 2 ? 'exited' : 'running' }));
const containers = [
  ctr(MINE, { image: 'nginx:latest', mounts: ['shared', '/srv/site', 'f'.repeat(64)], networks: ['bridge', 'appnet'], object: ID, managed: true }),
  ctr('api', { image: 'node:20', mounts: ['/srv/site'], networks: ['appnet'], object: 'other-resource', managed: true }),
  ctr('worker', { id: 'a1b2c3d4e5f6', image: 'nginx', networks: ['bridge'] }),
  ctr('alone', { image: 'redis:7', mounts: ['cache'], networks: ['bridge'] }),
  ...many,
];
const lists = { containers, images: [{ ref: 'nginx:latest', id: 'i', size: '', created: '', inUse: 2 }], volumes: [{ name: 'shared', driver: 'local', anonymous: false, managed: false, inUse: 21 }, { name: 'f'.repeat(64), driver: 'local', anonymous: true, managed: false, inUse: 1 }], networks: [{ name: 'bridge', id: 'b', driver: 'bridge', scope: 'local', builtin: true, managed: false, inUse: 23 }, { name: 'appnet', id: 'a', driver: 'bridge', scope: 'local', builtin: false, managed: true, inUse: 2 }] };
const g = neighbourhood(ID, { mode: 'container', image: 'nginx' }, lists);

eq('its own container comes first, marked as its own', [g.containers[0].name, g.containers[0].own, g.containers.filter((c) => c.own).length], [MINE, true, 1]);
eq('a folder of the machine (bind mount) and a volume are different kinds of node', [names(g.folders), names(g.volumes)], [['/srv/site'], ['f'.repeat(64), 'shared']]);
eq('the anonymous volume is marked as such', g.volumes.find((v) => v.anonymous)?.name, 'f'.repeat(64));
eq('nginx and nginx:latest are one image node, used by it and by the container started from nginx', [names(g.images), g.images[0].users, g.edges.filter((e) => e.to === g.images[0].key).length], [['nginx:latest'], 2, 2]);
const drawn = new Set(names(g.containers));
eq('the containers that share its volume, folder, image or network are drawn; one that shares nothing is not', [drawn.has('api'), drawn.has('worker'), drawn.has('alone')], [true, true, false]);
const shared = g.volumes.find((v) => v.name === 'shared')!;
eq('a volume shared by 21 containers draws 12 neighbours and says how many more', [g.edges.filter((e) => e.to === shared.key).length - 1, shared.users, shared.more], [MAP_CAP, 21, 21 - 1 - MAP_CAP]);
eq('the running ones are drawn first (all 10 running, then 2 stopped)', [g.containers.filter((c) => c.name.startsWith('peer-') && c.state === 'running').length, g.containers.filter((c) => c.name.startsWith('peer-')).length], [10, MAP_CAP]);
const bridge = g.networks.find((n) => n.name === 'bridge')!;
eq('Docker\'s own bridge network does not expand: it only counts who uses it (3 here, none drawn for it)', [bridge.builtin, bridge.users, drawn.has('alone')], [true, 3, false]);
eq('a bridge used by hundreds of containers adds none of them', names(neighbourhood(ID, { mode: 'container', image: 'nginx' }, { containers: [containers[0], ...Array.from({ length: 300 }, (_, i) => ctr(`b${i}`, { image: 'x' }))] }).containers), [MINE]);
eq('the container of another resource carries that resource (to open its settings)', g.containers.find((c) => c.name === 'api')?.object, 'other-resource');
eq('a neighbour only draws lines to what is already in the map (its own image node.js is not added)', [names(g.images).includes('node:20'), g.edges.filter((e) => e.from === 'container:api').map((e) => e.to).sort()], [false, ['folder:/srv/site', 'network:appnet']]);
eq('selecting a container lights what it uses; selecting the folder lights who uses it', [[...related(g, `container:${MINE}`)].sort(), [...related(g, 'folder:/srv/site')].sort()],
  [['folder:/srv/site', 'image:nginx:latest', 'network:appnet', 'network:bridge', `volume:${'f'.repeat(64)}`, 'volume:shared'], ['container:api', `container:${MINE}`]]);

// Not created yet: what it will use, from its settings.
const fresh = neighbourhood('1234567890abcdef', { mode: 'container', image: 'postgres:16', volumes: ['pgdata:/var/lib/postgresql/data', '/home/you/init:/docker-entrypoint-initdb.d:ro'], extraNetworks: ['appnet'] }, lists);
eq('a container not created yet shows what its settings use, with no line of its own', [fresh.fromSettings, names(fresh.images), names(fresh.volumes), names(fresh.folders), names(fresh.networks), fresh.containers.some((c) => c.own)],
  [true, ['postgres:16'], ['pgdata'], ['/home/you/init'], ['appnet', 'bridge'], false]);
eq('and says what the machine does not have yet', [fresh.images[0].missing, fresh.volumes[0].missing, fresh.networks.find((n) => n.name === 'appnet')?.missing], [true, true, false]);

// An existing container, by name or by id; a compose project by its label, only the services it manages.
eq('an existing container is found by its name or its id', [names(ownContainers(ID, { mode: 'existing', container: 'worker' }, containers)), names(ownContainers(ID, { mode: 'existing', container: containers[2].id }, containers))], [['worker'], ['worker']]);
eq('an existing container Docker does not have draws nothing of its own', neighbourhood(ID, { mode: 'existing', container: 'gone' }, lists).containers.length, 0);
const proj = [ctr('shop-web-1', { project: 'shop', service: 'web', networks: ['shop_default'] }), ctr('shop-db-1', { project: 'shop', service: 'db', mounts: ['shop_data'], networks: ['shop_default'] }), ctr('other-1', { project: 'other', networks: ['shop_default'] })];
const cg = neighbourhood(ID, { mode: 'compose', file: '/home/you/Shop App/docker-compose.yml' }, { containers: proj });
eq('a compose project without a name uses its folder, as compose does', composeProject({ mode: 'compose', file: '/home/you/Shop App/docker-compose.yml' }), 'shopapp');
eq('its containers are the ones with its project label (the others sharing its network are neighbours)', [names(neighbourhood(ID, { mode: 'compose', file: '/x/y.yml', project: 'shop' }, { containers: proj }).containers.filter((c) => c.own)), cg.containers.length], [['shop-db-1', 'shop-web-1'], 0]);
eq('only the services it manages, when it names some', names(ownContainers(ID, { mode: 'compose', file: '/x/y.yml', project: 'shop', services: ['db'] }, proj)), ['shop-db-1']);
eq('the helpers: image references and folder sources', [imageKey('nginx'), imageKey('nginx:1'), imageKey('reg:5000/app'), imageKey('a@sha256:x'), isFolderSource('/srv'), isFolderSource('data')], ['nginx:latest', 'nginx:1', 'reg:5000/app:latest', 'a@sha256:x', true, false]);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
