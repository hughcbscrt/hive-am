import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { handle } from './api.js';
import { bus } from './runtime.js';
import { seedIfEmpty } from './seed.js';
import { API_PORT } from './mcp-config.js';

seedIfEmpty();

const server = createServer((req, res) => { void handle(req, res); });
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  const onMsg = (m: unknown) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
  bus.on('msg', onMsg);
  ws.on('close', () => bus.off('msg', onMsg));
});

server.listen(API_PORT, '127.0.0.1', () => console.log(`hive-am server → http://127.0.0.1:${API_PORT}`));
