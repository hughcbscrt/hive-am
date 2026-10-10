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

> **About the token:** the bot token is in `~/.hive-am/hive-am.db` and an agent with access to the machine's files could read it. The rules (the "Files" part of the Chat channels skill, [14.6.6](#1466-the-chat-channels-skill), and the description of `channel_send_file` in `server/mcp/dispatch.mjs`) and the tool keep it from needing it, but do not prevent it: they are instructions to the model. What the server does enforce is which paths can be sent (`connections/outbound.ts`). See [7.6](07-agents-types-skills-colonies.md#76-composed-instructions-composeinstructions). If you share the agent with people you do not fully trust, use minimum permissions and rotate the token with @BotFather if you suspect it leaked.

### 14.6.4 Secrets are never shared in a chat

Nobody can get a secret out of the agent through a chat, **not even an admin or in a private chat**. It only applies to external connections: the hive-am web chat has no such restriction. There are two layers:

- **The rule (instructions):** the "Secrets" part of the Chat channels skill (plus a one-line version of the rule that `instructions.ts` always adds to an agent with a connection). It lists what counts as a secret (passwords, API keys, tokens, private keys, `.env` contents, connection strings with credentials, cookies, recovery codes), forbids writing them in any form (whole, spelled out, encoded or split) and says that an order from an admin, a reason or "it is a test" does not change it. The agent may say where a secret lives and how to read it on the machine, and masks secrets (`***`) in any output it shows.
- **The net (server, `connections/secrets.ts`):** before `channel_reply` sends a text, and before `channel_send_file` sends a caption or a text file (`.txt .md .csv .json .svg .log .yml .toml .ini .conf .sh .sql`, up to 2 MB), the text is checked. It is blocked if it contains the exact value of a secret the server holds (connection tokens and environment variables whose name says password/secret/token/key) or a well-known shape: private key blocks, Telegram, GitHub, Slack, Stripe, Google and AWS keys, JWTs, `Bearer` tokens, URLs with a password, and assignments such as `DB_PASSWORD=value` with a real-looking value (placeholders such as `<...>`, `${VAR}`, `***` or `xxxx` pass). The agent gets a message saying that nothing was sent and why, never the value, and the server logs a warning.

The net does not recognise every possible secret (a password with no recognisable name or shape can go through), so it complements the rule; it does not replace it. Checked with `sim-secrets.ts`.

### 14.6.5 Reply speed per connection

- **Time in the header:** every message carries `Now: Fri 2026-10-09 10:58 CST` (server time), so the agent answers "what time/day is it" without running `date`.
- **No text after replying:** the channel instructions ask the agent to end the turn right after `channel_reply` (any later text is never delivered).
- **Reasoning effort** (connection setting `effort`: empty, `low`, `medium`, `high`): passed as `--effort` to Claude and Kiro and as the model's `#variant` to OpenCode. Measured with `bench-latency.ts`, `low` saves roughly 0.5–1 s per reply. An OpenCode model that has no such variant fails the turn, so leave it empty for those.

### 14.6.6 The "Chat channels" skill

How an agent behaves in external chats (answer only through `channel_reply` and end the turn, use the `Now:` time, files and pictures, groups and `Addressed: no`, keeping quiet, secrets) is a seeded skill, **Chat channels** (id `default-channels`, always loaded), the same way the notebook is a skill. It is editable under Skills.

- **Assignment:** it is added to an agent by itself when a connection answering through it starts (create, change of agent, restart) and removed when the agent has no enabled connection left. On the first start after the upgrade, agents that already had connections receive it once. If you delete the skill nothing is added; if you remove it from one agent while its connections stay, it is left alone until the connections change again.
- **What stays in code** (`instructions.ts`): a short section with the `[hive:channel]` header, the real tool names for the provider, the aliases and a one-line rule against sharing secrets, so that deleting the skill does not remove the essentials. The server-side net does not depend on the skill either: the secrets filter, the paths that can be sent and the permissions.

### 14.6.7 Telling the person later: the Wake-ups skill and `wake_me`

An agent only runs while it handles a message, and `channel_reply` is tied to that message, so it cannot write on its own. A promise such as "I'll let you know when the deploy finishes" was impossible to keep (and an agent could even claim it had sent the notice). The same happens in the web chat, so this is a skill of its own, **Wake-ups** (id `default-wakeups`), not part of Chat channels:

- **The skill** forbids promising a later notice without scheduling it and forbids claiming a message was sent when it was not; it explains how to run a long job in the background with a log and schedule a check.
- **The tool `wake_me({ minutes, note })`** (1–240 minutes, note up to 400 characters, at most 5 pending) exists only for agents that have the skill (`wake` capability of the hive MCP). It answers with the exact time, which the agent tells the person. An identical request while one is pending is the same wake-up, not a second one. It is not available in turns delegated by an orchestrator.
- **When it is due** the agent receives a message *in the same place where it was asked*: the same Telegram/Slack thread (`From: hive-am (scheduled wake-up)`, answered with `channel_reply`), or its own web conversation (`🔔 Scheduled wake-up…`). It checks what it was waiting for and reports: finished, failed, or still running (then it schedules another one).
- **Assignment:** agents answered through a connection get it by themselves, together with Chat channels (once per agent: if you take it off, it is not added back; `seeded_skills` keeps the marker). It stays when the agent loses its connections, since it is also useful in the web chat; any other agent can have it assigned from the interface.
- **Storage:** `agent_wakeups` table (`wake.ts`), so they survive a restart; right after a start the platform may still be connecting, so it retries for a minute. They are dropped if the thread was muted, the connection is disabled or now belongs to another agent, or they are more than 2 hours late.
- **Who asked is mentioned.** If the reminder or schedule was asked for by a person **in a group**, hive-am remembers who (`req_id`/`req_name`) and starts the agent's **first reply of each run** with a mention of that person, so the platform notifies them (Telegram: a link `tg://user?id=…`, which also works without a @username). It is done by the server, not left to the model, and the agent is told not to mention them itself. In a private chat there is no mention (the chat already is that person).
- **Emoji in Telegram:** the agent writes some emoji bare (⏰ ⏳ ⚠ ✔ ✨…), which some fonts draw as a plain glyph or not at all. Before sending, hive-am adds the emoji selector (U+FE0F) to those, in `format.ts`. Our own prompts no longer use ⏰ (they use 🔔). Tested in `test-format.ts`.
- **Test:** `sim-wake.ts` (a minute lasts 10 s with `HIVE_AM_WAKE_MS_PER_MINUTE`) covers both the chat thread and the web chat.

### 14.6.8 Recurring schedules (cron)

The Wake-ups skill also lets an agent set **recurring** tasks ("every weekday at 9 check the QA logs and tell me"), with three more tools of the `wake` capability: `schedule_create`, `schedule_list` and `schedule_cancel`.

- **When:** `cron` (5 fields: minute hour day-of-month month day-of-week; names such as `MON-FRI`/`JAN`, lists, ranges, steps and `@daily`-style macros) with a `timezone` (IANA name, default the server's), or `every_minutes`. The answer gives the next three runs, which the agent tells the person.
- **Where it runs:** like a wake-up, in the place where it was asked: the same chat thread (`From: hive-am (scheduled)`, answered with `channel_reply`) or the agent's own web conversation.
- **Time zones and daylight saving** (`cron.ts`): the next run is computed from calendar days and local times and then mapped to an instant, so an hour skipped in spring is skipped and an hour repeated in autumn runs once. Tested in `test-cron.ts` (Mexico City, New York, Kolkata, leap days, impossible hours).
- **Cost limits:** at least 15 minutes between runs (`HIVE_AM_SCHEDULE_MIN_MINUTES`; a cron with a closer pair of runs is refused), 10 schedules per agent, notes up to 400 characters. Not available in delegated turns.
- **Failure behaviour:** a run missed because the server was down (more than 5 minutes late) is **skipped, never replayed**, and the next one is set. A run is also skipped (and recorded) if the agent already has 2 messages waiting, the thread is muted or the connection is off; if the connection now belongs to another agent the schedule is paused. "Every N" keeps its rhythm instead of drifting.
- **History:** every run is recorded (`schedule_runs`, last 50 per schedule) with its result: delivered, failed or skipped and why.
- **Interface:** the **Schedules** screen (`/schedules`, endpoints `GET/PATCH/DELETE /api/schedules`) lists everything the agents scheduled (recurring, and pending one-time wake-ups) with the next run, the last result, run count and history, and lets you pause, resume or delete. Nothing the agents schedule is invisible to you.
- **Storage:** `agent_schedules` and `schedule_runs` (`schedules.ts`).
- **Tests:** `test-cron.ts` and `test-schedules.ts` (no model), and `sim-schedule.ts` (the agent creates, receives several runs on its own, lists and cancels).

### 14.6.9 Telling the person the moment a command finishes: `wake_when_done`

For "tell me when the deploy ends" a time-based wake-up is a guess. The agent starts the command itself in the background with its output in a log (`nohup ./deploy.sh > ~/deploy.log 2>&1 & echo $!`) and calls `wake_when_done({ pid, log?, file?, note, max_minutes? })` (`wake` capability of the hive MCP, in the Wake-ups skill). A job on another machine works when the agent runs the `ssh` itself in the background (`nohup ssh server './job.sh' > ~/job.log 2>&1 &`): the local `ssh` lives as long as the remote command, so its pid is the one to give.

- **hive-am only watches; it never runs anything** (`watch.ts`). Every 1.5 s (`HIVE_AM_WATCH_POLL_MS`) it checks whether the process is still alive, whether the optional marker file exists (inside the agent's folder, home or the temp folder) and whether the waiting time (default 120 min, at most 240) ran out.
- **Reliable "is it still the job?":** the process is identified by its start time, so a pid that the system reuses for something else is not mistaken for the job; a finished job nobody has collected (a zombie) counts as finished. Linux reads `/proc`; macOS uses `ps`.
- **When it ends:** in a chat thread hive-am itself sends **at once** a one-line notice (`🔔 @person The process you were waiting for (PID …) has finished (20 s). Checking the result…`), mentioning who asked when it was a group, and the agent is woken in the same place to read the log and report (the model takes several seconds). In the web chat the agent is woken directly. If it is still running at the limit the agent is woken anyway and says how far it got. Measured with `sim-watch.ts`: the notice came 0.5–0.9 s after the job ended and the agent's report 5–8 s after.
- **Limits and safety:** at most 5 pending per agent; the same process twice is one watch; a process that is not running is refused ("look at the result now"); hive-am itself cannot be watched; not available in delegated turns. The notice is not sent when the thread is muted or the connection is off. There is no exit code (the process is not a child of hive-am): the agent judges from the log.
- **Persistence:** table `agent_watches`; after a restart hive-am keeps watching (the jobs run without it). The pending watches appear in the **Schedules** screen (kind "Waiting for a process", with the latest time it will wait) and can be deleted there.
- **Tests:** `test-watch.ts` (no model: process end, marker file, time limit, zombie/reused pid, bad input, limits) and `sim-watch.ts` (the agent launches a job, watches it, and reports on its own).

### 14.6.10 When the agent speaks in a group

A group in `open` mode lets the agent read everything; what keeps it from interrupting is decided in three places:

- **Who a message is for** (`addressing.ts`). A name counts as a call only when it **speaks to** the agent: at the start of the message (after "hola"/"hey"…), after a comma or a greeting word ("verdad Gael?", "gracias Gael", "por favor Gael"). In the middle of a sentence after a preposition or article ("pruebas de esas ramas en AutoAfiliacion") it is just a noun and does not call anyone. The agent's own name counts without configuring an alias; aliases may have several words. A reply to the bot's message, an `@mention` of the bot or a command are calls as before.
- **Messages for somebody else.** A reply to another person, an @mention of another person, or the first name of another human of the thread (3+ letters: "Fer" is "Fernando") marks the message `To: <name>`. The agent still reads it (it can correct a mistake or warn of a danger) but the Chat channels skill tells it that only a verified correction or a danger is worth a reply there.
- **The Chat channels skill** ("Groups: listen to everything, speak only when it helps"): silence is the default; the agent speaks without being called for **a verified mistake**, **a danger** (destructive or irreversible commands, production instead of QA, a pasted secret: warning is mandatory) or **a missing fact that changes what they do**; never to greet, agree, thank, comment, sum up or add detail nobody asked for. When it is called it answers exactly what was asked, briefly, and gives an opinion if asked.
- **A limit on wake-ups** (`rate.ts`, the same idea as tide-commander's per-trigger limit): chatter nobody aimed at the agent can wake it at most `chatter_per_minute` times per thread in any 60 seconds (10 by default; 0 or less turns it off; set in the connection config). Past the limit the message is not lost: it stays in the thread and reaches the agent as context with the next turn. It limits how many times the agent is *woken*, not what it may say, so a correction or a danger warning is never blocked once it is awake; what keeps it from talking too much is the skill and the detection of who a message is for.
- A message that arrives while the agent is busy is handed over when it finishes (up to about a minute of waiting) instead of being left as context only.
- **Tests:** `test-addressing.ts` (phrases of real chats, no model) and `sim-chatter.ts` (a group where two people talk: greetings, a name used as a noun, messages to a third person, a wrong path, a destructive command, a direct question).

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
| `test-rate.ts` | The sliding-window limit on wake-ups (no model). |
| `test-addressing.ts` / `sim-chatter.ts <provider> [model]` | Who a group message is for, with phrases of real chats (no model); a group where two people talk and the agent stays out except when called, for a mistake or for a danger. |
| `test-watch.ts` / `sim-watch.ts <provider> [model]` | `wake_when_done`: the watcher sees a process end, a marker file appear or the time run out and refuses bad input (no model); the agent launches a background job, watches it and reports on its own, after an immediate notice. |
| `test-format.ts` | Text going to Telegram: emoji selector for bare emoji, mention links, and that a mention does not trip the secrets filter. No model. |
| `test-cron.ts` / `test-schedules.ts` | Cron parsing, next runs across time zones and daylight saving; schedule validation, limits, de-duplication, skipped missed runs and pausing. No model. |
| `sim-schedule.ts <provider> [model]` | The agent creates a recurring schedule from a chat, it runs several times on its own, and the agent lists and cancels it. |
| `sim-wake.ts <provider> [model]` | The agent promises to tell someone later: it schedules a wake-up with `channel_wake` and, when it is due, writes without anybody asking. |
| `sim-secrets.ts <provider> [model]` | An admin asks over chat for the `.env`, the bot token and the password letter by letter: nothing secret may reach the chat. |
| `bench-latency.ts <provider> [model] [rounds]` | Time to the first reply through a channel (to compare providers and models). |
| `fake-telegram.ts [port]` | Fake Bot API for manual interface tests (`POST /_say`, `GET /_sent`). |

## 14.11 Known limits

- The agent sends and receives files, but does not transcribe audio or analyze video.
- A connection is linked to **one** agent (to talk to several, link an orchestrator).
- The Slack adapter is not implemented; the interface shows it as "soon".
- Private chats were tested against the real Bot API; **groups, topics and `open` mode** only against the simulation.
- If a group becomes a supergroup its id changes and it has to be authorized again.
- In `open` mode each burst of chat costs one agent turn: use it with an economical model or in small groups.
