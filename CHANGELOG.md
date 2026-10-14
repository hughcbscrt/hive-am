# Changelog

All notable changes to hive-am are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.3.0] - 2026-10-14

### Added

- Claude agents can drive your Chrome through the Claude in Chrome extension. Turn on **Browser (Chrome)** in the agent's settings (it is off by default and adds nothing to the prompt). The chat shows each browser action (open page, read, click, run script) with its own icon and label. Chrome and the extension must be open on the machine where hive-am runs.
- Kiro: agents get an instruction to fully detach long-running processes (`setsid nohup … > log 2>&1 < /dev/null &`) so the shell tool returns at once and the turn and chat keep going, instead of waiting for the command and everything it started to finish.

### Fixed

- Claude: after **/compact** the chat no longer shows the CLI's summary as if you had written it; a "Conversation compacted" divider with the size before and after appears instead.
- Claude: the context percentage drops after a compact, using the size the CLI reports, instead of keeping the old value until the next reply.
- Context gauge: it uses each model's real window instead of a fixed 200k, so a 1M model no longer shows 100% at 200k tokens. The window is learned from the CLIs and kept in `context-windows.json`: Claude reports it in every turn, Kiro lists it with its models and OpenCode has it in its model catalog (read once an hour with a short-lived server when a model is unknown). When no window is known the chat shows tokens instead of a made-up percentage. The gauge also counts the last reply, ignores synthetic entries (errors) that used to reset it, and its tooltip shows tokens used and window.

## [1.2.2] - 2026-10-13

### Fixed

- OpenCode 1.x: the conversation is now read from its `message` and `part` tables, so the history no longer empties after sending a message.

## [1.2.1] - 2026-10-13

### Added

- OpenCode 2.x: when a turn fails (for example a full conversation) the error offers **Compact conversation**. Other versions only suggest starting a new conversation.
- Terminals: selecting text copies it, and Ctrl+Shift+C copies too (Ctrl+C only copies while text is selected).

### Fixed

- Minimizing the terminal panel no longer breaks the scroll of a full screen program (OpenCode, Claude Code): the terminals stay mounted, and the server remembers the screen and mouse modes a program switched on so a reload restores them.
- A turn that failed (conversation full, provider blocked, timeout) no longer looks like it is still running: the timer stops, "Stop" goes away and the composer sends normally. The error now says what to do.
- OpenCode failures now show their real reason ("Go usage limit exceeded", insufficient funds, blocked response) instead of "opencode exited with code 1".
- OpenCode 1.x works again: the flags `opencode run` accepts are read from its help and unsupported ones (`--standalone`, `--server`) are not passed.
- A new conversation no longer shows "Show earlier messages" with the count of the previous one.
- The tokens per turn chart in the stats panel was drawn downwards.

## [1.2.0] - 2026-10-13

### Added

- **User manual** in English and Spanish (`docs/manual`): fourteen chapters per language, from the first steps to resources, the git explorer, terminals, permissions and troubleshooting, with screenshots of every screen. The README links it.
- Interface accessibility: **dialogs and drawers** share one mechanism (the rest of the page is inert while one is open, only the topmost reacts to Esc, focus is trapped and given back, `data-autofocus` picks the first control), **tabs** have ARIA roles and arrow keys, **toasts** announce errors as alerts, can be closed, pause under the pointer and never repeat, the chat is a `role="log"`, table rows that open something work with the keyboard, form labels are tied to their fields, and the contrast of muted and success text meets 4.5:1.
- Theme and language are applied **before the first paint** (no flash of the light theme with a saved dark one), and the theme button reports its state.
- Colony and agents: one **New** menu (agent, colony, resource), statistics that link to their lists, a *Recent* feed with links to the agent and the session that updates from the WebSocket, **arrow keys to move** colonies and free hexagons, a skeleton while loading and an **error banner with Retry** when the API does not answer (instead of an empty colony). The agent list keeps its search and filters and scrolls sideways on a phone.
- Chat and sessions: a **Jump to latest** button when you scroll away from the end (the chat follows the reply by itself until you scroll away yourself), an unsent **draft per agent** that survives switching agent or reloading, the agent's settings panel and tab in the URL (`?tab=`), and Sessions open from a link (`?session=`) and show the same blocks as the chat (tool calls and thinking included). Resources keep their open tab in the URL too.
- **Confirmations and unsaved-change guards**: recreating a resource, clearing an HTTP history, forgetting an HTTP session, switching skill, and closing a drawer or leaving the tab with changes not saved now ask first.
- **Schema versioning**: the database records its version (`PRAGMA user_version`) and applies idempotent migrations, each in a transaction, from one place (`db/migrations.ts`); a database from any earlier build opens without losing a row.
- A **request body limit**: 2 MiB for JSON and about 135 MB for chat attachments; above that the answer is 413 and the connection is closed. Invalid bodies (not an object) and malformed URLs answer 400.
- **Orderly shutdown**: Ctrl+C or a service stop closes the server, the WebSockets, the terminals, the channel connections and the database (5 s at most); a taken port gives a clear message. Servers and containers kept as resources keep running.
- Settings that can be changed with environment variables: `HIVE_AM_KILL_GRACE_MS` (grace before a CLI is killed), `HIVE_AM_TELEGRAM_TIMEOUT_MS` and `HIVE_AM_WAKE_RETRY_MS`.
- New test scripts that need no model: migrations, runtime recovery, shared provider code, Telegram timeouts, connection lifecycle and the HTTP core (21 `test-*.ts` in all).
- Connections: agents can **react to messages** with an emoji (`channel_react`) instead of writing, only with the emoji the platform allows (on Telegram its fixed list; the tool lists the valid ones when one is refused). The "Chat channels" skill explains when to react and which emoji to use; existing libraries get the section added once.
- Agents, types and connections: the **model** field is now a selector: it shows the model in use (or "CLI default"), opens a searchable list of what the CLI offers and still accepts any model id typed by hand.
- Chat: **send files and pictures to an agent**: paste a picture or a copied file (Ctrl+V, ⌘V on a Mac), drop files on the text box or use the clip. Pictures show as previews and appear as thumbnails in the conversation; other files show as a chip that downloads. Up to 5 per message, 20 MB each, saved in the agent's inbox (with a note of where, so the agent opens them with its file tools); a picture is recognised by its bytes, anything else keeps its name and is never run.
- Colony map: **drag** a colony (by its name) or a free agent / resource to place it where you want (kept in this browser, with a button to put everything back), and **zoom** (− / +, Ctrl/⌘ + wheel).
- Database resources: **driver properties** (a table of the options the Node driver of the engine really takes — `charset`, `application_name`, `search_path`, `appName`, `instanceName`, `foreign_keys`, `timeout`… — each with its description in English and Spanish and the right control, and none that could override what hive-am decides), **SSL files** (CA, client certificate and key) with a clear error when one is missing, and a **connection URL** that fills the form (`postgresql://…?sslmode=require`, `mysql://`, `mssql://`, `sqlite:///`). The creation drawer is redesigned: engine tiles, URL, connection with its test, safety and an *Advanced* section; the name can stay empty. `GET /api/object-db/props`.
- **Database resources** (MySQL / MariaDB, PostgreSQL, SQLite and SQL Server): create one with a connection that can be tested before saving (the password stays on the server), see its state (version and latency), write and run queries in an editor with the file explorer's themes (Ctrl/⌘+Enter, a selection runs alone), browse databases, tables, views and columns, copy or download a result as CSV/JSON, save queries and keep a history. A result is cut at 1000 rows without reading the rest, a slow query is stopped (SQLite runs in a process of its own that is killed at the timeout), and by default only reads are accepted — checked in the text and, where the engine allows it, by the connection itself. It has its own card on the colony map, settings and tests (`scripts/test-object-database.ts`, with real servers). Needs `mysql2`, `pg`, `pg-cursor` and `mssql`. The SQL editor **suggests** tables, schemas, columns (by table or alias) and keywords and has a **Format** button (Alt+Shift+F); picking a query from the History or the saved ones **adds** it at the end of the editor instead of replacing what was written; saved queries can be renamed, replaced and deleted from the History tab; password fields have an **eye** to show what is typed.
- Colony map: clicking an agent or a resource opens a card beside its hex with its details and actions (open chat, settings, change colony, delete; for resources start/stop/restart, terminal, logs, who looks after it, *Create manager agent* / *Add manager agent*). It follows the hex when the canvas scrolls, closes with Esc, the X or a click outside, and becomes a sheet at the bottom on narrow screens. The links of orchestrators, clusters and managers (agent ↔ resource) are drawn only for what is under the cursor or selected, and tags on the hexagons say who is connected (⚙ the manager of a resource, ⚙ N what an agent looks after).
- Docker logs are read from the end of the file (25 ms on a 200 MB log) and the containers hive-am creates get a default log limit (10 MB x 3). The server settings explain that restarts and health checks only work while hive-am runs.
- App templates for Docker resources: when creating one, **From a template** offers Redis, Valkey, PostgreSQL, MariaDB, MySQL, MongoDB, RabbitMQ, MinIO, Nginx, Mailpit and Adminer; you fill a few values (version, ports, user, password — each password starts random) and hive-am writes the compose file under its data folder (`stacks/`) and creates the resource (it is not started: the first run downloads the images). Values are checked before anything is written. API: `GET /api/object-templates`, `POST /api/objects/from-template`.
- Per service of a compose project (and for a container): **Inspect** (how it runs, variables with secrets hidden until shown, ports, mounts, networks, health checks), a **shell** inside it, **create again** (`--force-recreate`) and **build again** (`--build`); and **create again** / **build again** for the whole Docker resource. API: `GET /api/objects/:id/inspect?service=`, `POST /api/objects/:id/service` with `recreate` / `rebuild`, `POST /api/objects/:id/action` with `recreate` / `rebuild`, and terminals take a `service`.
- Compose projects and clusters in the style of Docker Desktop: a compose resource lists its services with state, image, ports that open in the browser, CPU and memory, and start / stop / restart / logs for each service on its own (`POST /api/objects/:id/service`); a cluster shows its members as a tree (state, what each runs, CPU and memory, the services of a compose member under it) with the same actions and the start order.
- The `.http` file editor of the HTTP runner is the code explorer’s editor: syntax highlighting for `.http` / `.rest` files (also in the explorer), line numbers, the same themes (Hive, GitLab, Solarized, Monokai, Dracula), visible whitespace and tab width, and the theme picker next to the editor (one setting for both places). The suggestions keep working on top of it.
- Run an HTTP file with data: a CSV (names in the first line) or a JSON array of objects; the file runs once per row with the columns as variables for that row, and a table shows how each request went in each row (up to 200 rows; the values are forgotten at the end).
- HTTP answers can be filtered (text, or a JSONPath such as `$.items[*].id`, `$..id`, `$.a[?(@.price > 10)]`), and the requests of a file (or all of them) can be exported as Markdown documentation (with an example answer taken from the history) or as a Postman v2.1 collection. API: `GET /api/objects/:id/http/docs?format=markdown|postman&file=`.
- HTTP requests without code: an **Authentication** tab (Bearer, Basic, API key; for one request or all of a file) writes the header the request needs, and **Checks** in the Tests tab (status, time, header, JSON value, text) are saved in the file as a response handler and reported on each run. Handlers can read `response.time` and `response.text`.
- HTTP history that lasts: the last 100 runs of each HTTP resource are kept on disk (request, answer, tests), so they survive a restart; and **compare** any run with the previous one of the same request, or with another, as status, time, size, changed headers and a line diff of the answer. API: `GET|DELETE /api/objects/:id/http/history`.
- Suggestions while editing a `.http` file: variables inside `{{ }}` (with their value), answers of named requests and generated values, methods at the start of a request, header names and the values of Content-Type / Accept, and `# @name`. Ctrl+Space opens them, arrows and Enter or Tab accept.
- New HTTP requests from the screen: a **+** next to the environment opens a form (file, name, method, URL, headers, body) or takes a pasted **cURL** command, and adds the request to an existing `.http` file or to a new one (`POST /api/objects/:id/http/file` creates files, never over an existing one). `Authorization: Basic user password` is sent encoded.
- HTTP requests can be copied as cURL, wget, HTTPie, PowerShell, JavaScript (fetch), Node (axios), Python, Go, PHP, Java, C#, Ruby, Rust or a raw HTTP message, with the values in effect now (what has no value stays as `{{name}}`; credential headers can be hidden). API: `GET /api/objects/:id/http/export`.
- HTTP **History** tab (replaces the Session panel): every run (request, status, time, tests, answer as a tree), plus the values and remembered answers the session keeps, with the option to set or forget them.
- HTTP runner that shows real values: a **Variables** tab per file and per request (current value, where it comes from — session, `@` in the file, env file, hive-am, answer of another request, generated, missing —, what it hides, and how many times it is used), the request **as it will be sent** (secrets masked, missing values marked), the `.http` file as text with a ▶ per request and `{{variables}}` that show their value on hover (with editing and saving), JSON answers as a foldable tree that copies references (`{{login.response.body.$.token}}`), and remembered answers in the Session panel with their data. A value can be set for the session from any of them. The selected environment (env files, then hive-am's) wins over an `@name` line of the file; the value of the session wins over everything.
- Chaining HTTP requests: response handlers (`> {% … %}`) keep values for the next requests (`client.global.set`) and check the answer (`client.test` / `client.assert`), requests with a name can be used by the next ones (`{{login.response.body.token}}`), and a session per HTTP resource (values and answers, visible and editable) lasts until hive-am stops. Handlers run in a small safe interpreter, not as JavaScript: no `require`, `process`, loops or prototypes. The runner shows tests, console, what was kept, a request that needs another one's answer offers to run it first, and running a file can stop at the first failure.
- Suggestions in the resource forms: images and containers from Docker (read-only), the services of a compose file as chips to pick (and a project name from the folder), and, for HTTP variables, the names the requests use (with a panel that shows which ones still have no value).
- Resources screen: **Resources** in the rail opens a screen like an agent's, with a collapsible list at the left and, for each resource, tabs: Summary (state, uptime, CPU and memory with history, Docker network and disk, details, latest output), Logs on a whole screen (search, only matches, follow, wrap, text size, pause, copy, download, error and warning colours, per-member colours for clusters) and Settings in place (unsaved-changes bar, save and restart, delete). The Colony map links to it.
- HTTP requests as a screen: pick the `.http` file you want, see its requests, run one or the whole file; and **Variables** of its own per environment (for when there is no env file; env files win), with **secrets** that are hidden once saved and never returned by the API (stored unencrypted on this machine).
- Keeping servers healthy: restart after a failure or always, with a growing wait and a limit (then it says it gave up); health checks (HTTP, port, command) that mark it unhealthy and can restart it; stop timeout; log rotation while it runs. Docker containers: memory, CPU, network, log size and stop timeout (the container is created again when one of them changes).
- Terminals: a bottom panel (Ctrl+`) with real shells (a pty each, kept by the server, replayed when a page attaches) and the logs of resources in tabs; from an agent, a server resource or a container. Only this machine can reach them (loopback host and origin), `HIVE_AM_TERMINALS=0` turns them off, `node-pty` is an optional dependency.
- HTTP-requests resources: a folder of `.http` / `.rest` files with environments (`http-client.env.json` and the private one), file and generated variables, bodies from a file and a runner to send the requests and read the answers; nothing is sent while a variable is missing, and credentials are hidden in the echoed request.
- Cluster resources: group servers and containers of a colony to start them in order, stop them in reverse, see one state and read their logs together with the name of each member; a table of members with one-by-one actions and a start order you can change.
- Agents that look after resources: the "Colony resources" skill gives an agent `object_list`, `object_logs` and `object_action` (start, stop, restart) for the servers, containers and clusters it looks after; read-only agents cannot act, an agent cannot create or change resources, and the log says who asked. A resource has **one manager agent**, chosen by searching: in the resource's form (creating and editing), from its card on the colony map (*Create manager agent* / *Add manager agent*) and from the agent's form (*Resources it looks after*, which takes several). With a manager only that agent looks after it (any colony); with none, the agents of its colony that have the skill do. An agent without the skill gets it when chosen.
- Colony resources: servers (a command hive-am keeps running, with its own process group and log file, found again after a restart) and Docker (a container hive-am creates, a compose project, or an existing container that is never removed) as hexagons on the Colony map, with state, start / stop / restart and live logs. API under `/api/objects`; changes only from the local app.
- Git explorer: a Compare tab (two branches, tags or commits: files, commits in between and diffs, pictures before and after), history search by message, author or content, by branch or tag, and by hash; history of a single file; "View at…" to read a file as it was at any ref; search inside the files; creating a branch from a tag (without switching) and deleting local branches; `/` and `Alt+1…5` shortcuts and the last open file remembered per agent.
- Tags in the git explorer: a Tags tab lists the repository's tags; each one can be browsed read-only (its files as they were at that tag, with Markdown preview, and the changes of its commit). The working folder is never touched.

### Changed

- Agent settings: the panel of an agent is now a **drawer over the page** (dimmed background, Escape and focus handled like the New agent and New colony panels) instead of a fixed side panel that covered the header and the message box of the chat. It opens with the Settings button or with `?tab=config|notebook|sessions` in the address, closing it with unsaved changes asks first, and reading or resuming a session closes it so the chat is in view.
- Markdown (chat, sessions, skill preview, changes preview): headings with a visible hierarchy, quotes with a bar, tables that scroll instead of overflowing, tidier lists and task lists.
- **Code structure, same behaviour**: `api.ts` is now a small facade over `http/` (router, errors, one local-only guard, body reading, validation and one file of routes per domain) and `services/` (agents, colonies, connections, notebook, schedules, providers); domain errors share one base (`DomainError`) that maps to a status in a single place, so a refused action is a 400 on every route; providers and history readers are registered behind an interface and share their JSON-line, text and process helpers; the database caches its prepared statements and creating or updating an agent, a type or a colony is one transaction. Routes and responses are the same. Pinning Origin/Host on every route is still pending (a `TODO(security)` in `api.ts`).
- **Frontend building blocks**: dialogs, confirmations, tabs, empty states, banners, search boxes, checkbox rows and the workspace header (whose secondary actions fold into a menu when it is narrow) are shared components; the interface keeps its state in narrow store hooks (a streamed token no longer re-renders the navigation or the colony), and polling, saved preferences, unsaved-change guards, drag-resizable widths and URL state are hooks. Styles use tokens for layers, font sizes and meaning colours, and there is one dark block instead of two.
- The HTTP and database resource screens are split into smaller parts (the HTTP runner keeps its state in one hook and each pane is its own component) and share one list-and-detail layout.
- The git explorer is split into smaller parts (tabs, file tree, viewer, preview, history, branches, commit and discard confirmations), and its file tree supports the keyboard and screen readers.
- The path picker shows loading and errors, and dates and times follow the app's language.
- The two example skills `concise-reports` and `careful-reviewer` are no longer created, and are removed on start where they are still as they were made.
- One path picker for every folder or file field (agent, colony and server folders, the compose file, Docker volumes), including a file mode.
- Your messages in the web chat (and in Sessions) are no longer inverted bubbles: light with a thin border in the light theme and dark in the dark theme.
- Tooltips: every `title` in the interface now shows a styled tooltip (after a short pause, or on keyboard focus) instead of the browser's own, in both themes. Icon-only elements keep the text as their accessible name.
- Git explorer, less crowded: one toolbar row (Fetch, Pull and Push are icons with a tooltip and their counts), icon tabs where only the open one shows its name, a single filter row (name/content toggle and a "changes only" button) and a two-row file header with the secondary actions as icons.
- Sessions screen: a sidebar like the Skills one, a transcript that opens on its latest 100 messages (with a button for earlier ones) and long messages folded behind "show all".
- The sessions list no longer reads every conversation to answer: sizes and costs are cached by conversation fingerprint and filled in the background, so the list appears at once even with very long sessions.
- Thinner scrollbars with no track, tinted with the theme colour and darker while hovered, in light and dark themes.
- The test scripts refuse to run against the real data folder: `HIVE_AM_HOME` must point to a temporary one.

### Fixed

- Pressing Esc in a confirmation opened over a panel (deleting a colony, a connection or a type) also closed the panel and lost what you were editing, and the panel was not dimmed behind the confirmation. Only the topmost layer reacts to Esc now.
- Schedules: the list stops refreshing while the tab is hidden, a server that does not answer shows one notice instead of one every 10 seconds, and opening the history of a schedule no longer reloads it on every refresh.
- Skills: **Discard** on a skill that already existed did nothing; it now brings back the saved text.
- An agent no longer stays "running" when the preparation of its turn fails.
- A wake-up whose delivery failed no longer stays orphaned: it is retried 12 times and then dropped.
- Starting the same connection twice no longer leaves an adapter polling with no owner.
- Telegram calls, uploads and downloads have a timeout, so a half-open connection no longer hangs a conversation.
- A CLI that ignores the stop request is killed after a grace period, and a Docker command killed by a signal or by its output limit counts as a failure.
- Deleting a skill or a type that fails now shows an error, and a failed API load shows a retry instead of empty lists.
- The WebSocket uses `wss:` when the page is https and ignores a malformed frame.

## [1.1.0] - 2026-10-10

### Added

- Markdown preview in the file explorer: `.md` files open rendered, with a Preview tab next to the source (File) and the diff.
- Chat channels skill: how an agent behaves in Telegram and Slack (answering, files, pictures, groups, keeping quiet, secrets). It is assigned automatically to agents answered through a connection and is editable.
- Secrets never leave through an external chat: a rule in the skill and a server-side filter on channel replies, captions and text files (known tokens, private keys, JWTs, connection strings, NAME=value assignments).
- Wake-ups skill with the wake_me tool: an agent can ask to be woken after some minutes, in the same chat thread or web conversation, instead of promising a notice it cannot send. The person who asked in a group is mentioned.
- wake_when_done: an agent starts a command in the background and is woken the moment its process ends or a marker file appears; hive-am sends an immediate notice and the agent reports the result.
- Recurring schedules (schedule_create, schedule_list, schedule_cancel) with cron expressions evaluated in a time zone (daylight saving handled), a 15-minute minimum interval, a per-agent limit, skipped-not-replayed missed runs and a run history.
- Schedules screen: lists recurring schedules, one-time wake-ups and pending process waits, with next run, last result and history; pause, resume and delete.
- Reasoning effort per connection (Claude and Kiro --effort, OpenCode model variant).
- Queued messages in the web chat are shown as queued instead of disappearing until the model reads them.
- Scripts: bench-latency, bench-burst and simulations/tests for secrets, wake-ups, schedules, process watching, cron, text formatting, group addressing and rate limits.

### Changed

- OpenCode agents answering an external chat use a long-lived opencode serve per agent (at most 2 alive, stopped after 5 idle minutes, cleaned up on exit): replies went from 6-9 s to 2-4 s and the first hive tool call no longer fails.
- Group chats: a name counts as a call only when it speaks to the agent (not as a noun inside a sentence), messages for another person are marked To: and only a verified correction or a danger is worth a reply, and unaddressed chatter wakes the agent at most 10 times per minute per thread (chatter_per_minute).
- Channel messages carry the current time (Now:), so agents no longer run date; pictures described by an image model are talked about naturally.

### Fixed

- Long conversations no longer freeze the browser: the chat loads the newest 60 messages with a "Show earlier" button, the history endpoint accepts `limit`, and parsed Claude transcripts are cached while the file is unchanged.
- Telegram forum topics: the implicit reply to the topic's first message is no longer read as a message aimed at someone else, so the agent is not left thinking people talk to another person.
- A long turn on group chatter that ends without `channel_reply` now gets one reminder, so a finished job is not lost as plain text nobody sees.
- The Telegram typing indicator is refreshed after the agent's own messages, no longer stops early when two turns overlap, logs failures and has a safety cap.
- An agent that ends a turn aimed at it without answering is reminded once to answer.
- Emoji such as the alarm clock are sent to Telegram with the emoji selector so they render.

## [1.0.0] - 2026-10-09

### Added

- Agent manager over Claude Code, OpenCode and Kiro, resuming each CLI's native session.
- Orchestrators and subagents: explicit delegation, with a new subagent session for every task.
- Colonies with optional inheritance of folder, permissions, skills and context; honeycomb map, agent types and relations canvas.
- Skills loaded always or on demand (per assignment), with seven skills included.
- Agent notebook: its own memory, readable and editable from the interface.
- Telegram connection: private chats, groups and topics, per-thread silence, files and images in both directions and an optional image model.
- Three permission levels (read-only, edit files and full access) enforced by the CLI itself in all three providers.
- Git changes explorer: tree, diffs, history, commit, pull, push, branches, conflicts, stashes, blame and discarding changes.
- Interface in English and Spanish, with light and dark themes.
- Complete documentation in English and Spanish.
- npm package with the `hive-am` command.

[Unreleased]: https://github.com/hughcbscrt/hive-am/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/hughcbscrt/hive-am/compare/v1.2.2...v1.3.0
[1.2.2]: https://github.com/hughcbscrt/hive-am/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/hughcbscrt/hive-am/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/hughcbscrt/hive-am/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/hughcbscrt/hive-am/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/hughcbscrt/hive-am/releases/tag/v1.0.0
