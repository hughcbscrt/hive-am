# 2. Project structure

hive-am is an **npm workspaces** monorepo with two packages: `server` (backend) and `web` (frontend).

```
hive-am/
├── package.json              # root: workspaces + dev/build/typecheck scripts
├── package-lock.json
├── README.md                 # summary and quick start
├── .gitignore
├── docs/                     # this documentation (reference/en and reference/es)
├── server/                   # @hive-am/server — Node + TypeScript backend
│   ├── package.json
│   ├── tsconfig.json
│   ├── mcp/
│   │   └── dispatch.mjs      # `hive` MCP server (stdio): delegation, channel, notebook and skills
│   ├── scripts/              # simulations with real agents (sim-*.ts) and a fake Telegram API
│   └── src/
│       ├── index.ts          # server ENTRY POINT
│       ├── api.ts            # REST routes, validation, CORS
│       ├── runtime.ts        # per-agent queue, turns, delegation, event bus
│       ├── instructions.ts   # what an agent is told (composed instructions) and which MCP tools it gets
│       ├── db.ts             # SQLite schema, migrations, data access
│       ├── types.ts          # shared backend types
│       ├── seed.ts           # first-run initial data
│       ├── models.ts         # list of models per provider (cached)
│       ├── pricing.ts        # cost estimate and token-usage sums
│       ├── stats.ts          # session statistics (tokens, tools, timeline)
│       ├── mcp-config.ts     # API port and MCP configuration for each provider
│       ├── git/
│       │   ├── repo.ts       # git reads for the changes explorer
│       │   ├── ops.ts        # history, branches and git actions (commit, pull, push…)
│       │   └── switch.ts     # smart branch switch (stash and reapply)
│       ├── skills/
│       │   ├── defaults.ts   # the skills that ship with hive-am (created once on install)
│       │   └── notebook.ts   # agent notebook: table, limits, notes and credential detection
│       ├── connections/      # external connections (Telegram) — see document 14
│       │   ├── types.ts      # ChannelAdapter, Inbound, Connection, Thread, Origin
│       │   ├── store.ts      # tables connections, threads, thread_messages, connection_cursor
│       │   ├── router.ts     # access, commands, groups, silence and delivery to the agent
│       │   ├── manager.ts    # running adapters, channel_reply and channel_mute
│       │   ├── telegram.ts   # Telegram adapter (long polling)
│       │   ├── format.ts     # message splitting and Markdown → Telegram HTML
│       │   ├── files.ts      # received files: download, per-agent folder, limits and cleanup
│       │   ├── outbound.ts   # which files an agent may send to a chat (allowed and forbidden paths)
│       │   ├── vision.ts     # image description with a separate model, for agents that cannot see
│       │   ├── prompt.ts     # origin header the agent receives
│       │   ├── public.ts     # what the API returns (no secrets) and config merge
│       │   ├── rules.ts      # minimum permission of an agent with a connection
│       │   ├── fake.ts       # in-memory platform for the simulations
│       │   └── index.ts      # registers the available platforms
│       ├── providers/
│       │   ├── index.ts      # provider → runner table
│       │   ├── spawn.ts      # process launcher (spawnLines)
│       │   ├── preamble.ts   # instructions preamble (OpenCode, Kiro and Claude on resume)
│       │   ├── claude.ts     # Claude Code runner
│       │   ├── opencode.ts   # OpenCode runner
│       │   └── kiro.ts       # Kiro runner
│       └── history/
│           ├── index.ts      # readHistory(): dispatches to the right reader
│           ├── claude.ts     # reads ~/.claude/projects/**/<id>.jsonl
│           ├── opencode.ts   # reads opencode.db (SQLite, read-only)
│           └── kiro.ts       # reads ~/.kiro/sessions/cli/<id>.jsonl and .json
└── web/                      # @hive-am/web — Next.js 15 frontend (App Router)
    ├── package.json
    ├── tsconfig.json
    ├── next.config.mjs       # /api proxy → server, configurable distDir
    ├── public/logo.png       # app logo (PNG with transparent background)
    ├── app/
    │   ├── favicon.ico, icon.png, apple-icon.png   # favicon and icons (Next detects them by name)
    │   ├── layout.tsx        # root: fonts, metadata, <Shell>
    │   ├── globals.css       # ALL the styles (tokens, light/dark theme, components)
    │   ├── page.tsx          # Colony (honeycomb)
    │   ├── agents/page.tsx   # agent list
    │   ├── agents/[id]/page.tsx   # agent workspace (chat, changes, settings, notebook)
    │   ├── connections/page.tsx   # external connections
    │   ├── types/page.tsx    # agent types
    │   ├── skills/page.tsx   # skill library
    │   ├── relations/page.tsx     # relations canvas
    │   └── sessions/page.tsx # agent sessions
    ├── components/
    │   ├── Shell.tsx         # sidebar, theme, global providers
    │   ├── ui.tsx            # primitives: Drawer, Modal, Field, pickers (including SkillPicker), toasts, Hex…
    │   ├── MarkdownEditor.tsx     # Markdown editor with toolbar, split view and shortcuts
    │   ├── HelpPopover.tsx   # help icon with popover
    │   ├── ConnectionDrawer.tsx   # create/edit a connection
    │   ├── agents/           # everything that creates or edits agents and colonies
    │   │   ├── AgentForm.tsx          # the single agent form (create and edit)
    │   │   ├── useAgentSettings.tsx   # save/discard/delete shared by the panels
    │   │   ├── NewAgentDrawer.tsx     # "new agent" wizard
    │   │   ├── AgentEditDrawer.tsx    # editing an agent in a side panel
    │   │   ├── AgentSwitcher.tsx      # side list to switch agent
    │   │   ├── AgentCard.tsx          # card with an agent's data on hover
    │   │   ├── DeleteAgentModal.tsx   # confirm and delete
    │   │   ├── ColonyEditor.tsx       # create/edit colonies + inheritance question
    │   │   └── NotebookPanel.tsx      # Notebook tab of the agent settings
    │   ├── chat/             # the conversation
    │   │   ├── Chat.tsx      # transcript, live view, text box
    │   │   ├── ToolCall.tsx  # rendering of each tool the agent uses
    │   │   ├── UserBubble.tsx    # user message (with the channel bubble)
    │   │   └── StatsBar.tsx  # bar and panel of tokens, cost and tools
    │   └── git/              # Changes tab
    │       ├── GitExplorer.tsx    # tree with highlighting, file and diff viewer, history and stashes
    │       ├── GitActions.tsx     # git buttons, branch menu, commit, history
    │       ├── GitSettings.tsx    # theme, visible whitespace and tab size of the code
    │       ├── DiffView.tsx       # unified and side-by-side diffs
    │       ├── VirtualLines.tsx   # virtualized rows for huge files
    │       ├── Code.tsx / CodeEditor.tsx  # highlighted code and its editor
    │       ├── ConflictResolver.tsx       # conflict resolution
    │       ├── StashManager.tsx   # list and view of stashes
    │       ├── SwitchDialog.tsx   # warning before switching branch while other agents are working
    │       └── StatusLetter.tsx   # status letter (M, A, D…)
    └── lib/
        ├── api.ts            # fetch client to /api (translates server errors)
        ├── store.tsx         # global state + WebSocket
        ├── types.ts          # frontend types (mirror of the backend's)
        ├── meta.ts           # provider/permission names and colors, utilities
        ├── format.ts         # formatting of tokens, cost, duration, bytes and numbers
        ├── tokens.ts         # estimated size of skills in tokens
        ├── channel.ts        # reads the origin header of a channel message
        ├── activity.ts       # "what is it doing" for an agent in one line
        ├── useDismiss.ts     # close on outside click or Escape
        ├── git/              # Changes tab utilities
        │   ├── useGit.ts     # hook of the changes explorer
        │   ├── gitTree.ts    # file tree
        │   ├── diff.ts       # unified diff parser and change marks
        │   ├── conflicts.ts  # conflict blocks and how to resolve them
        │   ├── gitPrefs.ts   # display preferences (in the browser)
        │   ├── highlight.ts  # per-line syntax highlighting
        │   ├── highlight.worker.ts  # the same highlighting off the main thread
        │   └── useHighlighted.ts    # chooses between instant and worker highlighting
        └── i18n/
            ├── core.ts       # languages, translate(), detection, server errors
            ├── index.tsx     # I18nProvider and useI18n()
            ├── en.ts         # English catalog (source of all keys)
            └── es.ts         # Spanish catalog (must have the same keys)
```

There are no automated test folders yet; verification is described in [document 12](12-operations-and-troubleshooting.md).

## Backend: what each file does

| File | Responsibility |
|---|---|
| `index.ts` | Runs `seedIfEmpty()`, creates the HTTP server on `127.0.0.1:<port>`, mounts the WebSocket at `/ws` and subscribes each client to the runtime's event bus. |
| `api.ts` | Route table (`route(method, path, handler)`), JSON body reading, `HttpError` errors (400/404), open CORS, detection of installed providers, folder picker. |
| `runtime.ts` | `sendTurn` (per-agent queue), `execute` (one turn), `dispatch` (delegation), `stopAgent`, `liveTurn`, `liveOrigin`, `bus`. |
| `instructions.ts` | `composeInstructions` (identity, prompt, skills, team, channels, notebook), `notebookBlock`, `lazySkills` and `mcpCaps`: which MCP tools each agent gets. |
| `db.ts` | Creates the tables, applies light migrations, exposes `skills`, `types`, `colonies`, `agents`, `dispatches` and the `resolved()` function; it also stores how each assigned skill is loaded. |
| `types.ts` | `Agent`, `Colony`, `AgentType`, `Skill`, `StreamEvent`, `Block`, `ChatMessage`, `Usage`, `TurnOptions`, etc. |
| `seed.ts` | If the database is empty it creates 2 skills and 3 types (Queen, Builder, Reviewer). |
| `skills/defaults.ts` | The ten skills that ship with hive-am (`skills.seedDefaults` creates them only once); see [7.3](07-agents-types-skills-colonies.md#73-skills). |
| `skills/notebook.ts` | Each agent's notebook: `agent_notebooks` table, limits, notes without duplicates, credential rejection and versions. |
| `connections/*` | External connections (Telegram): adapter, message router, groups, silence and channel tools; see [document 14](14-external-connections.md). |
| `models.ts` | Models available per provider; 10-minute cache. |
| `pricing.ts` | Price table per family (opus/sonnet/haiku) and usage-sum utilities. |
| `stats.ts` | `sessionStats(messages)`: totals of tokens, cost, tools, models and a per-turn timeline. |
| `git/ops.ts` | History, branches and the actions that write (commit, pull, push, fetch, switch, merge); see [document 13](13-changes-explorer-git.md#138-git-actions-and-history). |
| `git/repo.ts` | Git reads (status, tree, diff, content, images) with path validation; see [document 13](13-changes-explorer-git.md). |
| `git/switch.ts` | Smart branch switch: carries local changes over, or stashes them and reapplies; leaves conflicts to the resolver. |
| `mcp-config.ts` | `API_PORT` (`HIVE_AM_PORT` variable, 4400 by default) and the MCP configuration objects handed to each provider. |
| `providers/spawn.ts` | `spawnLines`: launches the CLI, delivers stdout line by line, handles cancellation, errors and `PWD`. |
| `providers/claude.ts`, `opencode.ts`, `kiro.ts` | One async generator per provider that produces `StreamEvent`. |
| `providers/preamble.ts` | `withInstructions`: prepends the instructions to the message (always for OpenCode and Kiro; for Claude only when resuming a session whose instructions changed). |
| `history/*.ts` | Reading of native transcripts and normalization to `ChatMessage[]`. |
| `mcp/dispatch.mjs` | Minimal stdio MCP server; it only talks to hive-am's HTTP API. It announces the tools according to `HIVE_CAPS`: `dispatch`, `channel` (includes sending files), `memory` and `skills`. |

## Frontend: what each file does

| File | Responsibility |
|---|---|
| `app/layout.tsx` | Loads the fonts (Bricolage Grotesque, Hanken Grotesk, JetBrains Mono) and wraps everything in `<Shell>`. |
| `app/page.tsx` | **Colony** screen: honeycomb with colonies, relation lines, the selected agent's panel and recent delegations. |
| `app/agents/page.tsx` | Filterable table of agents. |
| `app/agents/[id]/page.tsx` | Agent switcher + chat + Changes tab + collapsible settings panel (configuration, notebook and sessions). |
| `app/connections/page.tsx` | **Connections** screen: cards of the external connections and their status. |
| `app/types/page.tsx` | CRUD of types and creation of agents from a type. |
| `app/skills/page.tsx` | CRUD of skills with markdown preview, usage count and estimated size. |
| `app/relations/page.tsx` | Canvas (React Flow) to see and edit which orchestrator delegates to which worker. |
| `app/sessions/page.tsx` | List of sessions per day with a read-only transcript. |
| `components/Shell.tsx` | Side navigation, connection status, theme switch, `HiveProvider` and `Toaster`. |
| `components/ui.tsx` | `Hex`, `ProviderBadge`, `StatusChip`, `RoleChip`, `Drawer`, `Modal`, `Field`, `Segmented`, `ProviderPicker`, `ModelField`, `PermissionField`, `SkillPicker`, `FolderPicker`, `Toaster`… |
| `components/agents/*` | Forms and panels of agents and colonies (`AgentForm` is the shared form and handles inheritance from the colony); `NotebookPanel` edits the notebook. |
| `components/chat/*` | `Chat` (memoized transcript, live turn, delegation card), `ToolCall` (each tool as a readable row), `UserBubble` and `StatsBar`. |
| `components/git/*` | The **Changes** tab: `GitExplorer` (tree, file and diff viewer, history, stashes), `GitActions` (Fetch/Pull/Push/Commit, branches), `DiffView`, `ConflictResolver`, etc. |
| `lib/store.tsx` | Global state, WebSocket and event reducer. |
| `lib/git/*` | Changes tab utilities: `useGit` hook, tree, diff, conflicts, preferences and syntax highlighting (with its worker). |
| `lib/tokens.ts`, `lib/channel.ts` | Estimated size of skills, and reading of the origin header of channel messages. |
| `lib/i18n/*` | UI translations (English and Spanish); see [document 11](11-frontend.md#118-internationalization-i18n). |

## Main dependencies

**Backend** (`server/package.json`): `better-sqlite3` (synchronous SQLite), `ws` (WebSocket); development: `tsx`, `typescript`, types.
It uses neither Express nor Fastify: the router is its own and small.

**Frontend** (`web/package.json`): `next` 15, `react` 19, `@xyflow/react` (relations canvas), `lucide-react` (icons), `react-markdown` + `remark-gfm` (markdown of the chat and skills).

**Root**: `concurrently` to start both with a single command.

## Generated or ignored files

They are in `.gitignore`: `node_modules`, `.next` and `.next-*` (Next output), `*.log`, `*.tsbuildinfo`, `next-env.d.ts`, `.DS_Store`, `.env*` (except `.env.example`).

Outside the repository, hive-am writes to `~/.hive-am/` (see [document 4](04-storage.md)).
