# 12. Operations, security, limits and troubleshooting

## 12.1 Security

hive-am is meant as a **local, single-user tool**. It is worth knowing its reach:

| Aspect | Current state |
|---|---|
| Network | The server listens only on `127.0.0.1` (not reachable from other machines). The Next server (`next dev`/`next start`) can show a local network address; the `/api` proxy makes the API reachable from there, even though the backend is local. |
| Authentication | **None.** Anyone who can reach `/api` can create agents and send them messages. |
| CORS | `Access-Control-Allow-Origin: *`. Any page you open in your browser could make requests to `http://127.0.0.1:4400`. Since the API can run agents with access to your machine, **do not browse untrusted sites while hive-am is running** or restrict the origin (see improvements). |
| What an agent can do | What its permission and the CLI allow: `bypassPermissions` runs any command without asking; `acceptEdits` edits files freely. Use them in trusted folders. |
| Folder explorer | `GET /api/fs/dirs` lists subfolders of any readable path. |
| Changes explorer (git) | Reads write nothing; actions (commit, pull, push, branches) never force or skip *hooks* and reject requests that do not come from the app itself. Everything is limited to the agent's folder; it rejects paths outside it (also through symlinks) and any path with `.git`. Details in [document 13](13-changes-explorer-git.md#135-security). |
| Secrets | The CLIs use their own session. The only credential hive-am stores is each external connection's **bot token**, in `~/.hive-am/hive-am.db`: the API never returns it (only `{ set, hint }`). The database also contains your prompts, skills and each agent's notebook in plain text; the notebook rejects credentials ([7.3.2](07-agents-types-skills-colonies.md#732-the-agents-notebook)). |
| Files sent | The agent only sends through the `channel_send_file` tool, which rejects paths outside its working folder, credentials, keys, databases and hive-am data ([14.6.3](14-external-connections.md#1463-files-sent-by-the-agent)). The bot token is still readable by an agent with file access (it is in the database): it does not need it, but it is not prevented from reading it. |
| Files received | They are saved in `~/.hive-am/inbox/` (14 days, 20 MB each, never executed) only if they come from authorized people. If the connection uses an image model, each image is sent to that provider. Their content may try to give instructions to the agent: the instructions tell it to treat it as data, but it is wise to give matching permissions. |
| External connections | They only answer people on the list (or members of an authorized group); an agent with a connection needs at least "Edit files" and authorizing a group gives that access to all its members ([document 14](14-external-connections.md#145-permissions)). |
| History readers | They validate session ids (Claude: `^[\w-]+$`; Kiro: UUID) and open OpenCode's database read-only. |

### Recommended security improvements (not implemented)

- Restrict `Access-Control-Allow-Origin` to the web's origin (`http://localhost:4401`) and reject other `Origin`s.
- A shared access token between Next (proxy) and the server.
- Verify the `Host` header to avoid *DNS rebinding*.

## 12.2 Known limitations

| # | Limitation | Detail |
|---|---|---|
| 1 | **Kiro uses a generated profile** | It writes `~/.kiro/agents/hive-<agentId>.json` for each Kiro agent that has hive tools (subagents, channels, notebook, on-demand skills) or the "Edit files" permission. It is rewritten on every turn and stays there when the agent is deleted. |
| 2 | **Permissions in Kiro and OpenCode** | The three levels are applied in the three providers (checked with `sim-readonly.ts`). In Claude, "Edit files" lets only file commands through; in OpenCode and Kiro it blocks all commands. In "Edit files" all three protect `.git` and keys, do not leave the agent's folder and can edit `.env`. Kiro needs its own profile for that (see 6.5). |
| 3 | **System prompt in OpenCode/Kiro (and Claude on resume)** | It travels inside the message (preamble), not as the CLI's system instruction. Claude only applies `--append-system-prompt` when the session is created, so an instruction update in a resumed session also goes in the message. It is hidden in the interface, but the model sees it as part of the message. |
| 4 | **Turn in flight during a blackout** | The half-done turn is lost; the session stays intact and the agent returns to `idle` on restart. The message has to be resent. |
| 5 | **Agent `PATCH` validates the effective folder after saving** | If you leave the agent without an effective folder, the change was already saved when the error is returned. |
| 6 | **History reading without cache** | `GET /api/sessions` and `…/stats` read whole files on every call; they can be slow with huge sessions. |
| 7 | **Delegation without a time limit** | `POST /api/dispatch` waits indefinitely; if the worker hangs, the orchestrator keeps waiting. You can use *Stop* on the worker. |
| 8 | **`Stop` does not empty the queue** | It aborts the turn in progress; messages already queued continue. |
| 9 | **One turn at a time per agent** | It includes delegations: a busy worker makes the orchestrator wait. |
| 10 | **Estimated costs** | For Claude, list prices per family are used; unknown models have no cost. Values marked with `≈` are approximate. |
| 11 | **Fixed context window** | The statistics bar uses 200,000 tokens as a reference when the CLI does not report the %. |
| 12 | **Claude's internal subagents** | The `.jsonl` `isSidechain` lines are not shown in the chat. |
| 13 | **Kiro tool format** | Best-effort mapping of `toolUse`/`ToolResults` (there are no stored examples to validate it). |
| 14 | **OpenCode model list** | It depends on `opencode models`; if it does not return `provider/model` lines, the list stays empty (you can type the id by hand). |
| 15 | **No automated tests** | There is no test suite; new features are verified with simulations with real agents (`server/scripts/sim-*.ts`, see 12.4). |
| 16 | **Duplicated types** | `server/src/types.ts` and `web/lib/types.ts` are maintained by hand. |
| 17 | **Moving agents between colonies** | It is done with selectors and lists; there is no drag and drop on the honeycomb. |
| 18 | **`type_id` is informational** | Editing a type does not update agents already created. |
| 19 | **Language flicker** | On the first load the base English is briefly visible before the saved language is applied. |
| 21 | **Changes explorer** | Tree trimmed to 30,000 files ([document 13](13-changes-explorer-git.md#137-known-limits)). |
| 20 | **Untranslated content** | Names/descriptions created by you or by the seed, the instructions agents receive and the CLIs' raw errors are shown as they come (see [document 11](11-frontend.md#118-internationalization-i18n)). |

## 12.3 Troubleshooting

| Symptom | Probable cause | What to do |
|---|---|---|
| Sidebar says "Server offline — retrying" | The server is not running, or is on another port | `npm run dev` / check `HIVE_AM_PORT` and `NEXT_PUBLIC_HIVE_WS_PORT` |
| `EADDRINUSE` when starting the server | Another instance is already on the port | Stop it (`lsof -ti :4400`) or use another `HIVE_AM_PORT` |
| I changed backend code and it is not noticeable | Server started without `tsx watch` | Restart it (`npm run dev` reloads by itself) |
| "Internal Server Error" in Next / `_document` or `_app` module error | `.next` folder corrupted or shared between two development servers | Stop `next dev`, delete `web/.next` and restart. For a second instance use `NEXT_DIST_DIR` |
| The provider shows "not found" | The binary is not in the server's `PATH` | Install the CLI or start the server from an environment where `claude`/`opencode`/`kiro-cli` are accessible |
| The turn fails with `<cli> exited with code N: …` | The CLI failed (expired session, invalid model, no credits…) | Read the stderr text shown in the red banner; try the command by hand |
| "This agent has no working folder…" | No own folder and no colony that lends one | Choose a folder on the agent or on its colony |
| "Folder does not exist: …" | The path does not exist (`~` is not expanded) | Use an absolute path or the **Browse** button |
| An OpenCode agent says it works in another folder | Old sessions recorded with the server's folder | Already fixed (`PWD`); those sessions are replaced by a new one on the next message |
| An orchestrator does not delegate | No connected subagents, or the model decided not to | Connect workers (Relations/Team); ask explicitly "delegate with dispatch to *name*" |
| The orchestrator does not see new agents | Old instructions in the session | They are now resent when the team changes; if it persists, *New conversation* |
| The history is empty | The CLI changed its file format, or the session was deleted in the CLI | Check the corresponding reader in `server/src/history/` and the native file |
| The cost does not appear | Model outside the known families and the CLI does not report cost | Expected |
| Typing in the chat is slow | Very long chats with a huge number of open tools | Collapse tools (**Collapse all tools**); in production (`next build` + `next start`) it is noticeably faster than `next dev` |
| `better-sqlite3` fails to install | No prebuilt binary for your Node/OS | Use Node 20 LTS or install build tools |
| Fonts look generic | No network on the first build | Connect and restart `next dev`; the app works the same with system fonts |

## 12.4 How to verify changes (without automated tests)

1. **Types:** `npm run typecheck` at the root.
2. **Web build:** `npm run build`.
3. **Backend smoke test** with an isolated instance:

   ```bash
   HIVE_AM_PORT=4410 HIVE_AM_HOME=/tmp/hive-test npm run start -w server
   curl -s localhost:4410/api/health            # {"ok":true}
   curl -s localhost:4410/api/agents            # list (the seed does not create agents, only types and skills)
   ```
4. **Real turn:** create an agent pointing at a test folder and send it a message:

   ```bash
   curl -s -XPOST localhost:4410/api/agents -H 'content-type: application/json' \
     -d '{"name":"test","role":"worker","provider":"claude","model":"haiku","cwd":"/tmp/test"}'
   curl -s -XPOST localhost:4410/api/agents/<id>/messages -H 'content-type: application/json' -d '{"prompt":"hello"}'
   curl -s localhost:4410/api/agents/<id>/history
   ```
5. **Interface:** bring up the test web with `NEXT_DIST_DIR` and `HIVE_AM_API` pointing at that instance ([document 3](03-entry-points-and-execution.md#running-a-second-instance-testing)).
6. **Simulations with real agents** (`server/scripts/`, each with a temporary data folder and its own port; they spend tokens of the provider you choose):

   ```bash
   cd server
   HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4420 npx tsx scripts/sim-channel.ts   claude haiku   # two threads, a single session
   HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4421 npx tsx scripts/sim-telegram.ts  claude haiku   # adapter against a fake Bot API
   HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4422 npx tsx scripts/sim-groups.ts    claude haiku   # groups: chat, silence, /mute
   HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4423 npx tsx scripts/sim-notebook.ts  claude haiku   # the agent's notebook
   HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4424 npx tsx scripts/sim-skills.ts    claude haiku   # always / on-demand skills
   HIVE_AM_HOME=$(mktemp -d) HIVE_AM_PORT=4431 npx tsx scripts/sim-readonly.ts  opencode opencode-go/deepseek-v4.1-flash   # the three permissions: read-only / edit / full access
   ```
   With Kiro the model must be given (`auto`, `claude-haiku-4.5`…): the OpenCode models some scripts use by default do not exist there and the CLI ends with code 1.

   The provider (`claude`, `opencode`, `kiro`) is the first argument; all of them end with `ALL PASSED` or `N FAILED`.
7. **Delegation:** create an orchestrator (Claude or OpenCode), connect a worker to it and ask it to delegate; check the row in `GET /api/dispatches`, the delegation session in `GET /api/agents/<worker>/sessions` and that the worker's direct chat did not change.

## 12.5 Data maintenance

- **Backup:** copy the whole `~/.hive-am/` with the server stopped (because of WAL mode, `hive-am.db-wal` and `-shm` also exist).
- **Reset everything:** stop the server and delete `~/.hive-am/`. It is recreated with the seed. Conversations are **not** lost: they are in the CLIs' stores.
- **Migrations:** they are additive and automatic on start (`ALTER TABLE … ADD COLUMN`). A database created with any earlier version of the project updates itself.
- **Moving the data:** `HIVE_AM_HOME` variable.

## 12.6 Version control

The repository uses the `main` branch. The git identity is configured **only in this repository** (not globally). `.gitignore` excludes dependencies, build outputs, logs and `.env` files.

## 12.7 Design decisions and their reason

| Decision | Reason |
|---|---|
| One process per turn instead of resident processes | Trivial recovery after crashes; no orphan processes to manage |
| Read the native history instead of storing it | Nothing to sync or summarize; the session can also be opened with the CLI |
| No ACP as the main protocol | Each CLI already offers line-delimited JSON output and resume by id; fewer pieces |
| New session per delegation | The worker's direct chat stays clean and the task is auditable separately |
| Per-field inheritance with a per-agent exception | Flexibility without losing individual control |
| Provider and model never inherited | Avoids surprises in cost and compatibility between CLIs |
| Synchronous SQLite (`better-sqlite3`) | A single process, simple queries, zero infrastructure |
| A single global CSS with tokens | Full control of the visual identity and light/dark theme with few variables |
| Own HTTP router | 36 routes; avoids a framework dependency |
