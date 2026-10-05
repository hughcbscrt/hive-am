#!/usr/bin/env node
// Minimal MCP stdio server giving an orchestrator two tools: list_agents and dispatch.
// It only talks to the hive-am HTTP API; all rules (assignments, queueing) live there.
import { createInterface } from 'node:readline';

const API = process.env.HIVE_AM_API ?? 'http://127.0.0.1:4400';
const FROM = process.env.HIVE_AGENT_ID;

const tools = [
  {
    name: 'list_agents',
    description: 'List the subagents you are allowed to dispatch tasks to, with their roles and descriptions.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'dispatch',
    description: 'Send a self-contained task to one of your subagents and wait for its final answer. Every delegation starts a fresh conversation for the subagent, so include all the context it needs.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Exact subagent name from list_agents' },
        task: { type: 'string', description: 'Full instructions for the subagent; include all context it needs.' },
      },
      required: ['agent', 'task'],
      additionalProperties: false,
    },
  },
];

async function call(name, args) {
  if (name === 'list_agents') {
    const r = await fetch(`${API}/api/orchestrators/${FROM}/workers`);
    return JSON.stringify(await r.json(), null, 2);
  }
  if (name === 'dispatch') {
    const r = await fetch(`${API}/api/dispatch`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, agent: args.agent, task: args.task }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `dispatch failed (${r.status})`);
    return j.text || '(the subagent finished without a text answer)';
  }
  throw new Error(`Unknown tool ${name}`);
}

const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');

createInterface({ input: process.stdin }).on('line', async (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined) return; // notification
  try {
    if (method === 'initialize') {
      send({ id, result: { protocolVersion: params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'hive', version: '0.1.0' } } });
    } else if (method === 'tools/list') {
      send({ id, result: { tools } });
    } else if (method === 'tools/call') {
      try {
        const text = await call(params.name, params.arguments ?? {});
        send({ id, result: { content: [{ type: 'text', text }] } });
      } catch (e) {
        send({ id, result: { isError: true, content: [{ type: 'text', text: String(e.message ?? e) }] } });
      }
    } else if (method === 'ping') send({ id, result: {} });
    else send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (e) {
    send({ id, error: { code: -32603, message: String(e) } });
  }
});
