#!/usr/bin/env node
// Minimal MCP stdio server for hive-am agents. Tool groups come from HIVE_CAPS:
//   dispatch → list_agents, dispatch, dispatch_status, dispatch_list, dispatch_cancel (orchestrators with a team)
//   channel  → channel_reply, channel_send_file, channel_react, channel_mute (agents linked to Telegram/Slack)
//   wake     → wake_me, wake_when_done, schedule_create, schedule_list, schedule_cancel (agents with the Wake-ups skill: to be woken later in the same place)
//   objects  → object_list, object_logs, object_action (agents with the Colony objects skill: the servers and containers of their colony)
//   databases → object_db_* (agents with the Database management skill: the database resources of their colony)
//   colonies → colony_* (agents with the Colony builder skill: colonies, agents and resources of any colony)
// It only talks to the hive-am HTTP API; all rules (assignments, queueing) live there.
import { createInterface } from 'node:readline';

const API = process.env.HIVE_AM_API ?? 'http://127.0.0.1:4400';
const FROM = process.env.HIVE_AGENT_ID;
const CAPS = new Set((process.env.HIVE_CAPS ?? 'dispatch').split(',').filter(Boolean));
// A synchronous dispatch waits with dispatch_status calls of this many seconds each, so no request lasts long enough to hit a client timeout.
const POLL_S = Math.min(60, Math.max(1, Number(process.env.HIVE_AM_DISPATCH_POLL_S) || 25));

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
    description: 'Send a self-contained task to one of your subagents. By default the call returns at once with a task id and the answer arrives later as a message to you (you can also ask with dispatch_status), so you can answer the person or delegate more meanwhile. Set background: false only for a very short task whose answer you need right now: the call then waits for the final answer. Every delegation starts a fresh conversation for the subagent, so include all the context it needs.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Exact subagent name from list_agents' },
        task: { type: 'string', description: 'Full instructions for the subagent; include all context it needs.' },
        background: { type: 'boolean', description: 'Return at once with a task id (default true). The result is sent to you as a message when the subagent finishes. Set false to wait for the final answer in this call.' },
      },
      required: ['agent', 'task'],
      additionalProperties: false,
    },
  },
  {
    cap: 'dispatch',
    name: 'dispatch_status',
    description: 'State of a task you delegated: queued, running, done, failed, interrupted or cancelled, with the result once it has finished. With wait_seconds it waits up to that long for the end before answering.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The task id that dispatch returned' },
        wait_seconds: { type: 'number', minimum: 0, maximum: 60, description: 'Wait up to this many seconds (0 to 60, default 0) for the task to finish.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    cap: 'dispatch',
    name: 'dispatch_list',
    description: 'List the tasks you delegated that have not finished yet (queued or running), with their id, subagent, state and age, oldest first.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    cap: 'dispatch',
    name: 'dispatch_cancel',
    description: 'Cancel a task you delegated that is no longer needed (sent by mistake, wrong context, or the plan changed). A queued task never starts; a running one is stopped at once, and what the subagent already changed stays in the folder, so check it before delegating again. A task that already finished is left as it is and its state is answered. You are not sent a message about a task you cancel.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The task id that dispatch returned' } },
      required: ['id'],
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
    name: 'channel_react',
    description: 'React with ONE emoji to the message you are handling (a thumbs-up to say "got it", a heart to say thanks). It is lighter than a reply and counts as your answer when nothing else needs saying. Each platform allows only some emoji (on Telegram a fixed list: 👍 👎 ❤ 🔥 👏 🎉 🙏 👌 👀 💯 🤔 😁 😢 ✍ 🫡 …; on Slack a wider set, by emoji or as :name:); an emoji that is not allowed is refused and the error lists the ones you can use. Follow the "Chat channels" skill for when to react.',
    inputSchema: {
      type: 'object',
      properties: { emoji: { type: 'string', description: 'A single emoji, e.g. 👍.' } },
      required: ['emoji'],
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

// ---- Database management (cap `databases`): one tool per operation, all answered by POST /api/agent-objects/db/<op> ----
const NAME = { type: 'string', description: 'The exact name of the database resource, as object_db_list shows it.' };
const DB = { type: 'string', description: 'Another database of the same server to use instead of the one the resource opens by default (see object_db_schema).' };
const SCHEMA = { type: 'string', description: 'The schema (PostgreSQL, SQL Server), the database (MySQL) or "main" (SQLite), as object_db_schema shows it.' };
const TABLE = { type: 'string', description: 'The table or view name.' };
const dbTool = (name, description, properties = {}, required = []) => ({ cap: 'databases', name: `object_db_${name}`, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } });
const dbTools = [
  dbTool('list', 'List the database resources you look after: name, engine, database and state. Use these exact names in the other object_db tools.'),
  dbTool('schema', 'The structure of a database: the databases of the server, the current one and its tables and views (with a row estimate). Start here.', { name: NAME, database: DB }, ['name']),
  dbTool('columns', 'The columns of a table or view: name, type, nullable, key and default.', { name: NAME, schema: SCHEMA, table: TABLE, database: DB }, ['name', 'schema', 'table']),
  dbTool('describe', 'A table in full: columns, primary key, indexes, foreign keys and the number of rows.', { name: NAME, schema: SCHEMA, table: TABLE, database: DB }, ['name', 'schema', 'table']),
  dbTool('search', 'Find tables, views and columns whose name contains some text, across everything the connection can see.', { name: NAME, query: { type: 'string', description: 'Part of a name.' }, database: DB }, ['name', 'query']),
  dbTool('ddl', 'The CREATE statement of a table (with its indexes).', { name: NAME, schema: SCHEMA, table: TABLE, database: DB }, ['name', 'schema', 'table']),
  dbTool('sample', 'The first rows of a table or view, without writing SQL.', { name: NAME, schema: SCHEMA, table: TABLE, limit: { type: 'number', description: 'How many rows (default 10).' }, database: DB }, ['name', 'schema', 'table']),
  dbTool('query', 'Run ONE SQL statement: a read, or (not in read-only mode) a write or DDL. DROP and TRUNCATE need Full access. A result is cut at the resource\'s row limit and a query at its time limit. Writes are real and cannot be undone: say what you are about to change first. Results can contain secrets: never repeat them in a chat.', { name: NAME, sql: { type: 'string', description: 'One SQL statement.' }, database: DB }, ['name', 'sql']),
  dbTool('exec', 'Run several SQL statements as ONE transaction: all are applied or none (a failure says which statement it was). Not in read-only mode; DROP and TRUNCATE need Full access and one of them refuses the whole script. MySQL commits by itself on CREATE, ALTER and DROP, so a DDL in the middle cannot be undone there.', { name: NAME, sql: { type: 'string', description: 'Statements separated by ;' }, database: DB }, ['name', 'sql']),
  dbTool('explain', 'The execution plan of a statement, without running it.', { name: NAME, sql: { type: 'string', description: 'One SQL statement.' }, database: DB }, ['name', 'sql']),
  dbTool('export', 'Write the result of a query to a CSV or JSON file inside your own working folder. It never writes outside it and never overwrites a file unless overwrite is true. Not in read-only mode.', { name: NAME, sql: { type: 'string', description: 'The query.' }, format: { type: 'string', enum: ['csv', 'json'] }, file: { type: 'string', description: 'The file, relative to your working folder.' }, overwrite: { type: 'boolean' }, database: DB }, ['name', 'sql', 'format', 'file']),
  dbTool('saved', 'The named queries saved on a resource: list them, or add, update or remove one (not in read-only mode). A password in the text is replaced by ***.', { name: NAME, op: { type: 'string', enum: ['list', 'add', 'update', 'remove'] }, id: { type: 'string', description: 'The id of the saved query (update, remove).' }, query_name: { type: 'string', description: 'Its name (add, update).' }, sql: { type: 'string', description: 'Its text (add, update).' }, database: DB }, ['name', 'op']),
  dbTool('history', 'The last 200 queries run on a resource (by people and by agents), or clear them (not in read-only mode).', { name: NAME, op: { type: 'string', enum: ['list', 'clear'] } }, ['name', 'op']),
  dbTool('sessions', 'Who is connected to the server and what they are running (MySQL, PostgreSQL, SQL Server). Not in read-only mode.', { name: NAME }, ['name']),
  dbTool('kill', 'Cancel what a session is running (MySQL, PostgreSQL) or end the session (SQL Server). Full access only. It can interrupt other people: look at object_db_sessions first and do it only when asked.', { name: NAME, id: { type: 'number', description: 'The session id from object_db_sessions.' } }, ['name', 'id']),
  dbTool('config', 'How a resource connects: engine, host, port, user, database, SSL, driver properties and limits. The password is never shown: passwordSet says whether one exists.', { name: NAME }, ['name']),
  dbTool('config_set', 'Change how a resource connects (Full access only). Give only the fields to change inside config; the engine cannot change. The new connection is tested first and nothing is saved if it fails. A password you give is stored and never shown again: do not repeat it anywhere. Can also rename it, move it to your colony or out of any, and choose the agent that looks after it.', { name: NAME, config: { type: 'object', description: 'Fields to change: host, port, user, password, database, file (SQLite), ssl, trustCert, props, readOnly, timeoutSec, maxRows.' }, new_name: { type: 'string' }, colony_id: { type: 'string', description: '"mine" (your colony) or "none".' }, manager_id: { type: 'string', description: 'An agent name or id, "me", or "none" to leave it to the colony.' } }, ['name']),
  dbTool('test', 'Test a connection: a saved resource by name, or (Full access) a configuration that is not saved yet.', { name: { type: 'string', description: 'A saved resource to test.' }, config: { type: 'object', description: 'A draft configuration to test instead (Full access).' } }),
  dbTool('create', 'Create a database resource (Full access only). The connection is tested first and nothing is created if it fails. It is created in your colony (or none) and you become the agent that looks after it. A password in config is stored and never shown again: do not repeat it anywhere.', { name: { type: 'string', description: 'The name of the new resource.' }, config: { type: 'object', description: 'engine (mysql, postgresql, sqlite, mssql) and host, port, user, password, database (or file for SQLite), ssl, trustCert, props, readOnly, timeoutSec, maxRows.' }, colony_id: { type: 'string', description: '"mine" (default) or "none".' } }, ['name', 'config']),
  dbTool('delete', 'Delete a database resource (Full access only). The database itself is not touched: only hive-am forgets the connection, its saved queries and its history.', { name: NAME }, ['name']),
];
allTools.push(...dbTools);

// ---- Colony builder (cap `colonies`): one tool per operation, all answered by POST /api/agent-colonies/<op> (`colony_agent_list` → agent_list) ----
const CNAME = (what) => ({ type: 'string', description: `The exact name of the ${what} (case does not matter).` });
const COLONY_REF = { type: ['string', 'null'], description: 'A colony name, or null / "none" for no colony.' };
const SKILLS = { type: 'array', description: 'The whole list of skills (it replaces the old one): [{ name, load }] with load always or on_demand (default: the skill\'s own). See colony_skill_list.', items: { type: 'object', properties: { name: { type: 'string' }, load: { type: 'string', enum: ['always', 'on_demand'] } }, required: ['name'] } };
const PERMISSION = { type: 'string', enum: ['plan', 'acceptEdits', 'bypassPermissions'], description: 'plan = read-only, acceptEdits = edit files, bypassPermissions = Full access (only when the person asked for it).' };
const CONFIRM = { type: 'string', description: 'The exact name of what is deleted, ONLY after the person said yes to deleting it. Without it nothing is deleted and the answer says what would be.' };
const colonyFields = {
  color: { type: 'string', description: 'A CSS color, e.g. #2f8f5b.' }, cwd: { type: 'string', description: 'The shared folder (absolute path; it must exist).' }, permission: PERMISSION,
  system_prompt: { type: 'string', description: 'The colony prompt, placed before the prompt of each member that inherits it.' }, skills: SKILLS,
  inherit: { type: 'object', description: 'Which fields members follow by default: { cwd, permission, skills, prompt } as true or false.', properties: { cwd: { type: 'boolean' }, permission: { type: 'boolean' }, skills: { type: 'boolean' }, prompt: { type: 'boolean' } }, additionalProperties: false },
};
const agentFields = {
  description: { type: 'string', description: 'One line: what it delivers and what it does not do. The orchestrator reads it to choose.' }, role: { type: 'string', enum: ['orchestrator', 'worker'] },
  provider: { type: 'string', enum: ['claude', 'opencode', 'kiro', 'cursor'] }, model: { type: 'string', description: 'A model id from colony_options (empty: the CLI\'s default).' },
  effort: { type: 'string', description: 'A level the model takes (colony_options), or empty for the CLI\'s default.' }, permission: PERMISSION,
  cwd: { type: 'string', description: 'Its own working folder (absolute, it must exist). Leave it out to use the colony\'s.' }, system_prompt: { type: 'string', description: 'Its own prompt (it comes after the colony\'s).' },
  browser: { type: 'boolean', description: 'Claude only: let it drive the person\'s Chrome.' }, colony: COLONY_REF,
  overrides: { type: 'array', items: { type: 'string', enum: ['cwd', 'permission', 'skills', 'prompt'] }, description: 'Fields where it ignores its colony and uses its own value (the whole list).' },
  skills: SKILLS, workers: { type: 'array', items: { type: 'string' }, description: 'Orchestrators only: the names of its workers (the whole list, it replaces the old one).' },
};
const resourceFields = {
  colony: COLONY_REF,
  config: { type: 'object', description: 'The same fields as the form of the web app. server: cwd, start, stop, env, port, restart, health… docker: mode (container, compose, existing) and image, ports, volumes, env… or file / container. http: folder, env, variables. database: engine (mysql, postgresql, sqlite, mssql), host, port, user, database, or file for SQLite, ssl, readOnly… (never a password). cluster: members (resource names).' },
};
const colonyTool = (name, description, properties = {}, required = []) => ({ cap: 'colonies', name: `colony_${name}`, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } });
const colonyTools = [
  colonyTool('options', 'What can be chosen when creating agents and resources: providers (installed or not), their models and the effort levels each takes, roles, permissions, inherited fields, skill loads and resource kinds. Give provider (and model) to see the levels of one model.', { provider: { type: 'string' }, model: { type: 'string' } }),
  colonyTool('list', 'List every colony: name, folder, permission, agents and skills.'),
  colonyTool('get', 'One colony in full: folder, permission, prompt, what its members inherit, skills with their load, and agents.', { name: CNAME('colony') }, ['name']),
  colonyTool('create', 'Create a colony. Ask the person first and show the plan. Add agents afterwards (colony_agent_create with colony, or colony_update with agents).', { name: { type: 'string' }, ...colonyFields }, ['name']),
  colonyTool('update', 'Change a colony: only what you send changes (skills and agents replace their whole list). It reaches every member that inherits from it. A change that would take away your own access is refused and nothing changes.', { name: CNAME('colony'), new_name: { type: 'string' }, ...colonyFields, agents: { type: 'array', items: { type: 'string' }, description: 'The names of ALL its members (agents not listed leave it).' } }, ['name']),
  colonyTool('delete', 'Delete a colony (its agents stay, without a colony). Only after the person said yes: call it first without confirm to see what goes with it.', { name: CNAME('colony'), confirm: CONFIRM }, ['name']),
  colonyTool('agent_list', 'List every agent (or the ones of one colony): name, role, provider, model, effective permission, colony, description and status.', { colony: COLONY_REF }),
  colonyTool('agent_get', 'One agent in full: its own fields and prompt, skills with their load, workers, orchestrators, overrides, what it inherits and what it really runs with (effective).', { name: CNAME('agent') }, ['name']),
  colonyTool('agent_create', 'Create an agent with the same checks as the web app (unique name, existing folder, a provider and an effort the model takes). Ask the person first and show the plan.', { name: { type: 'string', description: 'Role - Name - ACRONYM, different from every other.' }, ...agentFields }, ['name', 'provider']),
  colonyTool('agent_update', 'Change an agent: only what you send changes (skills, workers and overrides replace their whole list). A change that would take away your own access, or leave you read-only, is refused and nothing changes.', { name: CNAME('agent'), new_name: { type: 'string' }, ...agentFields }, ['name']),
  colonyTool('agent_delete', 'Delete an agent (a turn it runs is stopped). Only after the person said yes: call it first without confirm to see what goes with it. Not yourself, your orchestrator, an agent you have a task open with, or one linked to a chat connection.', { name: CNAME('agent'), confirm: CONFIRM }, ['name']),
  colonyTool('skill_list', 'List the skills that can be assigned: name, description, suggested load and how many agents and types use each.'),
  colonyTool('resource_list', 'List the resources of every colony (or of one): name, kind, colony, state and the agent that looks after it.', { colony: COLONY_REF }),
  colonyTool('resource_get', 'One resource with its configuration. Passwords and secret variables come empty and env values as ***.', { name: CNAME('resource') }, ['name']),
  colonyTool('resource_create', 'Create a resource in any colony. Never give a password or a secret variable: the person fills them in the web app.', { name: { type: 'string' }, kind: { type: 'string', enum: ['server', 'docker', 'http', 'database', 'cluster'] }, ...resourceFields }, ['name', 'kind', 'config']),
  colonyTool('resource_update', 'Change a resource: only the config keys you send change, and a saved password is kept. env is replaced whole: send every key you keep, the ones not to change as ***. HTTP variables merge by environment and name: a plain one is removed only by sending it as null, and a saved secret is kept and cannot be removed, emptied or made plain here.', { name: CNAME('resource'), new_name: { type: 'string' }, ...resourceFields }, ['name']),
  colonyTool('resource_delete', 'Delete a resource (a server is stopped first; a container hive-am created is removed). Only after the person said yes: call it first without confirm to see what goes with it.', { name: CNAME('resource'), confirm: CONFIRM }, ['name']),
  colonyTool('resource_manager', 'Choose the one agent that looks after a server, container, cluster or database (it gets the skill it needs), or null / "none" to leave it to the agents of its colony.', { name: CNAME('resource'), agent: { type: ['string', 'null'], description: 'An agent name, or null / "none".' } }, ['name']),
];
allTools.push(...colonyTools);
const tools = allTools.filter((t) => CAPS.has(t.cap)).map(({ cap, ...t }) => t);

// ---- how a database answer is written for the model ----
const cellText = (v) => (v === null || v === undefined ? 'NULL' : String(v).replace(/\r?\n/g, '\\n'));
const table = (columns, rows) => [columns.map((c) => c.name ?? c).join('\t'), ...rows.map((r) => r.map(cellText).join('\t'))].join('\n');
const resultText = (r) => {
  if (!r.columns?.length) return r.affected !== undefined ? `OK, ${r.affected} row${r.affected === 1 ? '' : 's'} affected (${r.ms ?? 0} ms).` : `OK (${r.ms ?? 0} ms).`;
  return `${table(r.columns, r.rows)}\n${r.rows.length} row${r.rows.length === 1 ? '' : 's'}${r.truncated ? ' (cut at the resource\'s row limit: ask for fewer rows or columns)' : ''} in ${r.ms ?? 0} ms.`;
};
const dbAnswer = (op, j) => {
  switch (op) {
    case 'list': return j.databases.length ? j.databases.map((d) => `${d.name} · ${d.engine}${d.database ? ` · ${d.database}` : ''} · ${d.status}${d.detail ? ` (${d.detail})` : ''}`).join('\n') : 'You look after no database resources.';
    case 'schema': return `${j.engine}, database ${j.database || '(none)'}${j.databases.length ? `. Databases on the server: ${j.databases.join(', ')}` : ''}.\n${j.tables.length ? j.tables.map((t) => `${t.schema}.${t.name} (${t.type}${t.rows !== undefined ? `, ~${t.rows} rows` : ''})`).join('\n') : 'No tables.'}`;
    case 'columns': return j.columns.length ? j.columns.map((c) => `${c.name} ${c.type}${c.nullable ? '' : ' NOT NULL'}${c.key ? ` ${c.key}` : ''}${c.default !== undefined && c.default !== null ? ` DEFAULT ${c.default}` : ''}`).join('\n') : 'No columns: that table does not exist.';
    case 'describe': return [`${j.schema}.${j.table}: ${j.rowCount ?? '?'} rows`, 'Columns:', ...j.columns.map((c) => `  ${c.name} ${c.type}${c.nullable ? '' : ' NOT NULL'}${c.key ? ` ${c.key}` : ''}`), `Primary key: ${j.primaryKey.join(', ') || '(none)'}`, 'Indexes:', ...(j.indexes.length ? j.indexes.map((i) => `  ${i.name}${i.unique ? ' UNIQUE' : ''} (${i.columns.join(', ')})`) : ['  (none)']), 'Foreign keys:', ...(j.foreignKeys.length ? j.foreignKeys.map((f) => `  ${f.name}: (${f.columns.join(', ')}) -> ${f.refSchema ? `${f.refSchema}.` : ''}${f.refTable} (${f.refColumns.join(', ')})`) : ['  (none)'])].join('\n');
    case 'search': return j.matches.length ? j.matches.map((m) => (m.column ? `${m.schema}.${m.table}.${m.column} (column)` : `${m.schema}.${m.table} (${m.type})`)).join('\n') : 'Nothing matches.';
    case 'ddl': return j.ddl;
    case 'sample': case 'query': case 'explain': case 'sessions': return resultText(j);
    case 'exec': return `${j.results.length} statement${j.results.length === 1 ? '' : 's'} applied in one transaction (${j.ms} ms).\n${j.results.map((r, n) => `${n + 1}. ${r.statement.replace(/\s+/g, ' ').slice(0, 80)}\n   ${resultText(r).split('\n').join('\n   ')}`).join('\n')}`;
    case 'export': return `Wrote ${j.rows} row${j.rows === 1 ? '' : 's'} as ${j.format} to ${j.file} (${j.bytes} bytes)${j.truncated ? ', cut at the resource\'s row limit' : ''}.`;
    case 'saved': return j.saved === undefined ? 'Done.' : Array.isArray(j.saved) ? (j.saved.length ? j.saved.map((q) => `${q.id} · ${q.name}${q.database ? ` (${q.database})` : ''}\n${q.sql}`).join('\n\n') : 'No saved queries.') : `Saved: ${j.saved.id} · ${j.saved.name}`;
    case 'history': return j.cleared ? 'History cleared.' : j.history.length ? j.history.map((h) => `${new Date(h.at).toISOString().slice(0, 19)} ${h.ok ? 'ok' : 'FAILED'}${h.by ? ` (${h.by})` : ''} ${h.sql.replace(/\s+/g, ' ').slice(0, 160)}${h.error ? ` -> ${h.error}` : ''}`).join('\n') : 'No history.';
    case 'kill': return j.text;
    case 'config': return JSON.stringify({ name: j.name, ...j.config }, null, 2);
    case 'test': return `Connection works: ${j.version} (${j.ms} ms).`;
    case 'create': return `Created the database resource "${j.name}" (${j.engine}). You look after it now.`;
    case 'config_set': return `Saved the connection of "${j.name}" after testing it.`;
    case 'delete': return `Deleted the database resource "${j.deleted}".`;
    default: return JSON.stringify(j);
  }
};

// ---- how a Colony builder answer is written for the model ----
const pretty = (j) => JSON.stringify(j, null, 2);
const list = (xs) => (xs?.length ? xs.join(', ') : '(none)');
const colonyAnswer = (op, j) => {
  switch (op) {
    case 'list': return j.colonies.length ? j.colonies.map((c) => `${c.name} · ${c.cwd || '(no folder)'} · ${c.permission} · agents: ${list(c.agents)} · skills: ${list(c.skills)}`).join('\n') : 'There are no colonies.';
    case 'agent_list': return j.agents.length ? j.agents.map((a) => `${a.name} · ${a.role} · ${a.provider}${a.model ? `/${a.model}` : ''} · ${a.permission} · ${a.colony ?? '(no colony)'} · ${a.status}${a.description ? `\n  ${a.description}` : ''}`).join('\n') : 'No agents.';
    case 'skill_list': return j.skills.map((s) => `${s.name} (${s.load}; ${s.agents} agent${s.agents === 1 ? '' : 's'}, ${s.types} type${s.types === 1 ? '' : 's'})${s.description ? `: ${s.description}` : ''}`).join('\n') || 'No skills.';
    case 'resource_list': return j.resources.length ? j.resources.map((o) => `${o.name} · ${o.kind} · ${o.colony ?? '(no colony)'} · ${o.status}${o.detail ? ` (${o.detail})` : ''}${o.manager ? ` · looked after by ${o.manager}` : ''}`).join('\n') : 'No resources.';
    case 'create': return `Created the colony "${j.colony.name}":\n${pretty(j.colony)}`;
    case 'update': return `Saved the colony "${j.colony.name}":\n${pretty(j.colony)}`;
    case 'agent_create': return `Created the agent "${j.agent.name}":\n${pretty(j.agent)}`;
    case 'agent_update': return `Saved the agent "${j.agent.name}":\n${pretty(j.agent)}`;
    case 'resource_create': return `Created the resource "${j.resource.name}":\n${pretty(j.resource)}`;
    case 'resource_update': return `Saved the resource "${j.resource.name}":\n${pretty(j.resource)}`;
    case 'resource_manager': return j.manager ? `${j.manager} looks after "${j.name}" now${j.skill_added ? ' (it was given the skill it needs)' : ''}.` : `"${j.name}" is left to the agents of its colony.`;
    case 'delete': case 'agent_delete': case 'resource_delete':
      if (!j.deleted) return `Nothing was deleted. This would delete ${j.would_delete}\nTell the person exactly this and wait for their explicit yes; only then call it again with confirm: "${j.name}".`;
      if (op !== 'delete') return `Deleted "${j.name}".`;
      return `Deleted the colony "${j.name}".${j.left_without_colony.length ? ` Left without a colony: ${j.left_without_colony.join(', ')}.` : ''}${j.without_folder.length ? ` With no working folder now (they cannot run until they get one): ${j.without_folder.join(', ')}.` : ''}`;
    default: return pretty(j);
  }
};

async function taskStatus(id, waitSeconds) {
  const r = await fetch(`${API}/api/dispatch/status`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from: FROM, id, wait_seconds: waitSeconds }),
  });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error(j.error ?? `dispatch_status failed (${r.status})`), { status: r.status });
  return j;
}

async function call(name, args) {
  if (!tools.some((t) => t.name === name)) throw new Error(`Unknown tool ${name}`);
  if (name === 'list_agents') {
    const r = await fetch(`${API}/api/orchestrators/${FROM}/workers`);
    return JSON.stringify(await r.json(), null, 2);
  }
  if (name === 'dispatch') {
    const background = args.background !== false;
    const r = await fetch(`${API}/api/dispatch`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, agent: args.agent, task: args.task, background, poll: !background }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `dispatch failed (${r.status})`);
    if (background) return `Task ${j.id} sent to ${j.agent} (${j.status}). You will be woken with the result when it finishes; you can also ask with dispatch_status.`;
    // Wait for the end with short calls: the answer is read from the server's record, never from one long request.
    for (let errors = 0; ;) {
      let s;
      try { s = await taskStatus(j.id, POLL_S); errors = 0; } catch (e) {
        if (e.status || ++errors > 5) throw new Error(`${e.message}. The task ${j.id} goes on: ask for its result with dispatch_status.`);
        await new Promise((ok) => setTimeout(ok, 2000));
        continue;
      }
      if (s.status === 'done') return s.result;
      if (s.status === 'failed' || s.status === 'interrupted') throw new Error(`${j.agent} did not finish the task (${s.status}): ${s.result}`);
      if (s.status === 'cancelled') throw new Error(`${j.agent} task was cancelled: ${s.result}`);
    }
  }
  if (name === 'dispatch_status') {
    const s = await taskStatus(args.id, args.wait_seconds);
    return `Task ${s.id} for ${s.agent}: ${s.status}.${s.note ? ` ${s.note}` : ''}${s.result !== undefined ? ` Result:\n${s.result}` : ' Not finished yet.'}`;
  }
  if (name === 'dispatch_list') {
    const r = await fetch(`${API}/api/dispatch/list`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `dispatch_list failed (${r.status})`);
    const age = (s) => (s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);
    return j.length ? j.map((t) => `${t.id} · ${t.agent} · ${t.status} · ${t.mode} · ${age(t.age_s)} ago\n  ${t.task.replace(/\s+/g, ' ')}`).join('\n') : 'You have no delegated tasks that have not finished.';
  }
  if (name === 'dispatch_cancel') {
    const r = await fetch(`${API}/api/dispatch/cancel`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, id: args.id }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `dispatch_cancel failed (${r.status})`);
    if (!j.cancelled) return `Task ${j.id} for ${j.agent} had already finished (${j.status}); nothing changed.${j.result !== undefined ? ` Result:\n${j.result}` : ''}`;
    return j.was === 'running'
      ? `Task ${j.id} for ${j.agent} cancelled: ${j.agent} was working on it and was stopped. What it already changed stays in the folder; check it before delegating again.`
      : `Task ${j.id} for ${j.agent} cancelled before it started.`;
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
  if (name === 'channel_react') {
    const r = await fetch(`${API}/api/channel/react`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, emoji: args.emoji }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `channel_react failed (${r.status})`);
    return `Reacted with ${j.emoji}.`;
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
  if (name.startsWith('object_db_')) {
    const op = name.slice('object_db_'.length);
    const r = await fetch(`${API}/api/agent-objects/db/${op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: FROM, ...args }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `${name} failed (${r.status})`);
    return dbAnswer(op, j);
  }
  if (name.startsWith('colony_')) {
    const op = name.slice('colony_'.length);
    const r = await fetch(`${API}/api/agent-colonies/${op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: FROM, ...args }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `${name} failed (${r.status})`);
    return colonyAnswer(op, j);
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
