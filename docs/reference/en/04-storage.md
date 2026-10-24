# 4. Storage

hive-am keeps data in **five** places. Understanding which one holds what is key:

| Place | Who writes it | What it contains |
|---|---|---|
| `~/.hive-am/hive-am.db` | hive-am | Configuration: agents, types, skills, colonies, relations, session pointers, delegation log |
| `~/.hive-am/mcp/<agentId>.json` | hive-am | Temporary MCP configuration per agent (Claude only) |
| `~/.hive-am/cursor/<agentId>/cli-config.json` | hive-am | Cursor config of a limited Cursor agent: your settings plus its permission rules, rewritten every turn ([6.6](06-providers.md#66-cursor-providerscursorts)) |
| `~/.hive-am/inbox/<agentId>/<date>/` | hive-am | Files people sent to an agent through a connection; deleted after 14 days ([14.6.2](14-external-connections.md#1462-received-files)) |
| Each CLI's native stores | **each CLI** | The **conversations** (messages, tools, token usage) |
| Browser `localStorage` | the UI | View preferences (theme, panel, canvas positions) |

> **Core rule:** the conversation is not copied into hive-am's database. The database only knows *which session* each agent uses.

## 4.1 SQLite database: `~/.hive-am/hive-am.db`

- Engine: `better-sqlite3` (synchronous).
- Location: `$HIVE_AM_HOME/hive-am.db` (`~/.hive-am/` by default).
- Pragmas: `journal_mode = WAL` and `foreign_keys = ON`. With WAL, `hive-am.db-wal` and `hive-am.db-shm` also appear; that is normal.
- Identifiers are text UUID v4. Dates are Unix milliseconds (`Date.now()`).
- **The schema is versioned.** It lives in one place, `server/src/db/migrations.ts`: a list of migrations that are only ever appended. `PRAGMA user_version` records how many a database has gone through; on opening, the missing ones run, each inside a transaction together with the version bump. They are additive and idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN` only when the column is absent), so a database from any earlier build opens without losing a row. Version 1 is the **baseline**: every `CREATE TABLE` and `ALTER TABLE` that used to be spread over the modules (it is a no-op where things already exist, which is why some columns do not appear in the first `CREATE TABLE`). Version 2 is the **renames**: resources of kind `boss` become `cluster` and the skill that ships with hive-am follows the rename of Objects to Resources (unless you already renamed it). The modules no longer create tables when they are imported.
- Access: `db.ts` caches its prepared statements, and creating or updating an agent, a type or a colony (with their skills and members) is **atomic**, one transaction. JSON columns are read with `db/json.ts` (`parseJson`): a damaged value gives a default and a one-time warning in the log instead of an error in the request.

### Relationship diagram

```mermaid
erDiagram
  agent_types ||--o{ type_skills : has
  skills      ||--o{ type_skills : "used in"
  skills      ||--o{ agent_skills : "used in"
  skills      ||--o{ colony_skills : "used in"
  agents      ||--o{ agent_skills : has
  colonies    ||--o{ colony_skills : has
  colonies    ||--o{ agents : groups
  agent_types ||--o{ agents : "origin (optional)"
  agents      ||--o{ assignments : "orchestrator"
  agents      ||--o{ assignments : "worker"
  agents      ||--o{ agent_sessions : records
  agents      ||--o{ dispatches : "from_id / to_id"
```

> See also: [diagram 8, data model](../../diagrams/en/08-data-model.md), with the migration that created each table.

### Table `skills`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID |
| `name` | TEXT, UNIQUE | Unique name |
| `description` | TEXT | One line |
| `content` | TEXT | Markdown with the instructions |
| `load` | TEXT | **Suggestion** for when the skill is assigned: `always` or `on_demand`. New ones are born `on_demand` if they exceed 2000 characters, and `always` otherwise. How it is really loaded is decided by each assignment (7.3.3) |
| `created_at`, `updated_at` | INTEGER | ms |

On install, `skills.seedDefaults` (`server/src/skills/defaults.ts`) adds **once** the skills that ship with hive-am, recording each one in `seeded_skills (slug)`. From then on they are ordinary skills: you edit or delete them, and a deleted skill is **not** recreated on the next start. If one with that name already existed, the new one is added as "Name (hive-am)". A future hive-am version that brings more skills adds them only once, and never modifies the ones you already have. Their id is `default-<slug>`. The ones that ship with hive-am are created `on_demand`, except Notebook (`always`).

### Tables `notebooks` and `notebook_readers`

A notebook (see [7.3.2](07-agents-types-skills-colonies.md#732-the-agents-notebook)) is an object of its own with **readers**: an agent and the clones made from it read and write the same one. They live in separate tables so they do not travel with the agent list. Migration 6 moved the old `agent_notebooks` table here without losing a row (text, version and who wrote last are kept, and each agent that had a notebook keeps a notebook of its own).

`notebooks`:

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `content` | TEXT | Markdown (max. 8000 characters) |
| `version` | INTEGER | Goes up with every change |
| `updated_at`, `updated_by` | INTEGER, TEXT | `agent` or `user` |

`notebook_readers` (one row per agent that has a notebook):

| Column | Type | Notes |
|---|---|---|
| `agent_id` | TEXT PK | `ON DELETE CASCADE`: deleting an agent removes only its reader row |
| `notebook_id` | TEXT | The notebook it reads (`ON DELETE CASCADE`) |
| `seen` | INTEGER | Last version that **this reader's** live conversation already contains (each agent has its own) |

The trigger `notebook_orphan` deletes a notebook when its last reader goes, however it goes (deleting the agent, or moving to another notebook), so no orphan rows are left; deleting one reader keeps the notebook, with its text and the others' `seen`.

### Table `agent_types`

Agent templates.

| Column | Notes |
|---|---|
| `id`, `name` (UNIQUE), `description` | |
| `role` | `orchestrator` \| `worker` |
| `provider` | `claude` \| `opencode` \| `kiro` |
| `model` | Free text; empty = the CLI's default |
| `system_prompt` | |
| `permission` | `plan` \| `acceptEdits` \| `bypassPermissions` (default `acceptEdits`) |
| `color` | Reserved; today it is only filled in the seed |
| `created_at` | |

Junction table `type_skills (type_id, skill_id, load)`, both with `ON DELETE CASCADE`. `load` (`always` / `on_demand`) is how **that** skill is loaded for that type; the same in `agent_skills` and `colony_skills`.

### Table `agents`

| Column | Notes |
|---|---|
| `id`, `name` (UNIQUE, case-insensitive when looking up by name), `description` | |
| `role` | `orchestrator` \| `worker` |
| `type_id` | FK to `agent_types`, `ON DELETE SET NULL`. Informational only: the agent is a copy, it does not follow its type |
| `provider`, `model`, `system_prompt`, `permission` | The agent's own configuration |
| `cwd` | Own folder. It can be `''` if it inherits the colony's |
| `session_id` | **Pointer** to the current direct session (the CLI's native id) |
| `session_cwd` | Folder the session was created with (migration) |
| `instr_hash` | Fingerprint of the instructions that session received (migration) |
| `status` | `idle` \| `running` \| `error` |
| `colony_id` | FK to `colonies`, `ON DELETE SET NULL` (migration) |
| `overrides` | JSON: fields where the agent ignores its colony, e.g. `["cwd","skills"]` (migration) |
| `cloned_from` | FK to `agents`, `ON DELETE SET NULL` (migration 7): the agent this one was cloned from, `NULL` for any other agent and when the source is deleted |
| `created_at`, `updated_at` | |

Junction tables:

- `agent_skills (agent_id, skill_id, load)`: the agent's own skills (`CASCADE` on both sides).
- `assignments (orchestrator_id, worker_id)`: delegation **relations** (`CASCADE`). It is the source of truth for which orchestrator can delegate to which worker.

### Table `colonies`

| Column | Notes |
|---|---|
| `id`, `name` (UNIQUE), `color` | `color` is a hex such as `#2f8f5b` |
| `cwd` | Shared folder |
| `permission` | Shared permission |
| `system_prompt` | Shared context |
| `inherit` | JSON `{ "cwd": bool, "permission": bool, "skills": bool, "prompt": bool }`: which fields members follow by default |
| `created_at` | |

Junction table `colony_skills (colony_id, skill_id)` (`CASCADE`). Membership of agents in the colony is stored in `agents.colony_id` (an agent belongs to at most one colony).

### Table `agent_sessions`

Log of the native sessions an agent has used. It feeds the Sessions tabs and screens. It is trimmed by `retentionPass` (`retention.ts`, at start and every six hours, next to the inbox cleaning): delegated sessions past the newest 50 of their agent and unused for 90 days, and direct ones unused for 90 days whose transcript the CLI no longer has (never the agent's current one), are removed. The same pass keeps the newest 500 `thread_messages` of each thread plus anything younger than 30 days, the newest 200 `dispatches` (one still queued or running is never removed, nor a background one whose result was neither announced to the orchestrator nor read with `dispatch_status`), and empties `thread_messages.files` after the inbox's 14 days. Only these rows go: the conversations stay in the CLI. Migration 5 adds `idx_dispatches_created` for it.

| Column | Notes |
|---|---|
| `agent_id`, `session_id` | Composite primary key |
| `provider` | Provider it was created with |
| `cwd` | Effective folder it ran in |
| `first_seen`, `last_seen` | ms |
| `kind` | `direct` (the user's conversation) \| `delegation` (task from an orchestrator) |
| `from_id` | Orchestrator that delegated (only `delegation`) |
| `task` | Task text, trimmed to 500 characters (only `delegation`) |

### Table `dispatches`

Delegation log: who asked what of whom.

| Column | Notes |
|---|---|
| `id` | UUID |
| `from_id`, `to_id` | Orchestrator and worker (no foreign key: the record survives if an agent is deleted) |
| `task` | Full task text |
| `status` | `queued` (waiting behind the worker's other turns) \| `running` \| `done` \| `failed` \| `interrupted` \| `cancelled` (taken back by its orchestrator or the person; `result` says who). Only a row still `queued` or `running` gets a final state, so the end of a turn and a cancel never overwrite each other |
| `result` | The worker's final answer, trimmed to 20,000 characters |
| `session_id` | The worker's native session where it ran (migration) |
| `mode` | `sync` (the answer goes back to the tool call) or `background` (the orchestrator is told when it ends). Migration 9; older rows are `sync` |
| `origin` | Background only: JSON with the chat thread where the orchestrator was asked (`connection_id`, `thread_id`, `req_id`, `req_name`); `NULL` for its web conversation |
| `notified_at` | When the result of a background task was handed to the orchestrator (or given up on because there was nobody to tell); set with the cancel when the orchestrator cancelled it itself |
| `read_at` | When the orchestrator read the finished result with `dispatch_status` |
| `created_at`, `finished_at` | |

### Initial data (seed)

`server/src/seed.ts` runs on every start but **only acts if there are no types, agents or skills**. It creates:

- Types: **Queen** (orchestrator, Claude/sonnet), **Builder** (worker, Claude/sonnet), **Reviewer** (worker, OpenCode, `plan` permission). No example skills are created (older versions made `concise-reports` and `careful-reviewer`; on start they are removed where they are still as they were made).

### Integrity and deletions

| Action | Effect |
|---|---|
| Delete an agent | Its own skills, its assignments (as orchestrator and as worker) and its session log are removed. **The native session files are not touched.** |
| Delete a colony | Its agents are left without a colony (`colony_id = NULL`) and stop inheriting. |
| Delete a type | Agents created from it keep their values; `type_id` becomes `NULL`. |
| Delete a skill | It is unlinked from agents, types and colonies. |

## 4.2 MCP configuration files: `~/.hive-am/mcp/<agentId>.json`

Only for **Claude** and only when the agent is an orchestrator with at least one subagent. It is rewritten on every turn with:

```json
{ "mcpServers": { "hive": { "command": "<node>", "args": ["…/server/mcp/dispatch.mjs"],
  "env": { "HIVE_AGENT_ID": "<id>", "HIVE_AM_API": "http://127.0.0.1:4400" } } } }
```

It is passed to Claude with `--mcp-config`. OpenCode receives the same information through the `OPENCODE_CONFIG_CONTENT` environment variable (no file is written).

## 4.3 The CLIs' native stores (read-only for hive-am)

hive-am **reads** these files to show the history; it never modifies them.

| Provider | Location | Format |
|---|---|---|
| Claude Code | `~/.claude/projects/<encoded-folder>/<sessionId>.jsonl` | JSONL, one line per content block. The encoded folder replaces `/` and `.` with `-`. If it is not found in the expected folder, all project folders are searched. |
| OpenCode | `~/.local/share/opencode/opencode.db` | SQLite, tables `session_v2` (metadata, `directory`) and `session_message` (messages). Opened in `readonly` mode. |
| Kiro | `~/.kiro/sessions/cli/<sessionId>.jsonl` and `<sessionId>.json` | `.jsonl`: messages (`Prompt`, `AssistantMessage`, …). `.json`: session metadata, including the per-turn meter (credits, duration, % of context). |
| Cursor | `~/.cursor/projects/<folder>/agent-transcripts/<sessionId>/<sessionId>.jsonl` | JSONL, one line per user message or step of a reply (text and tool calls, no results or usage). The folder is the agent's with every run of characters other than letters and digits turned into `-`. If it is not found there, all project folders are searched. |

Details of each reader in [document 8](08-sessions-and-history.md).

## 4.4 Browser `localStorage`

View preferences only; if they are deleted, the UI works the same.

| Key | Value | Where it is used |
|---|---|---|
| `hive-theme` | `light` \| `dark` | `Shell.tsx`: chosen theme (if absent, the system's is followed) |
| `hive-cfg-open` | `1` \| `0` | `agents/[id]/page.tsx`: whether the agent's settings panel stays open |
| `hive-rel-pos-v2` | JSON `{ id: {x, y} }` | `relations/page.tsx`: positions of nodes you dragged by hand |
| `hive-locale` | `en` \| `es` | `lib/i18n`: UI language (never reflected in the URL) |
| `hive-git-view` | JSON `{ theme, whitespace, tabSize }` | `lib/git/gitPrefs.ts`: theme, visible whitespace and tab size of the code viewer |
| `hive-switcher-collapsed` | `1` \| `0` | `agents/[id]/page.tsx`: whether the side agent list is collapsed |
| `hive-am.railCollapsed` | `true` \| `false` | `Shell.tsx`: whether the main sidebar is folded to icons (applied before the first paint by the inline script of `layout.tsx`) |
| `hive-am.switcher.folded` | JSON array of ids | `AgentSwitcher.tsx`: the colony groups folded in the chat's side agent list, full or collapsed (colony ids and `free` for "No colony") |
| `hive-cfg-width` | number (px) | `agents/[id]/page.tsx`: width of the agent's settings panel (dragged, via `useResizableWidth`) |
| `hive-am.drawerWidth` | number (px) | `Dialog.tsx` (`Drawer`): width of the side drawers (dragged, via `useResizableWidth`) |
| `hive-obj-switcher-collapsed` | `1` \| `0` | `ObjectWorkspace.tsx`: whether the resources list is collapsed |
| `hive-colony-layout` | JSON `{ id: {x, y} }` | `app/colony/page.tsx`: where you placed colonies, free agents and resources on the map |
| `hive-colony-zoom` | number | `app/colony/page.tsx`: zoom of the colony map |
| `hive-am.agents.q` | text | `agents/page.tsx`: search of the agent list |
| `hive-am.agents.role` | `all` \| role | `agents/page.tsx`: role filter of the agent list |
| `hive-am.agents.provider` | `all` \| provider | `agents/page.tsx`: provider filter of the agent list |
| `hive-am.draft.<agentId>` | text | `Chat.tsx`: the unsent message of each agent (one key per agent) |
| `hive-am.dock` | JSON `{ open, height, active }` | `lib/dock.tsx`: state of the bottom terminal panel |
| `hive-am.logsize` | number (10 to 20) | `LogPane.tsx`: text size of the resource logs |
| `hive-am.dbq.<resourceId>` | text | `DbWorkspace.tsx`: the SQL being written for each database resource |
| `hive-am.git.where.<agentId>` | JSON | `GitExplorer.tsx`: where the person was in the changes explorer of each agent. Every field is optional: `{ file, dirs, mode, hist, commit, cmp: { base, head }, stash, tag }` (the file, the folders that were open, the tab and what it had selected) |

The former key `hive-rel-pos` is no longer used (it was dropped when the canvas was redesigned).

How they are read and written: new keys go under the `hive-am.` prefix and use `usePersistentState` (JSON, safe when storage is blocked, the first render uses the default so there is no hydration mismatch); `useResizableWidth` stores the width of drawers and panels. Older keys that hold plain text (`hive-theme`, `hive-locale`) keep their format. Not everything is in `localStorage`: the selected tab or session lives in the URL (`?tab=`, `?session=`; see [11.3](11-frontend.md#113-global-state-libstoretsx)) and is never stored.

## 4.5 What is **not** stored

- Messages, answers, tool calls and their output (they are in the native store).
- Tokens and costs (computed when reading the history).
- Cookies or credentials: hive-am does not authenticate; the CLIs use their own logged-in session.
