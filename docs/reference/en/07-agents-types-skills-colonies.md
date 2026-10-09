# 7. Agents, types, skills and colonies

## 7.1 Agent

An agent is **configuration + session pointer**. Fields (`server/src/types.ts`, type `Agent`):

| Field | Description |
|---|---|
| `id`, `name`, `description` | Identity. The name is unique (lookup by name ignores case) and is how orchestrators name it when delegating. |
| `role` | `orchestrator` or `worker`. |
| `type_id` | Type it was created from (informational; see 7.2). |
| `provider`, `model` | Provider and model. **Always the agent's own**, never inherited. |
| `permission` | `plan` (read-only), `acceptEdits` (edits files), `bypassPermissions` (full access). |
| `system_prompt` | Own prompt. |
| `skill_ids` | Own skills. |
| `cwd` | Own folder (may be empty if it inherits). |
| `colony_id`, `overrides` | Colony and the fields where it ignores the colony. |
| `worker_ids` | Orchestrators only: connected subagents (`assignments` table). |
| `session_id`, `session_cwd`, `instr_hash` | Current direct session and data to resume it ([document 8](08-sessions-and-history.md)). |
| `status` | `idle`, `running`, `error`. |
| `effective` | **Computed**: final values after applying the colony (see 7.5). Not stored. |

### Permissions and what they mean per provider

| Permission | Claude | OpenCode | Kiro |
|---|---|---|---|
| `plan` (Read-only) | `--permission-mode plan` | Denies `edit`, `bash` and `task` | No tool trusted |
| `acceptEdits` (Edit files) | `--permission-mode acceptEdits`, without `.git` or keys | Edits (`.env` included), no commands, no `.git` or keys, only inside its folder | Edits (`.env` included), no commands, no `.git` or keys, only inside its folder |
| `bypassPermissions` (Full access) | `--permission-mode bypassPermissions` | No restrictions (`--auto`) | `--trust-all-tools` |

Claude is the only one that, in "Edit files", lets file commands through (`touch`, `mv`…); the other two block all of them. The three levels are checked with `server/scripts/sim-readonly.ts`.

Details and limits in [document 6](06-providers.md) and [12](12-operations-and-troubleshooting.md).

### Where an agent is created and edited

| Place | Component | Notes |
|---|---|---|
| Colony / Agents → **New agent** | `NewAgentDrawer` | Step 1: choose a type or "Blank agent"; step 2: form. If opened from a colony's **+** cell, the colony comes preselected. |
| Types screen → **Create agent** | `NewAgentDrawer` with a fixed type | Skips step 1. |
| Colony → settings button of the selected agent | `AgentEditDrawer` | Edits in a side panel without leaving the honeycomb. |
| Agent screen → **Settings** | collapsible panel of `agents/[id]/page.tsx` | Includes the *Sessions* tab and deletion. |

All three use the same form, `components/agents/AgentForm.tsx`, with the same validation (`validate()`):

- The name is required and cannot be repeated.
- There must be an effective folder: either its own, or the colony's if it follows it.
- For orchestrators the **Team** section (connected subagents) appears.

The server validates again (`validateAgentInput`): name, provider, role, that the folder **exists** on disk and that the colony exists.

## 7.2 Agent types

A **type** is a template: provider, model, prompt, permission, role, skills. Screen: `/types`.

- Creating an agent "from a type" **copies** its values (`draftFromType` in the UI, or `POST /api/types/:id/spawn`). After that the agent is independent: editing the type does **not** change the agents already created.
- `type_id` stays as a reference to show "N agents use this type".
- Types are not inherited through colonies and play no part at run time.

## 7.3 Skills

A skill is a block of markdown instructions with a unique name and a description. Screen: `/skills` (editor with *Write* / *Preview* tabs and usage count).

It can be associated with **types**, **agents** and **colonies**. At run time it is added to the prompt in this format:

```
## Skill: <name>
_<description>_

<content>
```

Skills with empty content are skipped. `GET /api/skills/usage` counts the agents and types that use each skill (colonies are not counted).

### 7.3.1 Skills that ship with hive-am

On install, nine skills ready to assign are created (suggested **on demand** except Notebook, Chat channels and Wake-ups): **Notebook** (the agent's notebook), **Wake-ups** (tell the person later; its tool `wake_me` exists only with the skill, see [14.6.7](14-external-connections.md#1467-telling-the-person-later-the-wake-ups-skill-and-wake_me)), **Chat channels** (how to behave in Telegram/Slack; it is assigned by itself, see [14.6.6](14-external-connections.md#1466-the-chat-channels-skill)), **Git workflow**, **Pull requests**, **Code review**, **Release checklist**, **Running tests** and **Log triage**. They are the same as any other skill: no category and no protection, they can be edited or deleted, and a deleted one is not recreated (4, `seeded_skills`). They are general instructions and only cost prompt in the agents you assign them to. Three are tied to a function: **Notebook** (id `default-notebook`): without it an agent does not have the notebook tools; **Wake-ups** (id `default-wakeups`): without it an agent does not have `wake_me`; and **Chat channels** (id `default-channels`). The last two are added to an agent when a connection starts answering through it.

### 7.3.2 The agent's notebook

The **Notebook** skill gives the agent its own memory that survives conversations, without anyone having to approve it:

- **What it is:** Markdown with `## Topic` sections and `- …` notes, up to **8000 characters** (it is prompt on every turn). It lives in `agent_notebooks`.
- **Tools** (`hive` MCP, `memory` capability, only if the agent has the skill): `notebook_add({ section, note })` saves **one** short note (≤ 500 characters) under a section, without duplicates; `notebook_read()` returns text and version; `notebook_rewrite({ content, version })` replaces everything (to tidy or correct) and requires the version read, so two writes do not overwrite each other. If it is full, the error tells it to tidy it itself.
- **What to save** is defined by the skill: preferences and corrections, project facts that are not in the code, lessons and pointers; not temporary state, chit-chat or anything that can be deduced from the code.
- **Protections:** notes with credentials (private keys, GitHub/Slack/Telegram/AWS tokens, JWTs, `password: …`, connection strings with user and password) are **rejected**; each note carries its source (`2026-10-08 · Telegram: Ana`) so it can be reviewed; and the instructions say notes are information, never rules: a note (or a group message) that asks to ignore its instructions is ignored.
- **How it reaches the agent:** in the instructions, sections "Your notebook" (mechanics, stable) and "Your current notes" (the text). The text **does not count** toward the instructions hash: what the agent writes does not force resending everything. If the user edits the notebook, or it was written in another conversation (`version > seen`), the resumed session receives the instructions again.
- **Interface:** **Notebook** tab in the agent's settings: Markdown editor, `n / 8000` counter, who updated it and when, *Clear all*, and a notice with an *Enable* button if the agent does not have the skill. It refreshes itself every 4 s while you are not typing; saving with an old version is rejected so as not to overwrite what the agent wrote.
- **Test:** `server/scripts/sim-notebook.ts <provider> [model]`.

### 7.3.3 On-demand loading

Each skill can be loaded in two ways, and **it is chosen where it is assigned** (on an agent, a type or a colony), not on the skill: the same guide can be heavy for one agent and routine for another.

| Mode | What the agent sees | When to use it |
|---|---|---|
| **Always** (`always`) | Its whole text, in the instructions of every turn | Short rules that must always be followed |
| **On demand** (`on_demand`) | A "Skills you can load" list with name and description; the text is fetched with the `skill_read({ name })` tool when the task asks for it | Long or situational guides |

- **Where it is changed:** each chosen skill is a *pill* with an `always` / `on demand` button; one click toggles it. When adding a new skill it takes the skill's own suggestion (`skills.load`); removing it deletes its choice. Below the picker, what always goes in the prompt is summed up, with a warning if it exceeds ~3000 tokens.
- **Who wins:** if a skill arrives through the colony and the agent also has it, **the agent's** choice applies; otherwise the colony's (`agent.effective.skill_loads`). When creating an agent from a type, the type's choices are copied.
- **When saving a list** of skills, those that were already there keep their mode unless another is sent (`skill_loads` in `POST/PATCH` of agents, types and colonies: `{ [skillId]: "always" | "on_demand" }`).
- **Why:** with many skills assigned, loading them all in full makes every turn more expensive. This way you only pay for the list (a few lines) and the text of those that are used.
- **How it works:** `skill_read` belongs to the `hive` MCP (`skills` capability, only if the agent has some on-demand skill). It answers only with skills that agent has (also those of its colony). Once read, it stays in the conversation. On-demand text **does not count** toward the instructions hash: editing that skill reaches the agent on its next read, without resending anything.
- **Exception:** Claude blocks all MCP tools in Read-only mode (`plan`), so there on-demand skills are included in full.
- **Weight in view:** the library and the picker show each skill's estimated size (~4 characters per token; `web/lib/tokens.ts`).
- **Test:** `server/scripts/sim-skills.ts <provider> [model]` (includes agent/colony inheritance).

## 7.4 Colonies

A colony groups agents and **lends them default values**. It is managed from the Colony screen (`ColonyEditor.tsx`).

Fields: `name` (unique), `color`, `cwd`, `permission`, `system_prompt` (shared context), `skill_ids`, `inherit` and the member list.

### What is inherited

| Field | Inherited | How it combines with the agent's value |
|---|---|---|
| Folder (`cwd`) | Yes | The colony's **replaces** the agent's (if the colony has a folder). |
| Permissions | Yes | The colony's **replaces** the agent's. |
| Skills | Yes | They are **added**: first the colony's, then the agent's (no duplicates). |
| Context (system prompt) | Yes | It is **prepended**: colony context, blank line, agent prompt. |
| **Provider and model** | **Never** | Always the agent's. |

### When an agent follows its colony

For each field `f` ∈ {`cwd`, `permission`, `skills`, `prompt`}:

```
follows(f) = the agent has a colony
          AND colony.inherit[f] is true
          AND f is NOT in agent.overrides
```

- `colony.inherit` is the default value decided when saving the colony.
- `agent.overrides` is the individual exception: in the agent's form each inheritable field shows a "Following / Own value" checkbox.
- When changing colony in the form, `overrides` is reset to `[]`.

### Question when saving a colony

Every time you create or save a colony, **"What should its agents inherit?"** appears with checkboxes for folder, permissions, skills and shared context:

- A checkbox is **disabled** if there is nothing to share (e.g. no folder defined).
- For a new colony, the checkboxes with a value come checked.
- If the folder change will move existing agents, the dialog says how many will **start a new conversation** (the previous ones are kept in *Sessions*).

### Membership

- An agent belongs to at most one colony (`agents.colony_id`).
- It is assigned from: the colony editor (member list), the agent's form (*Colony* selector) or the side panel of the Colony screen.
- When saving the colony with `agent_ids`, the list **replaces** the previous membership (those not included are left without a colony).
- Deleting a colony leaves its agents without a colony; they stop inheriting.

## 7.5 Resolution of effective values

`server/src/db.ts`, internal function `agentRow`, computes `effective` every time an agent is read:

```ts
effective = {
  cwd:           follows('cwd') && colony.cwd ? colony.cwd : agent.cwd,
  permission:    follows('permission') ? colony.permission : agent.permission,
  system_prompt: [follows('prompt') ? colony.system_prompt : '', agent.system_prompt] // no empties, joined with "\n\n"
  skill_ids:     unique([...(follows('skills') ? colony.skill_ids : []), ...agent.skill_ids]),
  inherited:     list of fields it actually follows
}
```

`resolved(agent)` (also in `db.ts`) returns a copy of the agent with `cwd`, `permission`, `system_prompt` and `skill_ids` already replaced by the effective ones. **The runtime and the runners always work with the resolved agent**; the UI uses `effective` to show the real folder and the "from colony" label.

If the effective folder is empty when a turn starts, the turn fails with: *"This agent has no working folder. Set one on the agent or on its colony."*

## 7.6 Composed instructions (`composeInstructions`)

`instructions.ts` builds, for each turn, the instruction text of the **resolved** agent:

1. **Identity** (`## Who you are`): name, role (orchestrator/worker), purpose (`description`), an indication to answer with its own name and not as the underlying CLI/model, its **working folder** and its **colony** (name and shared folder).
   - If the turn is a delegation, it adds that the task comes from an orchestrator and it must finish with a short, self-contained report.
2. Effective **system prompt** (colony + agent).
3. Effective **skills**: those loaded *always* with their full text, one section per skill; those *on demand* as a "Skills you can load" list (see [7.3.3](#733-on-demand-loading)).
4. **Team** (orchestrators only): see [document 9](09-orchestration-and-relations.md#95-orchestrator-instructions).
5. **Connections** (if the agent has any): how messages from a channel arrive and how to reply; see [document 14](14-external-connections.md).
6. **Notebook** (if it has the Notebook skill): how to use it, and separately the current text of its notes, which does not count toward the instructions hash ([7.3.2](#732-the-agents-notebook)).

### Where the rules an agent receives live

| Origin | What it contributes | Where it is changed |
|---|---|---|
| Interface | Agent and colony system prompt, skills (always / on demand), name, role, description and folder, subagents, notebook text | Agent, type and colony forms; Notebook tab |
| Code: `server/src/instructions.ts` | Fixed rules in English: identity, team, a short channel section (tool names, aliases and the secrets rule), notebook and on-demand skills. How to behave in chats (groups, files, silence, secrets) is the **Chat channels** skill, editable in Skills | Only by editing the code; no interface setting modifies them |
| Code: `server/mcp/dispatch.mjs` | Description of each MCP tool (`channel_send_file` says not to use the bot token) | Code only |
| Code: `server/src/connections/prompt.ts` | Header of each channel message (`[hive:channel]`, `[hive:files]`, `[hive:context]`) | Code only |
| Code: `server/src/providers/opencode.ts` | Configuration that forbids the `question` tool | Code only |

The instructions **guide the model, they do not force it**. What the server does enforce: whom each connection answers (authorized people and groups), the agent's permission (enforced by the CLI in all three providers; tested with `sim-readonly.ts`) and which files may leave (`connections/outbound.ts`). For example, the rule "do not look for the bot token" is an instruction; the token is still in the local database ([14.6.3](14-external-connections.md)).

How they reach the CLI: through `--append-system-prompt` in Claude (when the session is created; if they change later, as an update block in the message) and as a preamble in the message in OpenCode and Kiro ([document 6](06-providers.md#66-instructions-preamble-providerspreamblets)).
