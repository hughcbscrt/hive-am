# Changelog

All notable changes to hive-am are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/hughcbscrt/hive-am/commits
