# 10. Chat and ways of displaying information

This document describes **what is shown** in the conversation with an agent, **where** each piece of data comes from and **how it is drawn**. Files: `web/components/chat/Chat.tsx`, `ToolCall.tsx`, `StatsBar.tsx`, `web/components/agents/AgentSwitcher.tsx` and `web/lib/format.ts`.

## 10.1 Layout of the agent screen

`app/agents/[id]/page.tsx` arranges two columns inside the main area, and a settings panel that **floats on top**:

```
┌ sidebar ──────┬ agent switcher ─────┬ chat ─────────────────────────────────────┐
│ (navigation)  │ AgentSwitcher       │ header + StatsBar       ┌ settings (float)┤
│ 220 px        │ 290 px (or 68 px)   │ transcript              │ Configuration   │
│               │                     │ text box                │ Sessions        │
└───────────────┴─────────────────────┴─────────────────────────┴─────────────────┘
```

- The **settings** panel is hidden by default; the **Settings** button in the header shows it (a dot indicates unsaved changes). Its state is remembered in `localStorage` (`hive-cfg-open`).
- The panel is `position: fixed` on the right: it **does not shrink the chat**, it is drawn on top with a shadow. It is 400 px wide by default. The expand button (next to *Hide*) takes it to **half the screen** and back; its left edge can also be dragged (or double-click to toggle). Minimum 340 px, maximum screen width − 80 px. The width is remembered in `localStorage` (`hive-cfg-width`).
- The page is mounted with `key={id}`: when switching agent from the switcher all local state is reset (draft, tab, session being read).

### Agent switcher (`AgentSwitcher`)

It can be **collapsed** with the button in its header (panel icon): it goes from 290 px to 68 px and leaves only each agent's **avatar with the initial**, grouped by colony with a small color bar. On hover, the *tooltip* shows the name and the provider; the current agent stays highlighted and those that are working keep their pulsing dot. Switching agent does not expand it and the choice is remembered (`hive-switcher-collapsed` in `localStorage`).

Side list grouped by colony (and "No colony"), with search. Each agent shows:

| Element | Source |
|---|---|
| Hexagonal avatar with a pulsing dot if working (red if error) | `status` |
| Name and *Orchestrator* label | `name`, `role` |
| Subtitle | If in a turn: **live activity** (e.g. "Running Shell ls -la", "Thinking…", "Writing a reply…", prefixed "Delegated task ·" if it is a delegation). Otherwise: its description, "Needs attention" if there is an error, or "No description yet". |
| Bottom line | Provider · model, and "how long ago" (or "N queued") |

## 10.2 How information reaches the chat

The chat combines **two sources**:

| Source | What it is | When it is used |
|---|---|---|
| **Native history** (`GET /api/agents/:id/history`) | The transcript stored by the CLI, normalized | Always: it is the truth. Loaded on open and **re-read** when each turn finishes |
| **Live turn** (`LiveTurn` in the store) | What arrives over WebSocket during the turn | Only while the agent is working |

When the turn finishes, the live state is discarded and the history just read already contains the same messages. If you open the page in the middle of a turn, the store rebuilds the turn with the accumulated events (`GET /live`).

### Optimistic echo of the user's message

When sending, the text is shown immediately (`pending`). It is hidden once the history already contains a user message with that same text. If sending fails, the echo is removed, the text is restored in the box and a notice is shown.

### How a live event is folded (`foldEvent`, `lib/store.tsx`)

| Event | Effect on `LiveTurn.blocks` |
|---|---|
| `text` / `thinking` | Appended to the last block of the same type, or a new one is created |
| `tool` | New `tool` block with `startedAt = now` |
| `tool_result` | Completes the `tool` block with that `id` (`output`, `error`) and computes `durationMs = now − startedAt` |
| `usage` | **Accumulated** in `LiveTurn.usage` (tokens are summed; `credits` and `contextPct` take the last value); also `cost` and `model` |
| `error` | Stores `LiveTurn.error` |

## 10.3 Transcript

### User messages

Dark bubble aligned to the right, with the text as is (line breaks are respected).

### Assistant answers

Header with avatar, name and "how long ago", followed by **blocks** in order:

| Block | How it is shown |
|---|---|
| `text` | Markdown (`react-markdown` + `remark-gfm`: tables, lists, code, links). Raw HTML is not allowed. Each text block is memoized and only reprocessed if its text changes |
| `thinking` | Collapsible **"Thought process"** row (live and being the last block: "Thinking…") with the reasoning in italics |
| `tool` | Tool row (see 10.4) |
| *(summary)* | At the end of the answer, **"Files changed (N)"** (see 10.4) |

#### Grouping of answers (`coalesce`)

Claude stores one entry per tool call. So that the user sees **a single answer**, consecutive assistant messages are **merged** into one: blocks are concatenated, tokens and cost are summed, the last model and the end time are kept. The duration shown is `end of the last message − time of the previous user message`.

#### Footer of each answer (`ReplyMeta`)

A discreet line with (only what exists):

- **Model** (without the `claude-` prefix or the date suffix).
- **Tokens:** `X in · Y out`, where *in* = input + cache read + cache write. The exact detail appears in the *tooltip*.
- **Credits** (Kiro).
- **Cost** with `≈` if it is an estimate (tooltip: "Estimated from list prices" / "Reported by the CLI").
- **N tools** (number of tools used).
- **Duration.**

### Live turn

While the agent is working, after the history the following is shown:

- If it is a **delegation**: a "Delegated task from *X*" card with the task text and a note that it runs in its own session.
- If it is a user message that does not yet appear in the history: its bubble.
- The partial answer (same blocks), three animated "Working" dots and a `LiveMeta` line with **elapsed time** (updated every 0.5 s), tools used, accumulated tokens and % of context if the CLI reports it.
- If an error occurs: a red banner with the message and a **Dismiss** button.

## 10.4 Tools (`ToolCall.tsx`)

Each tool call is a collapsible `<details>` row:

```
[icon] Label  summary (mono)            [exit 1] [N lines] [duration] [●] ›
```

- **Label and summary** come from `describe(tool)`, which recognizes the names from the three providers.
- **Metadata on the right:** exit code (Shell only, if the result contains `Exit code N`; red if ≠ 0), "failed" if there is an error without a code, number of output lines, duration and, if in progress, a pulsing dot.
- **In progress:** honey-colored border and a live timer.
- **Error:** red border.

### Recognition table (`describe`)

The name is normalized to lowercase without symbols (e.g. `str_replace` → `strreplace`). For MCP tools (`mcp__server__tool`) the tool's name is used.

| Label | Recognized names | Summary in the row | Content when opened |
|---|---|---|---|
| **Shell** | `bash`, `shell`, `executebash`, `execute`, `run`, `runcommand`, `command` (or any tool with `command` whose name contains `bash`) | **The full command**, with `$` in honey, up to 3 lines (1 when open) | Terminal block with the command and a **Copy command** button; the agent's description; real tool name, working directory, *timeout*, *background* (if present); output with **Copy output** |
| **Read** | `read`, `fsread`, `view`, `cat` | Full path (with `~` if under your home folder) | Path, `offset`, `limit` |
| **Write** | `write`, `fswrite`, `create`, `writefile` | Path · N lines | Path and content (max. 4000 characters) |
| **Edit** | `edit`, `strreplace`, `strreplaceeditor`, `patch`, `replace` | Path | Path and **diff** (old lines in red with `−`, new in green with `+`) |
| **Edit** (several) | `multiedit` with `edits[]` | Path · N changes | One diff per change |
| **Grep / Glob / Search…** | `grep`, `glob`, `search`, `find`, `ls`, `list`, `codesearch` | Pattern, query or path | All parameters |
| **Web** | `webfetch`, `websearch`, `fetch`, `browser` | URL or query | All parameters |
| **Subagent** | `task`, `agent`, `subagent` | Description or type | Type, description and prompt (max. 1500 characters) |
| **Plan** | `todowrite` with `todos[]` | "N/M done" | Task list with status (done struck through, in progress highlighted) |
| **Delegate** | `mcp__hive__dispatch` | `agent — task` | Subagent and full task |
| **Team roster** | other `hive` tools (`list_agents`) | — | — |
| *Others* | any other | First parameter | JSON of the parameters |

**Output** (all): an *Output* section with the returned text, trimmed to 12,000 characters (with a "(truncated)" notice); maximum height with scroll; "(no output)" if empty.

### Files changed (`ChangedFiles`)

At the end of each answer (also live, while the agent is working) a collapsible **Files changed (N)** block is shown with a row per file the agent wrote or edited (`changedFiles()` in `ToolCall.tsx`). It is open if there are 5 files or fewer.

- It only counts calls **without error** of writing (`write`, `fswrite`, `create`, `writefile`) and editing (`edit`, `strreplace`, `strreplaceeditor`, `patch`, `replace`, `multiedit`); several edits of the same file are added into one row.
- Each row shows the path, the *written* mark if the agent wrote the whole file, and `+N` / `−N` lines added and removed.
- Each file **expands** to see its changes: a red/green block per edit (what was removed and what was added) or, if it was a full write, the content (max. 6000 characters).
- The data comes from the tool's parameters, not from `git diff`: it may differ from what the [changes explorer](13-changes-explorer-git.md) shows and it carries no context lines or line numbers.

### Expand and collapse

Next to the text box, the **Expand all tools / Collapse all tools** link opens or closes all rows at once (`ToolsOpen` context); each row can then be opened or closed individually.

## 10.5 Statistics bar and panel (`StatsBar.tsx`)

Below the header, a strip with the summary of the session shown (the current one, or the one you are reading). It is computed on the server (`GET …/stats`, see [document 8](08-sessions-and-history.md#86-session-statistics-statsts)) and requested again when each turn finishes. While a turn is in progress, its live numbers are **added**.

| Indicator | Meaning |
|---|---|
| **Context** | % of context reported by the CLI (Kiro); otherwise `last context / 200,000` is computed (fixed value in `StatsBar.tsx`, `CTX_WINDOW`) |
| **tokens** | Input + output + cache read + cache written (format `1.2k`, `45.3k`, `1.25M`) |
| **credits** | Credits (Kiro), if any |
| **cost** | Total in USD with `≈` if estimated |
| **turns** | User messages |
| **tool calls** | Tool calls, with "· N failed" if there were errors |
| **working** | Accumulated working time (sum of turns) |

Clicking expands a panel with:

1. **Token mix:** stacked bar (cache read, cache write, input, output) and a legend with figures; reasoning tokens are indicated separately. Below, the list of **models** used with messages and output tokens.
2. **Tools used:** up to 9 tools with a proportional bar, times, errors and average time.
3. **Tokens per turn:** mini chart of the last 40 turns; the *tooltip* shows the prompt, tokens, cost, tools and duration.

## 10.6 Text box (`Composer`)

- It is an **isolated, memoized** component that keeps its own text: typing does not re-render the history (in a test with 12 messages ≈2 ms per keystroke was measured in development mode).
- **Enter** sends; **Shift+Enter** inserts a line break; it does not send during IME composition. It grows automatically up to 200 px.
- While the agent is working, the placeholder changes to "Queue a follow-up…": the message is **queued** (see [document 9](09-orchestration-and-relations.md#94-per-agent-queue)); the **Stop** button appears.
- When reading a session that is not the current one, the box is replaced by a read-only notice, and the header offers "Make this conversation current" (direct sessions only) and "Back to current".
- Below it, "N queued" is shown if there are queued messages.

## 10.7 Scroll behavior

The view stays anchored to the bottom **as long as you do not move away**:

- A `ResizeObserver` on the content re-anchors to the bottom when something grows (markdown, tools, tables).
- Turning the wheel up **unanchors**; getting back within 40 px of the bottom **re-anchors**; sending a message re-anchors.
- `scroll-behavior: smooth` is not used (it caused the view not to reach the bottom).

## 10.8 Empty state and notices

- No conversation: a "Say hello to *name*" card with different text for an orchestrator (describe a goal) and a worker (give a task).
- Transient notices use *toasts* (`useToast`): success in black for 3 s, error in red for 6 s.
- API errors are shown with the server's exact message.

## 10.9 Number formatting (`lib/format.ts`)

| Function | Rules |
|---|---|
| `fmtTokens(n)` | `<1000` → integer; `≥1000` → `x.xxk`; `≥10,000` → `x.xk`; `≥1,000,000` → `x.xxM` |
| `fmtCost(c)` | `0` → `$0`; `<0.01` → `<$0.01`; `<1` → 3 decimals; otherwise 2 decimals |
| `fmtDur(ms)` | `<1 s` → `ms`; `<10 s` → 1 decimal; `<60 s` → seconds; then `Xm Ys`; then `Xh Ym` |
| `ago(ts)` (`lib/meta.ts`) | "just now", "N min ago", "N h ago", "N d ago", or local date |
