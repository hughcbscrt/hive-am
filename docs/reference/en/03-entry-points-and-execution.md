# 3. Entry points and execution

## Requirements

- Node.js 20 or later (tested with 20.19).
- The CLIs you want to use, installed and logged in: `claude`, `opencode`, `kiro-cli`. You do not need all three.
- Developed and tested on Linux. It uses `better-sqlite3` (a native module with prebuilt binaries); on other systems it may need build tools.

## How to start

```bash
npm install          # at the root: installs server and web (workspaces)
npm run dev          # starts server (:4400) and web (:4401) together
```

Open `http://localhost:4401`.

### From npm

Without cloning the repository: `npx hive-am` (or `npm install -g hive-am` and then `hive-am`). It starts the API server (port 4400) and the UI (port 4401, change it with `HIVE_AM_WEB_PORT`) from the published package. The API port is fixed in the packaged build. The launcher also runs it in the background and manages it: `hive-am start --background`, `status`, `logs [-f] [-n N]`, `stop` and `restart` (see [The launcher](#the-launcher-hive-am)). See [Releasing and publishing](#releasing-and-publishing).

### Scripts

| Where | Script | What it does |
|---|---|---|
| root | `npm run dev` | `concurrently` runs `dev` of the server and of the web |
| root | `npm run build` | Builds the web (`next build`) |
| root | `npm run typecheck` | `tsc --noEmit` in server and web |
| `server` | `npm run dev` | `tsx watch src/index.ts` (reloads when code changes) |
| `server` | `npm run start` | `tsx src/index.ts` (no reload) |
| `web` | `npm run dev` | `next dev -p 4401` |
| `web` | `npm run start` | `next start -p 4401` (requires `build`) |

> **Note:** `tsx watch` reloads the server when the code changes. A server started with `npm run start` or with `npx tsx src/index.ts` does **not** reload: restart it to see backend changes.

## Entry points

### 1. Server: `server/src/index.ts`

Startup sequence:

1. `db.ts` is imported: it opens (or creates) `~/.hive-am/hive-am.db`, runs the pending **schema migrations** (`db/migrations.ts`, versioned with `PRAGMA user_version`; see [document 4](04-storage.md)) and **normalizes the state after a blackout** (see below).
2. `skills.seedDefaults()` creates, once each, the skills that ship with hive-am; then `seedIfEmpty()` creates the initial kit only if there are no types, agents or own skills.
3. An `http.createServer` is created whose handler is `handle()` from `api.ts`.
4. A `WebSocketServer` is mounted at the `/ws` path on the same HTTP server.
5. Each WebSocket connection subscribes to the runtime's `bus` and forwards every message as JSON; on close it unsubscribes.
6. `server.listen(API_PORT, '127.0.0.1')` and it prints `hive-am server → http://127.0.0.1:4400` to the console. If the port is taken it says so clearly (`is hive-am already running? (HIVE_AM_PORT changes it)`) and exits with code 1.

`api.ts` is only a facade (about 50 lines, it exports `handle`): the routes live in `http/routes/*.ts`, one file per domain, on top of `http/router.ts`; see [5.2](05-backend-frontend-communication.md#52-rest-api-conventions).

**Orderly shutdown** (end of `index.ts`). On `SIGINT` or `SIGTERM` the server stops taking requests and drops the sockets, closes the WebSockets, ends the terminals, stops the channel connections and closes the database (which merges its write-ahead log), then exits with 0. If a step hangs, it leaves anyway after **5 seconds**. It does **not** stop the servers and containers kept as resources (they outlive hive-am by design) nor the agents' running turns. Stray errors: an `unhandledRejection` is logged and the server keeps serving (it holds terminals and running turns); an `uncaughtException` is logged and the server shuts down with code 1.

**Recovery after a blackout** (at the end of `db.ts`, runs on every start):

```sql
UPDATE agents     SET status='idle'         WHERE status='running';
UPDATE dispatches SET status='interrupted', finished_at=<now>  WHERE status IN ('queued','running');
```

The turn that was in flight is lost, but the native session is intact and the agent is free. Then `armDispatchNotices()` (`dispatches.ts`, next to `armWakeups()` in `index.ts`) tells each orchestrator about its background tasks that ended without being announced, the interrupted ones included ([9.3](09-orchestration-and-relations.md#93-flow-of-a-delegation)).

### 2. MCP server: `server/mcp/dispatch.mjs`

It is not run manually. The CLI itself (Claude or OpenCode) launches it when an orchestrator has connected subagents. It receives two environment variables:

| Variable | Value |
|---|---|
| `HIVE_AGENT_ID` | id of the orchestrator that invokes it |
| `HIVE_AM_API` | `http://127.0.0.1:<port>` of the API |

Details in [document 9](09-orchestration-and-relations.md).

### 3. Frontend: `web/app/layout.tsx` → `components/Shell.tsx`

`layout.tsx` is Next's root component (App Router). It wraps all pages in `<Shell>`, which mounts:

- `HiveProvider` (`lib/store.tsx`): loads agents, types, skills, colonies and providers, and opens the WebSocket.
- `Toaster` (notifications).
- The side navigation bar (six entries; the palette and the shortcuts sheet are shared with the pages through `ShellCommands`, `lib/shellCommands.tsx`).

Each screen is a route under `web/app/`:

| Route | File |
|---|---|
| `/` | `app/page.tsx` (Home) |
| `/colony` | `app/colony/page.tsx` (Colony) |
| `/agents` | `app/agents/page.tsx` |
| `/agents/<id>` | `app/agents/[id]/page.tsx` |
| `/types` | `app/types/page.tsx` |
| `/skills` | `app/skills/page.tsx` |
| `/relations` | `app/relations/page.tsx` |
| `/sessions` | `app/sessions/page.tsx` |

## Ports and environment variables

| Variable | Where it is read | Default | What it is for |
|---|---|---|---|
| `HIVE_AM_PORT` | `server/src/mcp-config.ts` | `4400` | Server port (API + WebSocket). |
| `HIVE_AM_HOME` | `server/src/db.ts` | `~/.hive-am` | Data folder (SQLite database and MCP configurations). |
| `HIVE_AM_API` | `web/next.config.mjs` | `http://127.0.0.1:4400` | Where Next forwards the `/api/*` calls. |
| `NEXT_PUBLIC_HIVE_WS_PORT` | `web/lib/store.tsx` | `4400` | Port the browser's WebSocket connects to (`wss:` if the page is served over https). |
| `HIVE_AM_KILL_GRACE_MS` | `server/src/providers/spawn.ts` | `5000` | How long a CLI that was asked to stop (SIGTERM) has before it is killed with SIGKILL. |
| `HIVE_AM_TELEGRAM_TIMEOUT_MS` | `server/src/connections/telegram.ts` | `30000` | Timeout of each Telegram Bot API call, upload and download. |
| `HIVE_AM_WAKE_RETRY_MS` | `server/src/wake.ts` | `5000` | Wait before retrying the delivery of a wake-up that failed (12 attempts, then it is dropped). |
| `NEXT_DIST_DIR` | `web/next.config.mjs` | `.next` | Next's output folder; lets you run a second instance without overwriting the first. |
| `HIVE_AM_DISPATCH_POLL_S` | `server/mcp/dispatch.mjs` | `25` | How long each `dispatch_status` call of a synchronous `dispatch` waits (1 to 60 s). Tests shorten it. |
| `HIVE_AGENT_ID`, `HIVE_AM_API` | `server/mcp/dispatch.mjs` | — | Set by hive-am when it launches the MCP server (not configured by hand). |

Default ports: **4400** (server) and **4401** (web).

### Running a second instance (testing)

Useful to test without touching your data or your instance in use:

```bash
# test server with an isolated database (from the root)
HIVE_AM_PORT=4410 HIVE_AM_HOME=/tmp/hive-test npm run start -w server

# test web pointing at that server, with its own build folder (from web/)
cd web
NEXT_DIST_DIR=.next-test HIVE_AM_API=http://127.0.0.1:4410 NEXT_PUBLIC_HIVE_WS_PORT=4410 \
  npx next dev -p 4411
```

## What runs when you send a message

Summary of the processes involved:

```
browser ──HTTP──▶ Next (4401) ──proxy──▶ server (4400)
                                              │
                                              ├─ spawn: claude | opencode | kiro-cli   (one process per turn)
                                              │        └─ (if orchestrator) node mcp/dispatch.mjs  ──HTTP──▶ server (4400)
                                              └─ history reading (the CLI's files / SQLite)
```

An orchestrator that delegates causes, in turn, another `spawn` (the subagent's) inside the same server.

## Releasing and publishing

The repository has a `Makefile` for the two release tasks (`make help` lists them):

**1) Release: ask for the changes, bump versions, update the changelog, commit, tag and push**

```bash
make changelog-add TYPE=Added MSG="What you added"   # any time: queue an entry under "Unreleased"
make release-preview BUMP=minor     # shows the new version and the changelog entry, changes nothing
make release BUMP=minor             # patch (default) | minor | major | an exact version such as BUMP=1.0.0
```

`CHANGELOG.md` follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/): an "Unreleased" section on top, then one section per version, with the changes grouped as **Added, Changed, Deprecated, Removed, Fixed** and **Security**, and comparison links at the bottom. It is written in English; if the file's headings are in Spanish, it stays in Spanish.

`make release` (it runs `scripts/release.mjs`) requires a clean working tree on `main`, with everything pushed, and does this in order:

1. **Asks for the changes.** If "Unreleased" already has entries it shows them and asks whether to add more; if it is empty it lists the commits since the last tag as a reference and asks for the entries type by type (one per line, an empty line moves to the next type). With no terminal and no entries it stops instead of publishing an empty release.
2. Shows the new section and asks for confirmation (`YES=1` skips the questions).
3. Type-checks, bumps `version` in the root, `server` and `web` packages (and `package-lock.json`) and moves the "Unreleased" entries to the new version with today's date.
4. Commits `release vX.Y.Z`, creates the annotated tag `vX.Y.Z` and pushes the branch **and the tag**. `PUSH=0` commits and tags without pushing; `ALLOW_BRANCH=1` allows releasing from another branch.

**2) Publish to npm**

```bash
npm login                           # once
make npm-pack                       # builds dist/npm and lists what would be published
make npm-publish                    # builds and publishes (NPM_TAG=next for a pre-release tag)
```

`make npm-build` assembles the package in `dist/npm` (git-ignored): the server compiled to JavaScript (`server/dist`), the MCP script, the built web UI (`web/.next`), the `hive-am` launcher (`bin/hive-am.mjs`) and a `package.json` with only the runtime dependencies. `make npm-publish` first checks that you are logged in to npm, that this version is not already published and that `HEAD` is the release tag `vX.Y.Z` with a clean tree (`FORCE=1` skips the last check).

**From a GitHub release.** `.github/workflows/npm-publish.yml` does the same in GitHub Actions when a release is published: it checks out the release tag, checks that it is `v` plus the version in `package.json`, skips if that version is already on npm, and runs `npm ci`, `npm run typecheck`, `npm run npm:build` and `npm publish` from `dist/npm` with provenance. A release marked as pre-release goes out with the npm tag `next`, any other with `latest`. It can also be started by hand from the Actions tab with a tag. It authenticates with npm trusted publishing (configured on npmjs.com for this repository and workflow file) or, if that is not set up, with an `NPM_TOKEN` repository secret.

Once published, `npx hive-am` (or `npm install -g hive-am` and `hive-am`) starts the server and the UI. **Limitation of the packaged build:** the API always uses port 4400 (the UI is built to talk to it); only the UI port can change, with `HIVE_AM_WEB_PORT`.

### The launcher (`hive-am`)

`bin/hive-am.mjs` is the package's entry point. Plain `hive-am` (or `hive-am start`) runs the app in the terminal, as always. It also remembers the run and offers:

| Command | What it does | Exit |
|---|---|---|
| `hive-am start --background` | Starts the launcher again, detached and in its own process group, with the output of both processes in `run/hive-am.log`, and returns once the run is recorded. Closing the terminal does not stop it. | 0, or 1 when it did not start |
| `hive-am status` | `running (pid, since, mode)` with whether the web and API ports answer; `not running`; or a stale record. | 0 running, 1 not |
| `hive-am logs [-f] [-n 200]` | The last lines of the log, or the same following it. A foreground run has no log file and says so. | 0 |
| `hive-am stop` | Signals the launcher, which stops the server and the web UI and waits for them (the server closes its database on the way out); after 15 s it forces the group. | 0 stopped, 1 nothing to stop |
| `hive-am restart` | `stop` then `start` in the same mode (in the background when nothing was recorded). | 0 |
| `hive-am update [--check] [--restart]` | Asks npm (`npm view hive-am version`) for the latest version and, when it is newer, runs `npm install -g hive-am@<that version>`. `--check` only reports. If a run is going it says it still runs the old version, and `--restart` restarts it on the new files. It only installs when this copy was installed globally with npm: through `npx` it points to `npx hive-am@latest`, and a source checkout to `git pull`. | 0, 1 when it cannot update |
| `hive-am version` | Prints the version (so does `--version`). | 0 |

Every run opens with a welcome (the version, the web and API addresses, the data folder and how to stop it), which is the first thing in the log of a background run, and its record keeps the version, which `status` shows.

What it keeps is in `<HIVE_AM_HOME>/run/`: `hive-am.json` (pid, the process start time, the mode, the ports and the log path; written by both modes and removed when the app stops) and `hive-am.log`, rotated to `hive-am.log.1` over 10 MB when the launcher starts and every minute while it runs in the background (a few lines written during the rotation can be lost). The pid is never trusted alone: every command checks the start time, a record whose process is gone or now belongs to another one is reported as stale and never signalled, and a second `start` refuses and names the one that is running (it also refuses when something else holds a port). The launcher imports nothing from the server, so it works with the app down and the data folder missing. Terminals still end with the app; resources and containers still outlive it.

Test-only knobs, read by the launcher: `HIVE_AM_LAUNCHER_CHILDREN` (replaces the two processes with `[[command, ...args], [command, ...args]]`) `HIVE_AM_LAUNCHER_API_PORT` (the API port it checks and prints; the packaged UI always uses 4400), `HIVE_AM_NPM` (the npm program `update` runs) and `HIVE_AM_LAUNCHER_INSTALL` (forces how this copy counts as installed: `global`, `npx`, `source`).
