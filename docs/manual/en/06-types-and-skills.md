# Agent types and skills

This is hive-am's **library**: two sections, in the **Library and history** group of Home and in **Ctrl K**, that save you from repeating configuration. **Agent types** are templates for creating agents in a couple of clicks. **Skills** are blocks of Markdown instructions that you reuse in as many agents as you like.

## Agent types

A type is a template with provider, model, prompt, permissions, role and skills. Open **Agent types** from Home or with **Ctrl K** ("types" or "templates" also find it).

![Agent types screen with three cards: Builder, Reviewer and Queen, each with Edit and Create agent](img/tipos-lista.jpg)

*Three example types. Each card shows the role (Worker or Orchestrator), the provider, the model, how many skills it has and how many agents use it. Point at the **Edit** and **Create agent** buttons.*

### Create a type

1. Open **Agent types** and click **New type**.
2. Enter the **Name** and a **Description** (shown when you pick a type).
3. Choose the **Role**: Worker or Orchestrator.
4. Choose the **Provider** (Claude Code, OpenCode, Kiro or Cursor) and the **Model**.
5. Under **What can it do?** choose **Read-only**, **Edit files** or **Full access**.
6. Write the system prompt and add the skills you want.
7. Click **Create type**.

### Edit a type

1. Click **Edit** on the type's card.
2. Change what you need.
3. Click **Save type**.

![Edit Builder panel with name, description, role, provider, model and permissions; Delete, Cancel and Save type at the bottom](img/tipo-editar.jpg)

*A type's edit panel. At the top it says existing agents do not change. At the bottom are **Delete**, **Cancel** and **Save type**.*

> **Note:** editing a type **does not change** agents already created from it. A type is only used at the moment you create the agent.

### Delete a type

1. Click **Edit** on the card.
2. Click **Delete** and confirm with **Delete type** (or **Keep type** to cancel).

Agents already created keep their configuration and only lose the link to the type.

### Create an agent from a type

1. On the type's card, click **Create agent**.
2. The **New agent** form opens with the message "From type ..." and the type's values already filled in.
3. Give it a name, choose the folder and adjust whatever you want.
4. Click **Create agent**.

The values are **copied**: from then on the agent is independent of the type. If you click **New** on the Colony screen instead, the first step lets you pick a type or **Blank agent**.

## Skills

A skill is a reusable block of instructions: a review checklist, a commit style, how to run your tests. It is added to the agent's instructions. Open **Skills** from Home or with **Ctrl K**.

### The ones that come with hive-am

Ten skills are created on install, ready to assign:

- **Notebook:** the agent's notebook, a memory of its own between conversations.
- **Wake-ups:** lets an agent remind itself later (see [Schedules](08-schedules.md)).
- **Chat channels:** how to behave on Telegram (see [Connections](09-telegram-connections.md)). It is assigned automatically when a connection answers through an agent.
- **Colony resources:** looking after the colony's servers and containers (see [Resources](10-resources.md)).
- **Database management:** looking inside the colony's databases and using them: structure, queries and, with the right permission, changes (see [Resources](10-resources.md#agents-and-databases)).
- **Git workflow**, **Pull requests**, **Code review**, **Release checklist**, **Running tests** and **Log triage**: general guides.

They are like any other skill: you can edit or delete them, and a deleted one is not created again. They only cost prompt in the agents you assign them to. Three have a built-in function: without **Notebook** the agent does not have the notebook tools, without **Wake-ups** it cannot remind itself later, and **Chat channels** is added to the agent that answers on a channel.

### The editor

![Skills library with the list on the left and the Markdown editor in split view for the Chat channels skill](img/skills-editor.jpg)

*The library. On the left, the list with the search box, how many agents and types use each skill and its weight in tokens (for example "~2.3k tokens"). On the right, the editor in **Split** mode: Markdown text on one side and the preview on the other.*

The editor has a formatting bar and three views: **Write**, **Split** and **Preview**. At the bottom it counts words and characters.

### Create a skill

1. In **Skills**, click **+** next to the search box (or **New skill**).
2. Enter a unique **Name**.
3. Enter a one-line **Description**. It is shown in the selectors.
4. Write the **Instructions** in Markdown, as a guide the agent follows.
5. Click **Create skill**.

### Edit and delete

1. Pick the skill in the list. While there are changes, the button says **Save skill** and "Unsaved" appears.
2. Edit and click **Save skill**.
3. To delete, click **Delete**. The warning tells you how many agents and types it will be unlinked from. Confirm with **Delete skill** or cancel with **Keep skill**.

### Search

Type in **Search skills** and the list is filtered. If nothing matches, you will see "No skills match ...".

### How much they weigh

Each skill shows its estimated size in tokens (about 4 characters per token). It matters because an assigned skill is added to the agent's prompt on every turn. Many long skills make every turn more expensive.

## Assigning skills

You can assign a skill to an **agent**, a **type** or a **colony**:

- In the form of an agent or a type, use the **Skills** field: search with "Search skills to add…" and pick one.
- In a colony, the skills are added to those of its agents if the colony shares skills (see [The colony](02-the-colony.md)).

![New agent form with the Notebook skill marked as always and the text "Always in the prompt: ~577 tokens · 0 on demand"](img/agente-nuevo-skills.jpg)

*The skill selector in an agent's form. Point at the **always** label next to Notebook and the weight summary below.*

### Always in the instructions or on demand

Each assigned skill is loaded in one of two ways, and you choose it where you assign it (not in the skill itself):

| Mode | What the agent sees | When to use it |
|---|---|---|
| **always** | All of its text, in the instructions of every turn | Short rules that must always be followed |
| **on demand** | Only a list with name and description; the agent reads the text with the `skill_read` tool when the task calls for it | Long or situational guides |

To change the mode, click the **always** or **on demand** label of the skill inside the selector.

- Below the selector you will see how many tokens always go in the prompt and how many skills are on demand. If it is a lot, the warning suggests moving the longest ones to "On demand".
- If a skill arrives through the colony and the agent also has it, the mode chosen on the **agent** wins.
- When you create an agent from a type, the type's modes are copied.

> **Tip:** keep "always" for short rules and move long guides to "on demand". That way you only pay for the list and for the text of the skills that are actually used.

> **Note:** in **Read-only** mode with Claude, MCP tools are blocked, so on-demand skills are included in full.

Next: [Sessions](07-sessions.md)
