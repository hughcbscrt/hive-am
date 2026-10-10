import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { handle } from './api.js';
import { bus } from './runtime.js';
import { skills } from './db.js';
import { DEFAULT_SKILLS } from './skills/defaults.js';
import { seedIfEmpty } from './seed.js';
import { API_PORT } from './mcp-config.js';
import './connections/index.js';
import { startAll } from './connections/manager.js';
import { migrateChannelSkill } from './connections/channel-skill.js';
import { armWakeups } from './wake.js';
import { armSchedules } from './schedules.js';
import { armWatches } from './watch.js';
import { armObjects } from './objects/index.js';
import { attachTerminal, isLocalRequest, terminalsEnabled } from './terminals.js';

skills.seedDefaults(DEFAULT_SKILLS);
seedIfEmpty();
migrateChannelSkill();
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

server.listen(API_PORT, '127.0.0.1', () => { console.log(`hive-am server → http://127.0.0.1:${API_PORT}`); void startAll(); });
