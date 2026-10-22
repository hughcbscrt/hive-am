# hive-am manual

hive-am is a manager for colonies of coding agents. It lets you create **orchestrators** and **workers** on top of the tools you already use (Claude Code, OpenCode, Kiro and Cursor), group them into **colonies**, talk to them from the browser or from Telegram, and see everything they did, even after you restart your machine.

It does not replace those programs: it runs the ones you have installed and never copies your conversations into its own database. Everything runs on your computer, and your data lives in `~/.hive-am`.

![The sample colony map with two colonies, agents and resources](img/colonia-mapa.jpg)

*The colony map: each hexagon is an agent or a resource, and each outlined area is a colony.*

## Who it is for

For anyone who works with coding agents and wants more than a terminal: split tasks among several agents, keep real sessions that resume, watch the servers and databases of your project, review git changes and have it all in a single local interface.

## Contents

1. [Getting started](01-getting-started.md): requirements, how to start hive-am, a tour of the interface (Home and the menu) and your first agent.
2. [The colony](02-the-colony.md): the hexagon map, the statistics, colonies and what they share with their agents.
3. [Agents](03-agents.md): create, configure and manage agents.
4. [Chat](04-chat.md): talk to an agent and understand what the conversation shows.
5. [Orchestration and relations](05-orchestration-and-relations.md): orchestrators that delegate to workers.
6. [Types and skills](06-types-and-skills.md): agent templates and reusable knowledge.
7. [Sessions](07-sessions.md): the real history of each agent and how to resume it.
8. [Schedules](08-schedules.md): messages and reminders sent at a set time.
9. [Connections (Telegram and Slack)](09-telegram-connections.md): talk to an agent from a Telegram bot or a Slack app.
10. [Resources](10-resources.md): servers, containers, HTTP requests, databases and clusters.
11. [Changes explorer (git)](11-changes-explorer-git.md): see diffs and history, switch branches and make commits.
12. [Terminals](12-terminals.md): the bottom panel with real shells and logs.
13. [Permissions and security](13-permissions-and-security.md): what each agent can do and what hive-am protects.
14. [Troubleshooting](14-troubleshooting.md): common symptoms and how to fix them.

## How to read this manual

- The names of buttons, tabs and menus are in **bold**, exactly as they appear in the English interface.
- Interface paths are written with `>`. For example, **Colony** > **New** > **New agent** means: open the Colony screen, click the **New** menu and choose **New agent**.
- The screenshots use sample data from a project called "Online store", with the agents Queen (orchestrator), Backend, Frontend, QA and Guardian. Your names and values will be different.
- The chapters are meant to be read in order the first time. After that, you can jump to the one you need.
- **Note** and **Tip** blocks point out details worth not missing.

> **Note:** the manual is available in English and Spanish (the Spanish version is in [../es/README.md](../es/README.md)). The hive-am interface can also be switched between English and Spanish with the **EN** / **ES** selector in the sidebar.

## Key concepts

- **Agent:** a configuration (name, provider, model, folder, permissions, instructions) plus a pointer to its real session in the command-line tool. It is the one that does the work.
- **Orchestrator:** an agent that plans and delegates tasks to the workers connected to it.
- **Worker:** an agent that does the work it receives, either from you directly or from an orchestrator.
- **Colony:** a group of agents drawn together on the map, which can lend them defaults: working folder, permissions, skills and a shared context.
- **Type:** a template for creating agents with provider, model, instructions and skills already filled in.
- **Skill:** a block of text knowledge added to an agent's instructions, either always or only on demand.
- **Notebook:** the persistent notes an agent keeps about what it learns. You can read and edit them from its settings.
- **Session:** an agent's real conversation, stored by the command-line tool. hive-am reads it from there and resumes it.
- **Resource:** something that lives in the colony and that you can start, stop or inspect: a server, a Docker container, HTTP requests or a cluster that groups several of them.
- **Connection:** a link between an agent and an external platform (Telegram) so you can talk to it from outside the browser.

Next: [Getting started](01-getting-started.md)
