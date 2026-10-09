# Changelog

All notable changes to hive-am are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

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

[Unreleased]: https://github.com/hughcbscrt/hive-am/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/hughcbscrt/hive-am/releases/tag/v1.0.0
