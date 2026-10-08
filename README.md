# hive-am

Agent manager for orchestrator/subagent setups over **Claude Code**, **OpenCode** and **Kiro**.

The conversation is never copied or summarised into a database. Each agent stores only a pointer
(`provider`, `session_id`, `cwd`); the transcript lives in the CLI's own store and is read back from there:

| Provider | Run a turn | Transcript source |
|---|---|---|
| Claude Code | `claude -p --output-format stream-json --resume <id>` | `~/.claude/projects/*/<id>.jsonl` |
| OpenCode | `opencode run --format json -s <id>` | `~/.local/share/opencode/opencode.db` (`session_message`) |
| Kiro | `kiro-cli chat --no-interactive --output-format stream-json --resume-id <id>` | `~/.kiro/sessions/cli/<id>.jsonl` |

After a blackout, restart and every agent resumes its real session. Not ACP: plain CLI processes.

## Documentación

Documentación completa en español (estructura, funcionamiento, almacenamiento, API, proveedores, sesiones, chat y más): **[docs/README.md](docs/README.md)**.

## Run

```bash
npm install
npm run dev        # server :4400 (API + WS) and Next.js UI :4401
```

Data: `~/.hive-am/hive-am.db` (override with `HIVE_AM_HOME`). Server binds to 127.0.0.1 only.

## Layout

- `server/` — TypeScript: SQLite entities, provider runners, native history readers, per-agent turn queue, REST + WS.
- `server/src/instructions.ts` — what each agent is told (identity, skills, team, channels, notebook) and which hive tools it gets.
- `server/src/connections/` — external connections (Telegram): one agent session shared by every chat, group or topic.
- `server/src/skills/` — the skills that ship with hive-am and the agent notebook.
- `server/mcp/dispatch.mjs` — stdio MCP `hive`: `list_agents` / `dispatch` for orchestrators, `channel_*` for connections, `notebook_*` and `skill_read`; assignments are enforced server-side.
- `web/` — Next.js UI: Colony (honeycomb), Agents, agent workspace (chat + changes + config + notebook + sessions), Relations canvas, Types, Skills, Connections, Sessions.

## Colonies

A colony groups agents on the Colony map (an outline hugging only their hexagons) and lends them defaults:
working folder, permissions, skills (added to the agent's own) and a shared prompt (placed before the agent's own).
Provider and model are never inherited. On every save the UI asks which of those members follow; each agent can opt out per field.
Delegation is unchanged and independent of colonies: an orchestrator can only dispatch to workers directly connected to it.
If an agent's effective folder changes, its next turn starts a fresh native session (older ones stay in its Sessions tab).

## Delegations

Every delegation runs in a **fresh native session** of the worker, tagged with the orchestrator and the task. The worker's own
conversation (what you chat about with it directly) never contains delegated work; those sessions live under Settings → Sessions → Delegated tasks.
Each agent's system prompt starts with who it is (name, role, purpose), its working folder and colony; orchestrators are told their
direct subagents are the only agents they know.

## Skills and the notebook

Skills come in two modes, chosen where they are assigned (agent, type or colony): **always** (the whole text is in the agent's
instructions) or **on demand** (only name + description are, and the agent reads the rest with `skill_read` when a task needs it).
Seven general skills ship with hive-am (they are ordinary skills: edit or delete them). One of them, **Notebook**, gives an agent a
persistent notebook it writes by itself and you can read and edit from its settings.

## Known limits

- Claude fixes the system prompt when a session starts, so changed instructions reach a resumed session as an update inside the next message (the same way OpenCode and Kiro get them).
- A turn in flight during a crash is lost; the session is intact and the agent is idle on restart.
