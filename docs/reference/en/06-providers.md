# 6. Provider handling

A **provider** is a coding-agent CLI installed on your machine. hive-am uses no SDKs or ACP: it runs the CLI as a child process, **one process per turn**, and reads its line-delimited JSON output.

There are exactly three providers (`Provider = 'claude' | 'opencode' | 'kiro'`), registered in two places:

- `server/src/providers/index.ts`: the `runners` table (provider → generator function).
- `server/src/api.ts`: the `PROVIDERS` table (provider → binary and name for install detection).

## 6.1 The runner contract

```ts
type Runner = (o: TurnOptions) => AsyncGenerator<StreamEvent>;

interface TurnOptions {
  agent: Agent;               // ALREADY resolved agent (cwd, permissions, effective skills)
  prompt: string;             // user message or delegated task
  instructions: string;       // composed instructions (identity + prompt + skills + team + channels + notebook)
  refreshInstructions?: boolean; // the session received old instructions; resend
  mcpCaps: string[];          // capabilities of the `hive` MCP it receives: dispatch, channel, memory, skills (empty: no MCP)
  signal: AbortSignal;        // to stop the turn
}
```

A runner must: build the arguments, launch the CLI with `spawnLines`, and **translate** each line into a `StreamEvent` (see [document 5](05-backend-frontend-communication.md#turn-events-streamevent)). The runtime takes care of the rest (queue, status, persistence of the session pointer, WebSocket).

## 6.2 The common launcher: `providers/spawn.ts`

`spawnLines({ cmd, args, cwd, env?, stdin?, signal })`:

- Launches the process with `stdio: ['pipe','pipe','pipe']`, `cwd` = the agent's effective folder and **`PWD` = that same folder**.
  > **Why `PWD`:** Node inherits `PWD` from the hive-am server; OpenCode trusts `PWD` over the real `cwd` and was recording sessions in the server's folder. Setting it explicitly fixes this for all three providers.
- Delivers **stdout line by line** (`readline`), ignoring empty lines.
- `stdin`: if text is given, it writes it and closes; otherwise it closes stdin immediately.
- Cancellation: when the signal aborts it sends `SIGTERM` to the process.
- It ends on `exit`, not on `close`: some CLIs (OpenCode) launch a background service that inherits the stdout pipe and would make `close` never happen. After `exit` it waits 250 ms to drain the pipe and then destroys it.
- If the process exits with a code ≠ 0 and was not cancelled, it throws an `Error` with the code and the last 600 characters of stderr. The runtime turns it into an `error` event.
- `safeJson(line)` parses without throwing exceptions.

## 6.3 Claude Code (`providers/claude.ts`)

**Command** (the prompt goes through **stdin**, not as an argument):

```bash
claude -p --output-format stream-json --verbose --include-partial-messages \
       --permission-mode <permission> \
       [--resume <session_id>] \
       [--model <model>] \
       [--append-system-prompt "<instructions>"] \
       [--mcp-config ~/.hive-am/mcp/<agentId>.json --allowedTools mcp__hive]
```

| Aspect | Behavior |
|---|---|
| Permissions | `--permission-mode` receives `plan`, `acceptEdits` or `bypassPermissions` directly. In `acceptEdits`, `--disallowedTools` is added with `CLAUDE_EDIT_DENY` (`Edit(**/.git/**)`, `Edit(**/*.pem)`, `Edit(**/*.key)`); `.env` stays editable and writing outside the folder is already blocked by the mode itself. It is the only provider that tells "Edit files" from "Full access": with the former it edits files but a shell command that is not a file command (e.g. `python3 …`) is left unapproved and fails; with the latter everything runs. |
| Resume | `--resume <id>` if the agent has a session. |
| Instructions | They are passed on every turn with `--append-system-prompt`, **but Claude only applies them when the session is created**: with `--resume` it keeps the original system prompt. So, if they changed (skills, team, edited notes…), the resumed session receives an `<instructions update="true">` block before the message, like OpenCode and Kiro; the history hides it. |
| Delegation | If it is an orchestrator with subagents: it writes the MCP file and adds `--mcp-config` and `--allowedTools mcp__hive` (allows all tools of the `hive` server without asking for confirmation). |
| Session id | Taken from the first event that carries `session_id`. |

**Event translation**

| Claude line | `StreamEvent` |
|---|---|
| `stream_event` → `content_block_delta` / `text_delta` | `text` |
| `stream_event` → `content_block_delta` / `thinking_delta` | `thinking` |
| `assistant` with a `tool_use` block | `tool` |
| `assistant` with a `text` block (only if that text was not streamed) | `text` |
| `user` with a `tool_result` block | `tool_result` (`is_error` → `error`) |
| `result` | `usage` (tokens, `total_cost_usd`, `duration_ms`, first model of `modelUsage`) and then `done` (with `result` as `summary`) or `error` |

If the process ends without a `result` event, a plain `done` is emitted.

## 6.4 OpenCode (`providers/opencode.ts`)

**Command** (the prompt goes as the **last argument**):

```bash
opencode run --standalone --format json --thinking --auto \
  [-s <session_id>] [-m <provider/model>] "<prompt (with preamble if applicable)>"
```

| Aspect | Behavior |
|---|---|
| Permissions | Always `--auto` (approves whatever is not denied; a `deny` is still respected). The three levels are written as OpenCode rules in `opencodePermissions()` (`providers/opencode.ts`): **read-only** denies `edit`, `bash` and `task`; **edit files** allows reading and editing (`.env` included) except `.git/**`, `*.pem` and `*.key`, denies `bash` and `task`, and denies `external_directory` (everything outside the agent's effective folder, which is where the process starts) except `~/.hive-am/inbox/**`; **full access** adds no rules. `doom_loop` stays at its default. See [document 12](12-operations-and-troubleshooting.md). |
| Model | `-m` in `provider/model` format, e.g. `opencode/…`. |
| Resume | `-s <id>` **only if** the folder OpenCode recorded for that session (`session_v2.directory`) matches the agent's folder (or it cannot be known). If it does not match (sessions created with earlier hive-am versions that were recorded in the wrong folder), a **new session is started**. |
| Instructions | No system-prompt flag: they are sent as a preamble in the message (see 6.6). |
| Per-turn configuration | Always `--standalone` (a private server that does read the environment configuration) and the `OPENCODE_CONFIG_CONTENT` variable with `permission.question = "deny"` (and `edit`, `bash` and `task` if the agent is read-only). Turns are not interactive: OpenCode's `question` tool was dismissed and the process ended with exit code 1 ("The user dismissed this question"). Denied, the agent asks the question as normal chat text. |
| Delegation | The same `OPENCODE_CONFIG_CONTENT` variable adds the `hive` MCP server (only orchestrators with subagents). |
| Session id | `sessionID` field of any event. |
| Background service | Without `--standalone`, `opencode run` would use OpenCode's service and would not read the environment configuration; with it every turn brings up a private server. The `exit` handling from 6.2 still applies. |
| Persistent server (`providers/opencode-server.ts`) | Agents **answering an external chat** (an enabled connection) do not use a one-off server: each gets its own `opencode serve` (random port and password, bound to 127.0.0.1) and the turn is `opencode run --server <url>`. The hive MCP is already connected when the message arrives, so the first `tools.hive.*` call no longer fails with `Unknown tool` (that cost an extra model step per turn) and the ~4 s boot disappears; replies went from 6–9 s to 2–4 s. The server reads the agent's configuration (permissions, MCP) only when it starts, so a change in it, or in the folder, restarts it. To bound memory (about 150 MB idle and 300 MB after a turn each) at most **2** stay up (`HIVE_AM_OPENCODE_SERVERS` changes it; the least recently used one is stopped) and each stops after 5 minutes without turns. Stopping a turn also stops its server. Every other agent (web chat only, orchestrators, notebook) keeps the one-off `--standalone` server, and so does an agent whose server cannot start (a warning is logged). They are stopped when hive-am stops (also on Ctrl+C or a restart by a service manager); if hive-am is killed abruptly (`kill -9`, a crash) the survivors are listed in `~/.hive-am/opencode-servers.json` and stopped at the next start. `HIVE_AM_OPENCODE_STANDALONE=1` turns the feature off. |

**Event translation**

OpenCode emits **complete parts**, not deltas:

| OpenCode line (`part.type`) | `StreamEvent` |
|---|---|
| `text` / `reasoning` | `text` / `thinking`, computing the *delta* as the new part relative to what was already seen of that same part (map by `part.id` and length) |
| `step-finish` | `usage` (`tokens.input/output/reasoning/cache.read/cache.write`, `cost`) |
| `tool` | `tool` the first time it appears; `tool_result` when `state.status` is `completed` or `error` |

When the stream ends, `done` is emitted.

## 6.5 Kiro (`providers/kiro.ts`)

**Command** (prompt as the last argument):

```bash
kiro-cli chat --no-interactive --output-format stream-json \
  [--agent hive-<id>] [--trust-all-tools] [--resume-id <session_id>] [--model <model>] "<prompt>"
```

| Aspect | Behavior |
|---|---|
| Permissions | A tool that is not trusted cannot ask for approval (the turn is not interactive) and fails. **Read-only:** none trusted. **Edit files:** a generated profile (`~/.kiro/agents/hive-<id>.json`) with `allowedTools` = `fs_read`, `grep`, `glob`, `web_fetch`, `web_search` (`KIRO_EDIT_TOOLS`; not the shell) and `toolsSettings.fs_write`: `allowedPaths` = the agent's effective folder (including its dot files, such as `.env`) and `deniedPaths` = `.git`, `*.pem`, `*.key`. `fs_write` is not trusted as a whole, so a path outside the folder cannot be approved. **Full access:** `--trust-all-tools`. Two things we learned with Kiro 2.27: with a profile (`--agent`) the `--trust-tools` flag no longer applies, and the `permissions.rules` of the documentation are Kiro 3.x and are ignored here; that is why `toolsSettings` is used. |
| Resume | `--resume-id <id>`. Kiro sessions are per folder, hence the importance of `cwd`. |
| Instructions | Preamble in the message (see 6.6). |
| Profile | Kiro only loads MCP servers and allowed paths from a `~/.kiro/agents/hive-<agentId>.json` profile, which hive-am regenerates on every turn when the agent has hive tools (`mcpServers.hive`, `tools: ["*"]`, `allowedTools: ["@hive"]`: delegation, channels, notebook, on-demand skills) or the "Edit files" permission; in that case it runs with `--agent hive-<agentId>`. |
| Session id | `data.sessionId` of any event. |

**Event translation** (Kiro emits ACP events as line-delimited JSON):

| Kiro line | `StreamEvent` |
|---|---|
| `metadata` with `meteringUsage` or `contextUsagePercentage` | `usage` (`credits`, `contextPct`, `durationMs`) |
| `sessionUpdate` → `agent_message_chunk` | `text` |
| `sessionUpdate` → `agent_thought_chunk` | `thinking` |
| `sessionUpdate` → `tool_call` | `tool` (name = `title` or `kind`) |
| `sessionUpdate` → `tool_call_update` with status `completed`/`failed` | `tool_result` |
| `runFinished` with `status: success` | `done` (with `finalText`) |
| `runFinished` with another status | `error` |

## 6.6 Instructions preamble (`providers/preamble.ts`)

OpenCode and Kiro have no flag to add a system prompt, so the instructions travel **inside the message**:

| Situation | What is sent |
|---|---|
| New session | `<instructions>…</instructions>` + the message |
| Resumed session and the instructions **changed** (`refreshInstructions`) | `<instructions update="true">` (with a notice that it replaces the previous ones) + the message |
| Resumed session without changes | Only the message |

How does the runtime know they changed? It computes a SHA‑1 of the composed instructions and compares it with `agents.instr_hash` (the fingerprint that session received). This avoids, for example, an orchestrator keeping an old list of subagents after new ones are connected to it.

The history readers **hide** these blocks when showing the chat (see [document 8](08-sessions-and-history.md)). The models do receive them.

## 6.7 Install detection and models

**Installation** (`GET /api/providers`): runs `claude --version`, `opencode --version`, `kiro-cli --version` (max. 8 s each). If they fail → `installed: false`. Result cached for 60 s. The UI shows "● installed" / "● not found" in the provider selector.

**Models** (`server/src/models.ts`, 10-minute cache, only non-empty results are cached):

| Provider | Source |
|---|---|
| Claude | Fixed list: `opus`, `sonnet`, `haiku`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-4-5-20251001` |
| OpenCode | Output of `opencode models` (lines in `provider/model` format are accepted) |
| Kiro | `kiro-cli chat --list-models --format json` |

The UI's model field is free text with suggestions (`<datalist>`): if the CLI does not list models, you can type any id; empty = the CLI's default model. Changing an agent's provider clears the model in the form.

## 6.8 Costs and prices

- Claude: `result.total_cost_usd` is emitted as `usage.cost` live; the history has no cost, so it is **estimated** with `pricing.ts`.
- OpenCode: uses the cost the CLI reports; if it is 0, it tries to estimate.
- Kiro: bills in **credits**, not tokens; credits are shown.

Estimation table (USD per million tokens, by family detected in the model name):

| Family | Input | Output | Cache read | Cache write |
|---|---|---|---|---|
| opus | 5 | 25 | 0.5 | 6.25 |
| sonnet | 3 | 15 | 0.3 | 3.75 |
| haiku | 1 | 5 | 0.1 | 1.25 |

Models outside those families have no estimated cost. Estimates are marked with "≈" in the UI.

## 6.9 How to add a new provider

1. **Types:** add the value to `Provider` in `server/src/types.ts` and `web/lib/types.ts`.
2. **Runner:** create `server/src/providers/<name>.ts` with a generator `(o: TurnOptions) => AsyncGenerator<StreamEvent>` using `spawnLines`. Set `cwd` and remember to emit `session` as soon as you know the id.
3. **Registration:** add it to `runners` (`providers/index.ts`) and to `PROVIDERS` (`api.ts`).
4. **History:** create a reader in `server/src/history/<name>.ts` that returns `ChatMessage[]` and link it in `history/index.ts`.
5. **Models:** add the branch in `models.ts`.
6. **UI:** add name, color and description in `web/lib/meta.ts` (`PROVIDERS`) and the `--p-<name>` color variable in `globals.css` (light and dark).
7. **Instructions:** if the CLI has no system-prompt flag, use `withInstructions`; if it has one, pass them on every turn.
8. **Delegation (optional):** if it supports MCP, add the configuration object in `mcp-config.ts` and pass it when `o.mcpCaps` is not empty (the server announces only the tools of those capabilities).
