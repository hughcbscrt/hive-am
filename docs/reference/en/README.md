# hive-am documentation

> 🇪🇸 [Leer en español](../es/README.md)

hive-am is a coding-agent manager. It lets you create **orchestrators** and **subagents** on top of three CLIs already installed on your machine (**Claude Code**, **OpenCode** and **Kiro**), group them into **colonies**, give them **skills**, talk to them from the browser or from Telegram, and see their whole history, even after a blackout.

This folder describes the whole project: how it is organized, how it runs, where each piece of data is stored and how the pieces communicate.

## Index

| # | Document | What it is about |
|---|---|---|
| 1 | [Overview](01-overview.md) | What it is, design principles, architecture, glossary |
| 2 | [Project structure](02-project-structure.md) | Folder tree and the responsibility of each file |
| 3 | [Entry points and execution](03-entry-points-and-execution.md) | How everything starts, ports, environment variables, scripts |
| 4 | [Storage](04-storage.md) | SQLite database, tables, migrations, the CLIs' files, `localStorage` |
| 5 | [Backend ↔ frontend communication](05-backend-frontend-communication.md) | REST API, WebSocket, flow of a message, reconnection |
| 6 | [Providers](06-providers.md) | How Claude Code, OpenCode and Kiro are handled; how to add another |
| 7 | [Agents, types, skills and colonies](07-agents-types-skills-colonies.md) | Data model, inheritance, composed instructions |
| 8 | [Sessions and history](08-sessions-and-history.md) | Native sessions, history readers, resuming |
| 9 | [Orchestration and relations](09-orchestration-and-relations.md) | Delegation, MCP, rules, per-agent queue |
| 10 | [Chat and display](10-chat-and-display.md) | How the conversation is shown, tools, tokens and costs |
| 11 | [Frontend](11-frontend.md) | Pages, components, state, styles and theme |
| 12 | [Operations and troubleshooting](12-operations-and-troubleshooting.md) | Security, known limits, diagnosis, how to test |
| 13 | [Changes explorer (git)](13-changes-explorer-git.md) | The **Changes** tab: file tree with highlighting and diff viewer, history and git actions (commit, pull, push, branches) |
| 14 | [External connections](14-external-connections.md) | Linking an agent to Telegram: single session, `channel_reply` tool, permissions, API and the **Connections** screen |
| 15 | [Colony objects](15-colony-objects.md) | Servers and Docker containers as hexagons of the colony: start / stop / restart, logs, how they run and the API |

## Suggested reading

- **I want to understand the project quickly:** 1 → 2 → 3.
- **I am going to touch the backend:** 4 → 5 → 6 → 8 → 9.
- **I am going to touch the interface:** 5 → 10 → 11.
- **Something does not work:** 12.

## Conventions of these pages

- File paths are relative to the repository root (`hive-am/`).
- English fragments (field names, commands, interface messages) are left as they exist in the code.
- When something is a limitation or a conscious decision, it is marked as a **Note** or listed in document 12.
