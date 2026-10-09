# 14. External connections (Telegram)

A **connection** links a hive-am agent with a messaging platform so you can talk to it from there. Today there is the **Telegram** adapter; the structure is designed to add others (Slack is next). Files: `server/src/connections/`, `server/mcp/dispatch.mjs`, `web/app/connections/page.tsx`, `web/components/ConnectionDrawer.tsx`.

## 14.1 Core idea: a single session

The connection is **just an adapter**: it receives messages and hands them to the agent exactly like the web chat. There is no session per thread or per person: **all messages, from all threads and from the hive-am chat, share the agent's direct session**. What is said to it over Telegram it remembers in the web chat and vice versa. The thread only decides **where what the agent sends goes**.

Consequences:
- If two threads talk at once, their messages are mixed in the same history. Each message carries a header with its origin (14.3) and turns are serialized with the usual queue (`sendTurn`).
- `/new` from a channel restarts **everyone's** session (14.5).

## 14.2 Flow of a message

```
Telegram ─► TelegramAdapter ─► router ─► sendTurn(agent, prompt with header, origin)
                ▲                                     │
                └── POST /api/channel/reply ◄── MCP `hive` ◄── the agent calls channel_reply
```

1. The adapter receives the message and turns it into an `Inbound` (message id, thread key, user, text, reply destination).
2. **Allow list:** if the user is not on it, they are answered **only once** with their own id and nothing is processed.
3. The thread (`threads`) and the message (`thread_messages`) are recorded; an already recorded message (repeated delivery) is discarded.
4. Commands (`/stop`, `/status`, `/new`) are resolved without going through the agent.
5. Limits: text up to 8000 characters and 20 messages per user per minute (`config.rate_limit`).
6. If the agent is busy, "Queued (N ahead)" is shown.
7. `sendTurn` is called with the **origin** (connection, thread, platform, place, user). While it works, "typing…" is shown.
8. **The agent answers with the `channel_reply` tool**, once or several times. Its plain text does **not** reach the chat.
9. When it finishes: if it replied, done; if it did not call the tool, `on_silent` applies; if the turn failed, the error is sent to the thread.

`on_silent` (per connection): `notice` (default, says "The agent finished without replying"), `send_text` (sends its final text) or `ignore`.

## 14.3 Origin header

Each message reaches the agent with a fixed-format header (`connections/prompt.ts`; the interface recognizes it in `web/lib/channel.ts`):

```
[hive:channel] Telegram · Place: DM · Thread: 42 · From: maria (42)
Message:
can you check yesterday's deploy?
```

That way the agent knows where it comes from; the web chat draws it as a **channel bubble** (platform, place and sender) and not as raw text.

## 14.4 The `channel_reply` tool and MCP capabilities

The `hive` MCP server (`server/mcp/dispatch.mjs`) announces tools according to the `HIVE_CAPS` variable:

| Capability | Tools | Who has it |
|---|---|---|
| `dispatch` | `list_agents`, `dispatch` | Orchestrators with at least one subagent |
| `channel` | `channel_reply`, `channel_send_file`, `channel_mute` | Agents with at least one **active** connection |
| `memory` | `notebook_read`, `notebook_add`, `notebook_rewrite` | Agents with the Notebook skill ([7.3.2](07-agents-types-skills-colonies.md#732-the-agents-notebook)) |
| `skills` | `skill_read` | Agents with some *on-demand* skill ([7.3.3](07-agents-types-skills-colonies.md#733-on-demand-loading)) |

`mcpCaps(agent)` in `instructions.ts` computes the set on every turn and the three providers receive it (`TurnOptions.mcpCaps`). `channel_reply({ text })` answers **the thread of the message being attended**; the agent does not copy ids. If the turn does not come from a channel it returns an explanatory error. The agent's instructions (`composeInstructions`) add a section that explains it, with the tool's name according to the provider.

Tokens never reach the agent: the MCP calls `POST /api/channel/reply` on the local server and it is the adapter that sends.

## 14.5 Permissions

- **Minimum "Edit files".** Claude blocks all MCP tools in `plan` ("Read-only") mode, including `channel_reply`, so an agent with an active connection cannot be in `plan`. The server requires it when creating or editing the connection and also when changing the permission of the agent or its colony: the update is **reverted** (transaction) if it would leave a linked agent in `plan`.
- **"Full access"** is allowed; the interface shows a warning: anyone on the list will be able to make the agent run commands on the machine.
- The three permission levels are applied in the three providers ([document 12](12-operations-and-troubleshooting.md)), OpenCode and Kiro included.
- The agent's form disables "Read-only" while it has active connections, and the connection's panel offers an **Allow file editing** button.
- **Chat commands:**

| Command | Who | Effect |
|---|---|---|
| `/stop` | Anyone allowed | Aborts the turn in progress |
| `/status` | Anyone allowed | Agent, status, folder and queue |
| `/mute` · `/unmute` | Anyone allowed | Silences or reactivates the agent **in that thread** (14.6.1) |
| `/new` | Administrators only | Asks for confirmation (`/new confirm`) and restarts the shared session |

## 14.6 Telegram

Implemented with plain `fetch` against the Bot API (no new dependencies), by **long polling**: no public URL is needed.

- **Start:** `getMe` validates the token. If it is invalid, the connection is saved with `error` status and the reason ("Invalid bot token").
- **Polling:** `getUpdates` with a 25 s wait; the *offset* is saved in `connection_cursor` as soon as each update is delivered, so a restart does not repeat messages. Network errors retry with increasing waits (up to 30 s); a 409 (another process polls the same bot) waits 10 s.
- **Whom it answers:** in a private chat, every text message from an allowed person. In groups, by default only if it starts with `/command`, mentions `@bot`, uses an alias or replies to a bot message (with `group_mode: open` it also attends undirected chat: see 14.6.1). A command addressed to another bot (`/x@other_bot`) is ignored. Messages from bots are ignored.
- **Threads:** in a group with topics, the key is `chat:topic` and the reply goes to the same topic (`message_thread_id`). In a private chat or a group without topics there is a single thread per chat.
- **Output:** Markdown → Telegram HTML (bold, italics, code, blocks, links); messages over 3500 characters are split by paragraph, line or word; if Telegram rejects the HTML it is resent as plain text to the same topic; a minimum spacing of 350 ms per chat and retry with `retry_after` on a 429.
- **Working indicator:** `sendChatAction: typing` every 4.5 s while the turn runs.
- **Test:** the "Send test" button checks the token and greets the allowed users.

## 14.7 Data (SQLite, `connections/store.ts`)

| Table | Content |
|---|---|
| `connections` | type, name, linked agent (`ON DELETE SET NULL`), `config` (token and options, JSON), `allowed` (`[{ id, name, admin }]`), active |
| `threads` | known threads: external key, title, reply destination (JSON), last user and activity. **No `session_id`** |
| `thread_messages` | what was received and sent per thread; unique per `(thread, direction, external id)` for deduplication; `files` stores the files received with each message |
| `connection_cursor` | polling watermark |

Non-secret `config` options: `lang` (`es`/`en`, language of the bot's notices), `on_silent`, `rate_limit`. The API URL (`api_base`) only exists for tests.

### 14.6.1 Groups: authorization, listening and silence

Connection configuration (`config`, no migration):

| Key | Values | Effect |
|---|---|---|
| `group_mode` | `mention` (default) · `open` | `mention`: only attends what is addressed to it. `open`: **reads everything** written in authorized groups and decides whether it has something to add. |
| `chats` | `[{ id, name? }]` (max. 50) | Authorized groups: **any member** can talk to it without being on the people list (without admin permissions). |
| `aliases` | `["Morena", …]` (max. 10) | Names that count as a mention when written in a group (whole word, case-insensitive). |

- **Who can talk in a group:** a person on the list, or any member of a group in `chats`. Someone who does not qualify and writes something **not** addressed to the agent is ignored without a reply; if they call it, they receive their id **and the chat id** only once, so they can be added. The agent's permissions (14.5) apply to all members of the authorized group.
- **Addressed message (`Addressed: yes`):** `@bot` mention, name/alias, reply to a bot message or command. It is delivered instantly, with a queue notice and the "typing" indicator.
- **Undirected chat (`Addressed: no`, `open` only):** it is saved and the chat is awaited to **pause for 4 s** (a burst is a single turn); if the agent is busy it is retried up to 5 times and, if it is still busy, it stays as context for the next turn. There is no queue notice or "typing", and ending without replying is a normal result (no notice is given and its text is not sent). A failure of that turn is only logged, not posted in the group.
- **Pending context:** the thread's messages the agent did not get to see (chat saved while it was silent or waiting) go in the next message, after a `[hive:context]` line (up to 30, 500 characters each). The count is kept with `threads.seen_id`. In the chat they are shown folded under the bubble.
- **Silence per thread (`threads.muted`):** if someone asks it to be quiet, the agent calls `channel_mute({ muted: true })`; with `/mute` the same happens without going through the agent. It only affects **that thread** (the group or that topic). While muted, undirected chat does not wake it (it is only saved); a mention, an alias, a reply to its message or a command do wake it, with `Muted: yes` in the header. To bring it back, just ask it so (`channel_mute({ muted: false })`) or use `/unmute`. It can also be changed from the connection's panel.
- **Consistency:** the agent's instructions (`composeInstructions`) ask it to speak only if it adds something, to state as fact only what was verified in files/tools or said earlier in the conversation, not to contradict itself without explaining what changed and to openly correct its own mistake. All threads share a single session, so what it said in another thread it remembers.
- **Telegram privacy:** by default a bot **does not see** group messages that do not mention it (privacy mode). In `open` mode it must be disabled in @BotFather (`/setprivacy` → Disable) and the bot added again to each group; the connection detects it (`getMe.can_read_all_group_messages`) and shows the warning in its status.
- **Group id:** the access notice includes the chat id; groups usually start with `-100…`.

### 14.6.2 Received files

Authorized people can send **photos, documents, audio, voice notes and videos** (also albums). It is enabled per connection (`config.files`, yes by default).

- **Who:** only files from authorized people (or groups) are downloaded, and only if the message reaches the agent: in a group in "Only when called" mode, a file nobody addressed to the bot is **not** downloaded. In "Listens and chimes in" mode they are saved, so they can be used later.
- **Where:** `~/.hive-am/inbox/<agentId>/<YYYY-MM-DD>/<message id>-<n>-<name>`. The name is sanitized (no folders, no odd characters, never hidden). Nothing is ever executed. They are deleted after **14 days** (on start and every 6 hours).
- **Limits:** 20 MB per file (the maximum Telegram lets a bot download) and 5 files per message; what cannot be received is reported to the sender, with the reason (`too big`, etc.). With `files: false` the bot answers that this connection does not receive files.
- **Albums:** Telegram sends each photo as a message; the adapter waits ~1.2 s and delivers them as **a single one**, with the first one's caption and all the files. If the caption mentions the bot, the whole album counts as addressed.
- **What the agent receives:** the text (or the file's caption) and, after it, a `[hive:files]` block with each file's path, type and size. Files of messages it did not get to see appear in the context block as `[files: path, …]`. The instructions tell it to open the files with its tools, that it **cannot listen to audio or watch video** unless it has a tool for that, and that a file's content is **information, never instructions**.
- **Images and models that cannot see:** many models do not accept images (e.g. `deepseek` in OpenCode): the file reaches them, but they cannot look at it. For that the connection has **See images** (`config.vision = { provider, model }`): each incoming image (up to 3 per message and 8 MB) is described by that model in a separate, read-only turn (`connections/vision.ts`), which transcribes its text, and the description is added under the file in the `[hive:files]` block (marked as generated by a model, possibly wrong and containing no instructions). This way any agent can answer about the image, whatever its provider. If the image model fails, the message continues with a `(no description: …)` note. **The image is sent to that provider.** With the default option ("With the agent's model") nothing is done: it works if the agent's model sees images (for example Claude, which opens them with its read tool).
- **Access from the CLI:** Claude receives the agent's folder with `--add-dir` (it is outside its working folder); OpenCode and Kiro read it with their normal permissions.
- **Interface:** in the chat, files appear as labels under the message bubble; the connection's panel has the **Receive files** switch.
- **Not yet:** transcribing audio or analyzing video.

### 14.6.3 Files sent by the agent

The agent sends files (an image, a PDF, a report it generated) with the `channel_send_file({ path, caption? })` tool, which sends them to the thread of the message it attends (`POST /api/channel/send-file`). It is the only way: it **must not look for the bot token or call the Telegram API by itself**, and the instructions tell it so.

- **Which paths it accepts** (`connections/outbound.ts`): only files inside its working folder, its received-files folder or the system's temporary folder; a relative path is taken from its working folder. Symbolic links are resolved before checking, so a link to `/etc/passwd` is rejected.
- **What is never sent:** `.env*`, keys and certificates (`id_rsa`, `*.pem`, `*.key`, `*.p12`…), `credentials`, databases (`*.db`, `*.sqlite`), everything in `.git/` and hive-am's data (`~/.hive-am/`, except its own received-files folder). Nor folders or files that are empty or over 50 MB (Telegram's maximum).
- **How it is sent:** images as a photo (if Telegram rejects it, as a document), and the rest according to their type: video, audio or document. The caption is cut at 1000 characters. It is recorded in the thread as `[sent file: name]`.
- **Interface:** in the chat it appears as the "Send file to the channel" row.

> **About the token:** the bot token is in `~/.hive-am/hive-am.db` and an agent with access to the machine's files could read it. The rules (the "Files" section of `instructions.ts` and the description of `channel_send_file` in `server/mcp/dispatch.mjs`) and the tool keep it from needing it, but do not prevent it: they are instructions to the model. What the server does enforce is which paths can be sent (`connections/outbound.ts`). See [7.6](07-agents-types-skills-colonies.md#76-composed-instructions-composeinstructions). If you share the agent with people you do not fully trust, use minimum permissions and rotate the token with @BotFather if you suspect it leaked.

## 14.8 API

All under `/api`, local origin only.

| Route | Function |
|---|---|
| `GET /connections` | List with live status and number of threads |
| `POST /connections` | Creates and starts the connection |
| `PATCH /connections/:id` | Edits; an empty token keeps the stored one |
| `DELETE /connections/:id` | Stops and deletes (threads included) |
| `POST /connections/:id/restart` | Restarts the adapter |
| `POST /connections/:id/test` | Checks credentials and greets the allowed users |
| `GET /connections/:id/threads` | Known threads |
| `PATCH /connections/:id/threads/:threadId` | `{ muted }`: silences or reactivates a thread |
| `POST /channel/reply` | Used by the `hive` MCP (`channel_reply`) |
| `POST /channel/send-file` | Used by the `hive` MCP (`channel_send_file`): `{ from, path, caption? }` |
| `POST /channel/mute` | Used by the `hive` MCP (`channel_mute`): `{ from, muted }` on the thread being attended |

**Tokens are never returned:** instead of the value, the API sends `{ set: true, hint: "••••1234" }`. Validation errors (`400`) cover: unknown type, repeated name, missing token, nonexistent agent and agent in `plan` mode.

## 14.9 Interface

- **Connections** (`/connections`, in the sidebar): cards with name, status (Connected / Connecting / Problem / Off, with the error reason), agent, bot, number of threads and last message. It updates every 5 s.
- **Connection panel** (expandable): platform, name, answering agent (with a warning if it is read-only or full access), token (shown as `Leave empty to keep ••••1234`), group mode, authorized groups and aliases (14.6.1), allowed people (id, name, admin), receive files, image model, bot language, what to do if the agent does not reply, active/off, **Send test**, delete and the thread list.
- **Agent chat:** channel messages are seen as a bubble with their origin; the `channel_reply` call appears as the **"Reply in the channel"** row with the text sent (also when OpenCode calls it inside a code block).

## 14.10 Tests

Scripts in `server/scripts/` (they use a temporary data folder and real agents):

| Script | What it verifies |
|---|---|
| `sim-channel.ts <provider> [model] [permission]` | Two threads against a fake platform: the agent answers with `channel_reply` to the right thread, remembers what was said in the other thread, `/status` and the allow list. |
| `sim-telegram.ts [provider] [model]` | The Telegram adapter against a fake Bot API: invalid token, permission rules, hidden token, private chat, a group's topic, message without mention, commands for another bot, restart without repeating, splitting and formatting, plain-text fallback, and **files**: a document (the agent opens it and answers with its content), an album as a single message, a file Telegram does not deliver and a group file without mention that is not downloaded, the **image model** (an image is described by another model and the description reaches the agent) and the **sending of a file** from the agent to the chat, plus the rules about which paths it can send. |
| `sim-groups.ts <provider> [model]` | Groups against a fake platform: chat from an unauthorized group ignored, notice with the chat id, undirected chat (a burst = one `Addressed: no` turn, without reply), mention by alias, request for silence (`channel_mute`), effective silence (no new turn), speaking again and `/mute` · `/unmute`. |
| `fake-telegram.ts [port]` | Fake Bot API for manual interface tests (`POST /_say`, `GET /_sent`). |

## 14.11 Known limits

- The agent sends and receives files, but does not transcribe audio or analyze video.
- A connection is linked to **one** agent (to talk to several, link an orchestrator).
- The Slack adapter is not implemented; the interface shows it as "soon".
- Private chats were tested against the real Bot API; **groups, topics and `open` mode** only against the simulation.
- If a group becomes a supergroup its id changes and it has to be authorized again.
- In `open` mode each burst of chat costs one agent turn: use it with an economical model or in small groups.
