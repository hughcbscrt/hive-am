import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { handle } from './api.js';
import { bus } from './runtime.js';
import { db, skills } from './db.js';
import { DEFAULT_SKILLS } from './skills/defaults.js';
import { dropStarterSkills, seedIfEmpty } from './seed.js';
import { API_PORT } from './mcp-config.js';
import './connections/index.js';
import { startAll, stopAll } from './connections/manager.js';
import { addReactionsToChannelSkill, migrateChannelSkill } from './connections/channel-skill.js';
import { armWakeups } from './wake.js';
import { armSchedules } from './schedules.js';
import { armWatches } from './watch.js';
import { armObjects } from './objects/index.js';
import { attachTerminal, closeAllTerminals, terminalsEnabled } from './terminals.js';
import { isLocalRequest } from './http/guards.js';

skills.seedDefaults(DEFAULT_SKILLS);
seedIfEmpty();
dropStarterSkills();
migrateChannelSkill();
addReactionsToChannelSkill();
armWakeups();
armSchedules();
armWatches();
armObjects();

const server = createServer((req, res) => { void handle(req, res); });
// Two sockets share the port: `/ws` (what the interface listens to) and `/ws/terminal?id=` (one terminal). Terminals only for this machine.
const wss = new WebSocketServer({ noServer: true });
const termWss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/ws') wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  else if (url.pathname === '/ws/terminal') {
    if (!isLocalRequest(req) || !terminalsEnabled()) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    termWss.handleUpgrade(req, socket, head, (ws) => attachTerminal(ws, url.searchParams.get('id') ?? ''));
  } else socket.destroy();
});
wss.on('connection', (ws) => {
  const onMsg = (m: unknown) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
  bus.on('msg', onMsg);
  ws.on('close', () => bus.off('msg', onMsg));
});

server.on('error', (e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE' ? `[server] port ${API_PORT} is already in use: is hive-am already running? (HIVE_AM_PORT changes it)` : `[server] ${e.message}`);
  process.exit(1);
});
server.listen(API_PORT, '127.0.0.1', () => { console.log(`hive-am server → http://127.0.0.1:${API_PORT}`); void startAll(); });

// ---- shutdown ----
// Ctrl+C or a service stop: stop taking requests, drop the sockets, end the shells, stop the channel connections and close the database
// (which merges its write-ahead log). Servers and containers kept as resources are NOT stopped: they outlive hive-am by design.
// A step that hangs cannot hold the process: after 5 s it leaves anyway.
let stopping = false;
async function shutdown(why: string, code: number) {
  if (stopping) return; stopping = true;
  console.log(`[server] ${why}: shutting down`);
  const force = setTimeout(() => { console.error('[server] shutdown took too long: leaving'); process.exit(code || 1); }, 5000); force.unref();
  const step = async (name: string, f: () => unknown) => { try { await f(); } catch (e) { console.error(`[server] shutdown, ${name}:`, e); } };
  // `server.close` only ends once every connection is gone, and a WebSocket is not one `closeAllConnections` can close: stop taking requests first,
  // drop the sockets, and only then wait for the server (waiting first made every shutdown last the full 5 s and left the database unclosed).
  const httpClosed = new Promise<void>((done) => { server.close(() => done()); server.closeAllConnections(); });
  await step('websockets', () => { for (const w of [wss, termWss]) { for (const c of w.clients) c.terminate(); w.close(); } });
  await step('http', () => httpClosed);
  await step('terminals', closeAllTerminals);
  await step('connections', stopAll);
  await step('database', () => db.close());
  process.exit(code);
}
process.on('SIGINT', () => void shutdown('SIGINT', 0));
process.on('SIGTERM', () => void shutdown('SIGTERM', 0));
// Policy: a stray rejected promise (a provider, a network call) is logged and the server keeps serving, because it holds terminals and
// running turns that a crash would take down; an uncaught exception leaves the process in an unknown state, so it is logged and the server restarts cleanly.
process.on('unhandledRejection', (reason) => console.error('[server] unhandled rejection:', reason));
process.on('uncaughtException', (e) => { console.error('[server] uncaught exception:', e); void shutdown('uncaught exception', 1); });
