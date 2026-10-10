#!/usr/bin/env node
// Minimal MCP stdio server for hive-am agents. Tool groups come from HIVE_CAPS:
//   dispatch → list_agents, dispatch (orchestrators with a team)
//   channel  → channel_reply, channel_send_file, channel_mute (agents linked to Telegram/Slack)
//   wake     → wake_me, wake_when_done, schedule_create, schedule_list, schedule_cancel (agents with the Wake-ups skill: to be woken later in the same place)
//   objects  → object_list, object_logs, object_action (agents with the Colony objects skill: the servers and containers of their colony)
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
  {
    cap: 'objects',
    name: 'object_list',
    description: 'List the objects of your colony (servers and Docker containers that hive-am keeps running): name, kind, state (running, starting, stopped, error, unknown) and the reason when there is one. Use the exact names in the other object tools.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    cap: 'objects',
    name: 'object_logs',
    description: 'Read the latest output of an object of your colony (a server or a container). Read it before restarting something that fails. Logs can contain secrets: never repeat them in a chat.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The exact name of the object, as object_list shows it.' },
        tail: { type: 'number', description: 'How many of the last lines to read (default 80, at most 500).' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    cap: 'objects',
    name: 'object_action',
    description: 'Start, stop or restart an object of your colony. Not available in read-only mode. It answers with the state it ended in: check it with object_list a moment later, since a server can take a while to come up. Starting, stopping and restarting interrupt whoever uses it: do not do it for something that runs fine unless you were asked.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The exact name of the object.' },
        action: { type: 'string', enum: ['start', 'stop', 'restart'] },
      },
      required: ['name', 'action'],
      additionalProperties: false,
    },
  },
  {
    cap: 'wake',
    name: 'wake_me',
    description: 'Schedule yourself to be woken up after some minutes, in the same place where you were asked (the same chat thread, or the same web conversation). You can only write while you are handling a message, so this is the ONLY way to tell the person something later (for example when a long deploy or job should be finished). When the time comes you receive a message with your note, check what you were waiting for and answer. Never promise "I will let you know" without calling this first.',
    inputSchema: {
      type: 'object',
      properties: {
        minutes: { type: 'number', description: 'Minutes from now, between 1 and 240.' },
        note: { type: 'string', description: 'What to check when you wake up and what to tell the person (for example: check ~/job.log, report if it finished or failed). Up to 400 characters.' },
      },
      required: ['minutes', 'note'],
      additionalProperties: false,
    },
  },
  {
    cap: 'wake',
    name: 'wake_when_done',
    description: 'Be woken up THE MOMENT a command you started in the background finishes, in the same place where you were asked (the same chat thread, or the same web conversation), to read the result and tell the person. Start the command yourself in the background with its output in a log (for example `nohup ./deploy.sh > ~/deploy.log 2>&1 & echo $!`; for a job on another machine run the ssh itself in the background: `nohup ssh host \'./job.sh\' > ~/job.log 2>&1 & echo $!`, because the local ssh lives as long as the remote command), then call this with that pid. hive-am only watches the process; it never runs anything. If the process is already gone, check the result now instead. You can also give a marker file that the job creates when it ends. If it is still running after max_minutes you are woken anyway. Never promise "I will tell you when it finishes" without calling this first.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Process id of the background command (the output of `echo $!` right after starting it).' },
        log: { type: 'string', description: 'Path of the file where its output goes; you will be told it when you wake up.' },
        file: { type: 'string', description: 'Optional: a marker file that the job creates when it ends; waking up also happens when it appears (must be in your working folder, home or temp).' },
        note: { type: 'string', description: 'What to check and report when it finishes (up to 400 characters).' },
        max_minutes: { type: 'number', description: 'How long to wait at most, 1 to 240 (default 120).' },
      },
      required: ['pid', 'note'],
      additionalProperties: false,
    },
  },
  {
    cap: 'wake',
    name: 'schedule_create',
    description: 'Create a RECURRING schedule: at each run you are woken up in the same place where you were asked (the same chat thread, or the same web conversation), with your note, and you do what it says and tell the person. Use "cron" (5 fields: minute hour day-of-month month day-of-week, e.g. "0 9 * * MON-FRI") or "every_minutes". The minimum gap between runs is 15 minutes. For something that happens once, use wake_me instead. The answer gives the next run times: tell them to the person.',
    inputSchema: {
      type: 'object',
      properties: {
        cron: { type: 'string', description: 'Cron expression, e.g. "30 8 * * MON-FRI" (weekdays 08:30) or "0 */6 * * *" (every 6 hours).' },
        every_minutes: { type: 'number', description: 'Alternative to cron: a fixed interval in minutes (15 or more).' },
        timezone: { type: 'string', description: 'IANA time zone for cron, e.g. "America/Mexico_City". Defaults to the server time zone.' },
        note: { type: 'string', description: 'What to do at each run and what to report (up to 400 characters).' },
      },
      required: ['note'],
      additionalProperties: false,
    },
  },
  {
    cap: 'wake',
    name: 'schedule_list',
    description: 'List your recurring schedules (id, when, note, next run, last result).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    cap: 'wake',
    name: 'schedule_cancel',
    description: 'Cancel one of your recurring schedules by id (see schedule_list).',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'The schedule id.' } }, required: ['id'], additionalProperties: false },
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
  if (name === 'object_list' || name === 'object_logs' || name === 'object_action') {
    const r = await fetch(`${API}/api/agent-objects/${name.slice('object_'.length)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, ...args }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `${name} failed (${r.status})`);
    if (name === 'object_list') {
      if (!j.objects.length) return 'Your colony has no objects.';
      return j.objects.map((o) => `${o.name} · ${o.kind} · ${o.status}${o.detail ? ` (${o.detail})` : ''}`).join('\n');
    }
    if (name === 'object_logs') return j.text.trim() ? `Last lines of ${j.name}:\n${j.text}` : `${j.name} has not printed anything.`;
    return `${j.name}: ${j.status}${j.detail ? ` (${j.detail})` : ''}. Check again with object_list in a moment.`;
  }
  if (name === 'wake_me') {
    const r = await fetch(`${API}/api/wake`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, minutes: args.minutes, note: args.note }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `wake_me failed (${r.status})`);
    return `Wake-up scheduled for ${j.at} (in ${j.minutes} min), ${j.where === 'thread' ? 'in this same thread' : 'in this same conversation'}. Tell the person that exact time.`;
  }
  if (name === 'wake_when_done') {
    const r = await fetch(`${API}/api/wake-when-done`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, pid: args.pid, log: args.log, file: args.file, note: args.note, max_minutes: args.max_minutes }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `wake_when_done failed (${r.status})`);
    return `${j.reused ? 'Already watching this process. ' : ''}Watching the process: you will be woken ${j.where === 'thread' ? 'in this same thread' : 'in this same conversation'} when it finishes (or at ${j.until} at the latest). Tell the person that, and that you will report the result then.`;
  }
  if (name === 'schedule_create') {
    const r = await fetch(`${API}/api/schedules/create`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, cron: args.cron, every_minutes: args.every_minutes, timezone: args.timezone, note: args.note }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `schedule_create failed (${r.status})`);
    return `Schedule created (id ${j.id}): ${j.schedule}, ${j.where === 'thread' ? 'in this same thread' : 'in this same conversation'}. Next runs: ${j.next.join(' · ')}. Tell the person.`;
  }
  if (name === 'schedule_list') {
    const r = await fetch(`${API}/api/schedules/list`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: FROM }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `schedule_list failed (${r.status})`);
    return j.schedules.length ? j.schedules.map((s) => `- ${s.id}: ${s.schedule}${s.enabled ? '' : ' [paused]'} · next ${s.next ?? '-'} · last ${s.last ?? 'never'} · ${s.note}`).join('\n') : 'You have no recurring schedules.';
  }
  if (name === 'schedule_cancel') {
    const r = await fetch(`${API}/api/schedules/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: FROM, id: args.id }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `schedule_cancel failed (${r.status})`);
    return 'Schedule cancelled.';
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
