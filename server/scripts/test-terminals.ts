// Terminals without a model: a real shell over the socket (input, output, resize, replay when another page attaches, exit), who may reach
// it (another origin or a rebound host name is refused), a shell inside a container, limits and the off switch. Usage:
//   HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4483 npx tsx scripts/test-terminals.ts
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import '../src/index.js';
import { createObject, removeObject } from '../src/objects/index.js';

const PORT = process.env.HIVE_AM_PORT!, api = `http://127.0.0.1:${PORT}`;
let fail = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${api}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) as any }));
await sleep(500);

/** A page attached to a terminal. */
function attach(id: string, headers: Record<string, string> = {}) {
  return new Promise<{ out: () => string; send: (m: object) => void; msgs: any[]; close: () => void; ws: WebSocket } | { refused: number }>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/terminal?id=${id}`, { headers });
    let out = ''; const msgs: any[] = [];
    ws.on('message', (d) => { const m = JSON.parse(String(d)); msgs.push(m); if (m.t === 'out') out += m.d; });
    ws.on('open', () => resolve({ out: () => out, send: (m) => ws.send(JSON.stringify(m)), msgs, close: () => ws.close(), ws }));
    ws.on('unexpected-response', (_q, res) => resolve({ refused: res.statusCode ?? 0 }));
    ws.on('error', () => undefined);
  });
}
const until = async (cond: () => boolean, ms = 6000) => { for (let t = 0; t < ms && !cond(); t += 100) await sleep(100); return cond(); };

const dir = mkdtempSync(join(tmpdir(), 'term-'));
const made = await post('/api/terminals', { cwd: dir, title: 'test' });
check(made.status === 200 && !!made.json.id, 'a terminal can be created in a folder');
const id = made.json.id as string;

const a = await attach(id) as Exclude<Awaited<ReturnType<typeof attach>>, { refused: number }>;
check(!!a.send && a.msgs[0]?.t === 'init' && a.msgs[0].title === 'test', 'a page attaches and is told the title');
a.send({ t: 'in', d: 'echo hello-$((20+22)); pwd\n' });
check(await until(() => /hello-42/.test(a.out()) && a.out().includes(dir)), 'what is typed reaches a real shell, which runs in the folder, and the output comes back');
a.send({ t: 'resize', cols: 133, rows: 41 });
a.send({ t: 'in', d: 'echo SIZE:$(tput cols)x$(tput lines)\n' });
check(await until(() => /SIZE:133x41/.test(a.out())), 'resizing the page resizes the terminal');
a.send({ t: 'in', d: 'echo "\\u00e9\\u4e2d" | cat\n' });
check(await until(() => /é中/.test(a.out()) || /u00e9/.test(a.out())), 'non-ASCII text goes through');

const b = await attach(id) as Exclude<Awaited<ReturnType<typeof attach>>, { refused: number }>;
check(await until(() => /hello-42/.test(b.out())), 'a second page that attaches sees what was printed before');
b.close();
a.send({ t: 'in', d: 'exit 7\n' });
check(await until(() => a.msgs.some((m) => m.t === 'exit' && m.code === 7)), 'when the shell ends the page is told its exit code');
const list = (await (await fetch(`${api}/api/terminals`)).json()) as any;
check(list.terminals.some((t: any) => t.id === id && !t.alive && t.exitCode === 7), 'the list keeps it, marked as ended');
const c = await attach(id) as any;
check(await until(() => c.msgs?.some((m: any) => m.t === 'exit')), 'a page that attaches later still sees that it ended');
c.close(); a.close();
check((await fetch(`${api}/api/terminals/${id}`, { method: 'DELETE' })).status === 200 && !((await (await fetch(`${api}/api/terminals`)).json()) as any).terminals.some((t: any) => t.id === id), 'closing removes it');
const gone = await attach(id) as any; check(await until(() => gone.msgs?.some((m: any) => m.t === 'gone')), 'attaching to one that is gone is answered with "gone"');

// who may reach it
const live = await post('/api/terminals', { cwd: dir });
const lid = live.json.id as string;
const evilOrigin = await attach(lid, { Origin: 'http://evil.example' }); check('refused' in evilOrigin && evilOrigin.refused === 403, 'a page of another origin cannot attach');
const evilHost = await attach(lid, { Host: 'evil.example:4400' }); check('refused' in evilHost && evilHost.refused === 403, 'nor one that arrived under another host name (DNS rebinding)');
const okOrigin = await attach(lid, { Origin: 'http://localhost:4401' }); check(!('refused' in okOrigin), 'the interface of this machine can');
if (!('refused' in okOrigin)) okOrigin.close();
check((await post('/api/terminals', { cwd: dir }, { Origin: 'http://evil.example' })).status === 403, 'creating one from another origin is refused');
check((await fetch(`${api}/api/terminals`, { headers: { Origin: 'http://evil.example' } })).status === 403, 'and so is listing them');
check((await fetch(`${api}/api/terminals/${lid}`, { method: 'DELETE', headers: { Origin: 'http://evil.example' } })).status === 403, 'and closing them');
check((await post('/api/terminals', { cwd: '/definitely/not/here' })).status === 400, 'a folder that does not exist is refused');
await fetch(`${api}/api/terminals/${lid}`, { method: 'DELETE' });

// objects
const srv = createObject({ name: 'term-server', kind: 'server', config: { cwd: dir, start: 'sleep 1' } });
const sOut = await post('/api/terminals', { objectId: srv.id });
const sAtt = await attach(sOut.json.id) as any; sAtt.send({ t: 'in', d: 'pwd\n' });
check(sOut.status === 200 && await until(() => sAtt.out().includes(dir)), 'a server object opens a terminal in its folder');
sAtt.close(); await fetch(`${api}/api/terminals/${sOut.json.id}`, { method: 'DELETE' });
const comp = createObject({ name: 'term-compose', kind: 'docker', config: { mode: 'compose', file: join(dir, 'docker-compose.yml') } });
check((await post('/api/terminals', { objectId: comp.id })).status === 400, 'a compose project has no single container to open: refused with a reason');
const web = createObject({ name: 'term-http', kind: 'http', config: { folder: dir } });
check((await post('/api/terminals', { objectId: web.id })).status === 400, 'an HTTP object has no terminal');

const image = process.env.HIVE_TEST_IMAGE ?? 'nginx:1.25-alpine';
const haveImage = spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status === 0;
if (!haveImage) console.log(`SKIP  container terminal (docker or ${image} not available)`);
else {
  const name = `hive-am-test-term-${Date.now().toString(36)}`;
  execFileSync('docker', ['run', '-d', '--name', name, image], { stdio: 'ignore' });
  try {
    const ex = createObject({ name: 'term-existing', kind: 'docker', config: { mode: 'existing', container: name } });
    const t = await post('/api/terminals', { objectId: ex.id });
    const att = await attach(t.json.id) as any;
    await sleep(1500); att.send({ t: 'in', d: 'cat /etc/os-release | head -1; echo INSIDE:$(hostname | cut -c1-4)\n' });
    check(t.status === 200 && await until(() => /Alpine|alpine/.test(att.out()) && /INSIDE:/.test(att.out()), 10000), 'an existing container opens a shell inside it');
    att.close(); await fetch(`${api}/api/terminals/${t.json.id}`, { method: 'DELETE' }); await removeObject(ex.id);
  } finally { spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' }); }
}

// limits
const ids: string[] = [];
let refused = 0;
for (let i = 0; i < 14; i++) { const r = await post('/api/terminals', { cwd: dir }); if (r.status === 200) ids.push(r.json.id); else refused++; }
check(ids.length === 12 && refused >= 2, 'at most 12 terminals at a time');
for (const x of ids) await fetch(`${api}/api/terminals/${x}`, { method: 'DELETE' });
process.env.HIVE_AM_TERMINALS = '0';
check((await post('/api/terminals', { cwd: dir })).status === 400 && ((await (await fetch(`${api}/api/terminals`)).json()) as any).enabled === false, 'HIVE_AM_TERMINALS=0 turns them off');

for (const o of [srv, comp, web]) await removeObject(o.id);
console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
