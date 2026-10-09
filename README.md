<p align="center">
  <img src="web/public/logo.png" alt="hive-am" width="180" />
</p>

<h1 align="center">hive-am</h1>

<p align="center">
  <strong>A colony of coding agents on your machine.</strong><br />
  Orchestrators and subagents over <b>Claude Code</b>, <b>OpenCode</b> and <b>Kiro</b>, with the real sessions of each CLI, a browser UI and Telegram.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/hive-am"><img alt="npm version" src="https://img.shields.io/npm/v/hive-am?style=flat-square&color=cb3837&logo=npm&logoColor=white" /></a>
  <a href="https://www.npmjs.com/package/hive-am"><img alt="npm downloads" src="https://img.shields.io/npm/dm/hive-am?style=flat-square&color=cb3837" /></a>
  <a href="https://github.com/hughcbscrt/hive-am/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/hughcbscrt/hive-am?style=flat-square&color=bf963d" /></a>
  <a href="https://github.com/hughcbscrt/hive-am/pulls?q=is%3Apr"><img alt="Pull requests" src="https://img.shields.io/github/issues-pr-closed/hughcbscrt/hive-am?style=flat-square&color=bf963d" /></a>
  <a href="https://github.com/hughcbscrt/hive-am/issues"><img alt="Issues" src="https://img.shields.io/github/issues/hughcbscrt/hive-am?style=flat-square&color=bf963d" /></a>
  <a href="https://github.com/hughcbscrt/hive-am"><img alt="Repo size" src="https://img.shields.io/github/repo-size/hughcbscrt/hive-am?style=flat-square&color=bf963d" /></a>
  <a href="https://github.com/hughcbscrt/hive-am"><img alt="Top language" src="https://img.shields.io/github/languages/top/hughcbscrt/hive-am?style=flat-square&color=3178c6" /></a>
  <img alt="Node 20+" src="https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=nodedotjs&logoColor=white" />
  <img alt="Next.js 15" src="https://img.shields.io/badge/Next.js-15-000000?style=flat-square&logo=nextdotjs&logoColor=white" />
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-local-003B57?style=flat-square&logo=sqlite&logoColor=white" />
</p>

---

hive-am lets you create **orchestrators** and **subagents**, group them into **colonies**, give them **skills** and a **notebook**,
talk to them from the browser or from **Telegram**, and see everything they did, even after a blackout. It runs the CLIs you already
have installed; it does not replace them and it never copies your conversations into its own database.

## Highlights

- **Three providers, one place.** Claude Code, OpenCode and Kiro agents side by side, each with its own model.
- **Real sessions.** An agent stores only a pointer (`provider`, `session_id`, `cwd`). The transcript lives in the CLI's own store and is read back from there. After a restart every agent resumes its real session.
- **Orchestration.** An orchestrator delegates to the workers connected to it on the Relations canvas. Every delegation runs in a fresh native session of the worker, and the rule is enforced on the server, not just requested.
- **Colonies.** Group agents on a honeycomb map and lend them defaults: working folder, permissions, skills and a shared prompt. Each agent can opt out per field.
- **Skills.** Nine skills ship with hive-am (all ordinary: edit or delete them). Assign them to an agent, a type or a colony, and choose per assignment whether they are **always** in the instructions or loaded **on demand** with a `skill_read` tool. Searchable picker with token weights.
- **Notebook.** An agent can keep a persistent notebook of what it learns (no credentials, no duplicates, every note with its source). You can read and edit it from the agent's settings.
- **Telegram.** Link a bot to an agent: private chats, groups and topics, one shared session across all of them. In groups the agent can listen to everything and speak only when it adds something; people can mute it per thread and bring it back.
- **Files and images.** People send documents and photos to the agent; the agent sends files back. An optional image model can describe pictures for models that cannot see them.
- **Permissions that hold.** *Read-only*, *Edit files* and *Full access* are enforced by the CLI itself in all three providers.
- **Changes explorer.** A Git tab per agent: file tree with highlighting, diff viewer, history, commit, pull, push and branches.
- **Local and private.** The server binds to `127.0.0.1`. Data lives in `~/.hive-am/`.

## Providers

| Provider | Run a turn | Transcript source |
|---|---|---|
| Claude Code | `claude -p --output-format stream-json --resume <id>` | `~/.claude/projects/*/<id>.jsonl` |
| OpenCode | `opencode run --format json -s <id>` | `~/.local/share/opencode/opencode.db` (`session_message`) |
| Kiro | `kiro-cli chat --no-interactive --output-format stream-json --resume-id <id>` | `~/.kiro/sessions/cli/<id>.jsonl` |

Plain CLI processes, one per turn, not ACP. Turns are serialized per agent.

## Quick start

You need **Node 20+** (macOS or Linux) and at least one of the three CLIs installed and logged in (`claude`, `opencode` or `kiro-cli`).

### From npm

```bash
npx hive-am                 # run it without installing anything
```

or install it once and run it whenever you want:

```bash
npm install -g hive-am
hive-am
```

Open <http://127.0.0.1:4401>, create an agent pointing at a folder, and send it a message.

- The API server uses port **4400** and the web UI port **4401**. Change the UI port with `HIVE_AM_WEB_PORT=4500 hive-am`; the API port is fixed in the packaged build.
- Stop it with `Ctrl+C`.
- Update with `npm install -g hive-am@latest` (with `npx`, use `npx hive-am@latest`).
- `hive-am --help` and `hive-am --version` show the options and the installed version.

### From source

```bash
git clone git@github.com:hughcbscrt/hive-am.git
cd hive-am
npm install
npm run dev        # server :4400 (API + WebSocket) and Next.js UI :4401
```

Data lives in `~/.hive-am/hive-am.db` (override with `HIVE_AM_HOME`). The server only listens on `127.0.0.1`.

## Permission levels

| Level | Claude Code | OpenCode | Kiro |
|---|---|---|---|
| **Read-only** | `--permission-mode plan` | edit, shell and subagents denied | no tool trusted |
| **Edit files** | `acceptEdits`, `.git` and keys protected | edits (`.env` included), no shell, only inside the agent's folder | same |
| **Full access** | `bypassPermissions` | no restrictions | `--trust-all-tools` |

In *Edit files* the agent cannot touch `.git` or private keys (`*.pem`, `*.key`) and cannot write outside its folder. Details and the
few differences between providers are in [docs/06](docs/reference/en/06-providers.md) and [docs/12](docs/reference/en/12-operations-and-troubleshooting.md).

## Connections (Telegram)

1. Create a bot with @BotFather and copy its token.
2. In **Connections**, add a Telegram connection, pick the agent that answers, and list the people (and groups) allowed to talk to it.
3. Optional: set the group mode (`mention` or `open`), an alias, whether files are accepted, and an image model.

The agent answers through a `channel_reply` tool: its plain text is never delivered. Only authorized people and groups reach it,
checked on the server. The bot token is stored in `~/.hive-am/hive-am.db` and never returned by the API; see the note about it in
[docs/14](docs/reference/en/14-external-connections.md).

## How it is built

- `server/`: TypeScript. SQLite entities, provider runners, native history readers, the per-agent turn queue, REST and WebSocket.
  - `src/instructions.ts`: what each agent is told (identity, skills, team, channels, notebook) and which hive tools it gets.
  - `src/connections/`: external connections. One agent session shared by every chat, group or topic.
  - `src/skills/`: the skills that ship with hive-am and the agent notebook.
  - `mcp/dispatch.mjs`: the `hive` MCP server: `list_agents` and `dispatch` for orchestrators, `channel_*` for connections, `notebook_*` and `skill_read`.
- `web/`: Next.js 15 UI. Colony (honeycomb), Agents, the agent workspace (chat, changes, settings, notebook, sessions), Relations canvas, Types, Skills, Connections and Sessions.

## Documentation

Full documentation in English and Spanish: **[English](docs/reference/en/README.md)** · **[Español](docs/reference/es/README.md)**.

| Topic | Where |
|---|---|
| Overview and architecture | [docs/01](docs/reference/en/01-overview.md) |
| Folder structure | [docs/02](docs/reference/en/02-project-structure.md) |
| Storage and database | [docs/04](docs/reference/en/04-storage.md) |
| Providers and permissions | [docs/06](docs/reference/en/06-providers.md) |
| Agents, types, skills and colonies | [docs/07](docs/reference/en/07-agents-types-skills-colonies.md) |
| Orchestration and relations | [docs/09](docs/reference/en/09-orchestration-and-relations.md) |
| Changes explorer (git) | [docs/13](docs/reference/en/13-changes-explorer-git.md) |
| External connections | [docs/14](docs/reference/en/14-external-connections.md) |
| Operation and troubleshooting | [docs/12](docs/reference/en/12-operations-and-troubleshooting.md) |

## Known limits

- Claude fixes the system prompt when a session starts, so changed instructions reach a resumed session as an update inside the next message (OpenCode and Kiro get them the same way).
- A turn in flight during a crash is lost; the session is intact and the agent is idle on restart.
- Instructions are advice to the model; what the server enforces is who an agent can delegate to, who a connection answers, which files can be sent, and the permission level.
- There is no automated test suite. Features are checked with simulations against real agents (`server/scripts/sim-*.ts`).
