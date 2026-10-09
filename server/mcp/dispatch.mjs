#!/usr/bin/env node
// Minimal MCP stdio server for hive-am agents. Tool groups come from HIVE_CAPS:
//   dispatch → list_agents, dispatch (orchestrators with a team)
//   channel  → channel_reply (agents linked to Telegram/Slack)
// It only talks to the hive-am HTTP API; all rules (assignments, queueing) live there.
import { createInterface } from 'node:readline';

const API = process.env.HIVE_AM_API ?? 'http://127.0.0.1:4400';
const FROM = process.env.HIVE_AGENT_ID;
const CAPS = new Set((process.env.HIVE_CAPS ?? 'dispatch').split(',').filter(Boolean));

const allTools = [
  {
    cap: 'dispatch',
    name: 'list_agents',
    description: 'List the subagents you are allowed to dispatch tasks to, with their roles and descriptions.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    cap: 'dispatch',
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
  {
    cap: 'channel',
    name: 'channel_reply',
    description: 'Send a message back to the person (Slack/Telegram) whose message you are handling right now. It goes to the thread of that message; you do not need to pass any id. Your normal text is NOT delivered to them, so always use this tool to answer. You may call it several times.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'The message to send. Short and conversational; Markdown is fine.' } },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    cap: 'skills',
    name: 'skill_read',
    description: 'Load the full instructions of one of your skills. Your instructions list your skills by name and description only; call this with the exact name when a task matches one, BEFORE doing that work, and follow what it returns.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Exact skill name, as listed in your instructions.' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    cap: 'memory',
    name: 'notebook_read',
    description: 'Read your notebook: the Markdown notes you keep across conversations. Returns the text and its version (needed by notebook_rewrite). Your current notes are already in your instructions, so call this only when you need the exact current text, e.g. before rewriting it.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    cap: 'memory',
    name: 'notebook_add',
    description: 'Save ONE short, durable note in your notebook under a section (e.g. Preferences, Infrastructure, Lessons, People & roles). One fact per note, one sentence, specific. Duplicates are skipped; credentials are refused. If the notebook is full you get an error asking you to tidy it with notebook_rewrite.',
    inputSchema: {
      type: 'object',
      properties: {
        section: { type: 'string', description: 'Section title; an existing one is reused (case-insensitive).' },
        note: { type: 'string', description: 'The note: one short sentence (max 500 characters).' },
      },
      required: ['section', 'note'],
      additionalProperties: false,
    },
  },
  {
    cap: 'memory',
    name: 'notebook_rewrite',
    description: 'Replace your whole notebook with a cleaned-up version: merge duplicates, remove outdated or wrong notes, shorten. Pass the version returned by notebook_read; if the notebook changed since, you get an error and must read it again. Keep the "## Section" + "- note" format.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The complete new notebook (Markdown).' },
        version: { type: 'integer', description: 'The version you read.' },
      },
      required: ['content', 'version'],
      additionalProperties: false,
    },
  },
  {
    cap: 'channel',
    name: 'channel_send_file',
    description: 'Send a file (image, PDF, report, document…) to the person or group whose message you are handling now. Give the full path of a file inside your working folder (create or copy it there first). Credentials, keys and databases are never sent. Do NOT use the platform API or any bot token yourself: this tool is the only way.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Full path of the file to send.' },
        caption: { type: 'string', description: 'Optional short text shown with the file.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    cap: 'channel',
    name: 'channel_mute',
    description: 'Keep quiet in the thread of the message you are handling (muted=true), or start taking part again (muted=false). Use it when people ask you to stop answering / be quiet / not to reply anymore, and when they ask you to talk again. It only affects this one thread (a group chat or a topic); other threads are untouched. While muted you are only woken when someone mentions you, replies to you or uses a command. Say a short goodbye with channel_reply first if it fits.',
    inputSchema: {
      type: 'object',
      properties: { muted: { type: 'boolean', description: 'true to stay quiet in this thread, false to take part again.' } },
      required: ['muted'],
      additionalProperties: false,
    },
  },
];
const tools = allTools.filter((t) => CAPS.has(t.cap)).map(({ cap, ...t }) => t);

async function call(name, args) {
  if (!tools.some((t) => t.name === name)) throw new Error(`Unknown tool ${name}`);
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
  if (name === 'channel_reply') {
    const r = await fetch(`${API}/api/channel/reply`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, text: args.text }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `channel_reply failed (${r.status})`);
    return j.sent ? `Sent (${j.parts} message${j.parts === 1 ? '' : 's'}).` : 'Nothing sent.';
  }
  if (name === 'skill_read') {
    const r = await fetch(`${API}/api/skills/read`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, name: args.name }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `skill_read failed (${r.status})`);
    return `# Skill: ${j.name}\n\n${j.content}`;
  }
  if (name === 'notebook_read' || name === 'notebook_add' || name === 'notebook_rewrite') {
    const r = await fetch(`${API}/api/notebook/${name.slice('notebook_'.length)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, ...args }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `${name} failed (${r.status})`);
    if (name === 'notebook_read') return `version: ${j.version} · ${j.size}/${j.max} characters\n\n${j.content || '(empty)'}`;
    const left = j.max - j.size;
    const tip = left < j.max * 0.2 ? ` The notebook is nearly full (${j.size}/${j.max}): tidy it soon with notebook_rewrite.` : '';
    if (name === 'notebook_add') return `${j.added ? 'Saved.' : j.note}${tip} (version ${j.version})`;
    return `Notebook replaced (version ${j.version}, ${j.size}/${j.max} characters).`;
  }
  if (name === 'channel_send_file') {
    const r = await fetch(`${API}/api/channel/send-file`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, path: args.path, caption: args.caption }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `channel_send_file failed (${r.status})`);
    return `Sent ${j.name} (${j.kind}).`;
  }
  if (name === 'channel_mute') {
    const r = await fetch(`${API}/api/channel/mute`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, muted: args.muted !== false }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `channel_mute failed (${r.status})`);
    return j.muted ? `Muted in this thread (${j.place}). You will only be woken when someone mentions you or replies to you.` : `Unmuted in this thread (${j.place}).`;
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
