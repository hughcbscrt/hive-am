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

1. `db.ts` is imported: it opens (or creates) `~/.hive-am/hive-am.db`, creates the tables, applies migrations and **normalizes the state after a blackout** (see below).
2. `skills.seedDefaults()` creates, once each, the skills that ship with hive-am; then `seedIfEmpty()` creates the initial kit only if there are no types, agents or own skills.
3. An `http.createServer` is created whose handler is `handle()` from `api.ts`.
4. A `WebSocketServer` is mounted at the `/ws` path on the same HTTP server.
5. Each WebSocket connection subscribes to the runtime's `bus` and forwards every message as JSON; on close it unsubscribes.
6. `server.listen(API_PORT, '127.0.0.1')` and it prints `hive-am server → http://127.0.0.1:4400` to the console.

**Recovery after a blackout** (at the end of `db.ts`, runs on every start):

```sql
UPDATE agents     SET status='idle'         WHERE status='running';
UPDATE dispatches SET status='interrupted'  WHERE status='running';
```

The turn that was in flight is lost, but the native session is intact and the agent is free.

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
- The side navigation bar.

Each screen is a route under `web/app/`:

| Route | File |
|---|---|
| `/` | `app/page.tsx` (Colony) |
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
| `NEXT_PUBLIC_HIVE_WS_PORT` | `web/lib/store.tsx` | `4400` | Port the browser's WebSocket connects to. |
| `NEXT_DIST_DIR` | `web/next.config.mjs` | `.next` | Next's output folder; lets you run a second instance without overwriting the first. |
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

Once published, `npx hive-am` (or `npm install -g hive-am` and `hive-am`) starts the server and the UI. **Limitation of the packaged build:** the API always uses port 4400 (the UI is built to talk to it); only the UI port can change, with `HIVE_AM_WEB_PORT`.
