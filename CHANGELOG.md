# Changelog

All notable changes to hive-am are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Terminals: a bottom panel (Ctrl+`) with real shells (a pty each, kept by the server, replayed when a page attaches) and the logs of objects in tabs; from an agent, a server object or a container. Only this machine can reach them (loopback host and origin), `HIVE_AM_TERMINALS=0` turns them off, `node-pty` is an optional dependency.
- HTTP-requests objects: a folder of `.http` / `.rest` files with environments (`http-client.env.json` and the private one), file and generated variables, bodies from a file and a runner to send the requests and read the answers; nothing is sent while a variable is missing, and credentials are hidden in the echoed request.
- Boss objects: group servers and containers of a colony to start them in order, stop them in reverse, see one state and read their logs together with the name of each member.
- Agents that look after colony objects: a "Colony objects" skill gives an agent `object_list`, `object_logs` and `object_action` (start, stop, restart) for the objects of its own colony; read-only agents cannot act, nothing can be created or changed by an agent, and the log says who asked. A "Create a manager agent" button in the object panel sets one up.
- Colony objects: servers (a command hive-am keeps running, with its own process group and log file, found again after a restart) and Docker (a container hive-am creates, a compose project, or an existing container that is never removed) as hexagons on the Colony map, with state, start / stop / restart and live logs. API under `/api/objects`; changes only from the local app.
- Git explorer: a Compare tab (two branches, tags or commits: files, commits in between and diffs, pictures before and after), history search by message, author or content, by branch or tag, and by hash; history of a single file; "View at…" to read a file as it was at any ref; search inside the files; creating a branch from a tag (without switching) and deleting local branches; `/` and `Alt+1…5` shortcuts and the last open file remembered per agent.
- Tags in the git explorer: a Tags tab lists the repository's tags; each one can be browsed read-only (its files as they were at that tag, with Markdown preview, and the changes of its commit). The working folder is never touched.

### Changed

- One path picker for every folder or file field (agent, colony and server folders, the compose file, Docker volumes), including a file mode.
- Your messages in the web chat (and in Sessions) are no longer inverted bubbles: light with a thin border in the light theme and dark in the dark theme.
- Tooltips: every `title` in the interface now shows a styled tooltip (after a short pause, or on keyboard focus) instead of the browser's own, in both themes. Icon-only elements keep the text as their accessible name.
- Git explorer, less crowded: one toolbar row (Fetch, Pull and Push are icons with a tooltip and their counts), icon tabs where only the open one shows its name, a single filter row (name/content toggle and a "changes only" button) and a two-row file header with the secondary actions as icons.
- Sessions screen: a sidebar like the Skills one, a transcript that opens on its latest 100 messages (with a button for earlier ones) and long messages folded behind "show all".
- The sessions list no longer reads every conversation to answer: sizes and costs are cached by conversation fingerprint and filled in the background, so the list appears at once even with very long sessions.
- Thinner scrollbars with no track, tinted with the theme colour and darker while hovered, in light and dark themes.

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

[Unreleased]: https://github.com/hughcbscrt/hive-am/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/hughcbscrt/hive-am/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/hughcbscrt/hive-am/releases/tag/v1.0.0
