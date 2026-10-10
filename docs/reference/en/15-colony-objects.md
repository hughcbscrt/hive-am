# 15. Colony objects

## 15.0 The Objects screen

**Objects** in the left rail opens a screen laid out like an agent's: the list of objects at the left (grouped by colony, with a state dot, searchable, collapsible to icons; **+** creates one) and the selected object on the right, with a header (state and Start / Stop / Restart, *Terminal here* where it applies) and tabs. On the Colony map, selecting a hexagon still shows the small card, now with **Open panel** (and the pencil goes to its settings).

| Kind | Tabs |
|---|---|
| Server, Docker | **Summary** · **Logs** · **Settings** |
| Cluster | **Summary** (members) · **Logs** · **Settings** |
| HTTP requests | **Requests** · **Variables** · **Settings** |

- **Summary:** the state (and for how long it has been running), what it uses (CPU and memory with a short history, processes, network and disk for Docker), its details (command, folder, port, restart policy, health check; or image, ports, network, restart count, limits) and its latest output. A compose project lists its services; a cluster lists its members (15.2c).
- **Logs:** the whole screen. Search with highlighting (or *only matches*), error and warning lines coloured, follow the end (it stops following when you scroll up), wrap lines, text size, pause, clear the view, copy and download. It keeps the last 800 000 characters and draws the last 4 000 lines. For a cluster, each member has its colour and a chip to hide it.
- **Settings:** the same fields as when creating, in place, with a bar that says whether something is unsaved (*Save*, *Discard*, and *Save and restart* when it is running) and *Delete*. Changes to a running object apply when it is restarted.


Besides agents, a colony can hold **objects**: things hive-am keeps running or watches next to them. Four kinds exist: **servers**, **Docker**, **HTTP requests** and **clusters** (called *boss* in the first version: the API still accepts that name, and existing ones were converted). They appear on the Colony map as hexagons (with the kind's colour and a state dot), inside the colony they belong to or free. Click one to see its state, start / stop / restart it and read its logs; the pencil edits it.

Create one with **New object** (top right of the Colony screen): choose the kind, a name, the colony, and the settings below.

## 15.1 Server

A shell command that hive-am keeps running. Besides the fields below, **Keeping it healthy** (see 15.1b) sets what it does by itself.

| Field | Meaning |
|---|---|
| Folder | Absolute path where the command runs. |
| Start command | Run through `sh -c` (e.g. `npm run dev`, `java -jar app.jar`). |
| Stop command (optional) | Run first when stopping (e.g. `docker compose down`). The process is always stopped afterwards. |
| Port (optional) | The object is **Starting** until something listens on `127.0.0.1:<port>`, then **Running**. A process that is alive for two minutes without opening it is shown as an error. |
| Environment variables | `NAME=value`, one per line, added to hive-am's own. |

How it runs: the command starts in its **own process group** with its output going straight to `~/.hive-am/objects/<id>.log`, and the pid and start time are saved in `<id>.json`. So:

- The server **keeps running if hive-am restarts**; afterwards it is found again by that pid and start time (a pid the system reuses for something else is not mistaken for it).
- **Stop** signals the whole group (`sh`, `npm`, `node`…): `SIGTERM` first, and `SIGKILL` if it has not ended after 8 s (`HIVE_AM_OBJECT_STOP_MS`).
- States: **Stopped** (never started, stopped by you, or ended with code 0), **Error** (ended with a non-zero code or by a signal; the detail says which), **Starting**, **Running**.
- A log over 5 MB is set aside as `.log.1` when the object starts.

## 15.1b Keeping a server healthy

| Setting | What it does |
|---|---|
| **If it ends by itself** | *Do nothing* (default), *restart after a failure* (exit code other than 0, or killed by a signal) or *always restart*. Each restart waits longer (1 s, 2 s, 4 s… up to 30 s) and there is a limit (**max restarts**, default 5 in 10 minutes): after that it stays in error and says it **gave up**. Stopping it yourself is never undone, and starting it by hand begins the count again. |
| **Health check** | HTTP (healthy when the URL answers 2xx or 3xx), port (something accepts connections) or command (exits with 0), every N seconds (default 15) with a timeout; after **failures in a row** (default 3) it counts as *unhealthy* and shows as an error with the reason; it is running again when the check passes. Optionally **restart it when it is unhealthy** (one of the automatic restarts, same limit). |
| **Seconds to stop** | How long it has after SIGTERM before it is killed (default 8). |
| **Log size** | At this size (default 5 MB) the old part is copied to `<id>.log.1` and the file starts again, also while it runs. |

The restarts, the health checks and the log trimming happen where the state is checked (every 3 s). Restart counters live in memory: they start over when hive-am restarts.

## 15.2 Docker

Needs the `docker` command. Every value is passed as a separate argument (no shell), and names and mappings are validated (an image or volume that looks like an option is refused).

| Mode | What hive-am does | When the object is deleted |
|---|---|---|
| **Create a container** (image, ports `8080:80`, volumes, variables, restart policy, command) | `docker run -d --name hive-am-<id> --label hive-am.object=<id>`, then `start` / `stop` / `restart` | The container is removed. |
| **Compose project** (file, project name, services) | `docker compose -f file [-p project] up -d / stop / restart` | The project is stopped, **not** removed. |
| **Existing container** (name or id) | Only `start` / `stop` / `restart` and reading its logs | Left as it is. **Never removed.** |

**Limits and network** (a container hive-am creates): memory (`512m`), CPUs, network, log size (`--log-opt max-size`, 3 files) and the time it gets to stop (`--stop-timeout`). They are part of what the container was created with: if you change one, the container is **created again** the next time it starts or restarts (what was inside it is lost, as with any recreate); a container created by an older version is left as it is. For *existing* and *compose* only the stop timeout applies.

State comes from `docker inspect` (running, restarting, exited with a code, unhealthy / health check pending) or, for compose, from `docker compose ps`. A container that is not there is **Stopped** (created ones) or **Unknown** (existing ones).

## 15.2b HTTP requests

A folder of `.http` / `.rest` files in the format of the IntelliJ and VS Code REST clients. Open its screen (see 15.0): the **Requests** tab has the `.http` files on the left (up to 300 files, 4 levels deep) with their requests under each; click a file to see its requests and run it whole, or a request to see it and its answer on the right. State: **Ready** (the folder is there; the detail says how many requests) or **Error**.

- **Format:** `###` separates requests (the text after it is the name, or `# @name x`); `@name = value` defines a variable; the request line is `METHOD URL [HTTP/1.1]`; lines that start with `?` or `&` continue the URL; headers follow until the first blank line; the rest is the body (`< ./file.json` inserts a file next to the `.http`, inside the folder); `> {% … %}` response handlers are ignored.
- **Variables:** `{{name}}` takes its value from the file variables (`@name = value`), then from the selected environment (the env files over the object's own), and `{{$uuid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}` and `{{$randomInt}}` are generated. Environments come from `http-client.env.json` (and `http-client.private.env.json` over it, for secrets) in the folder of the file or any folder above it; `$shared` applies to all. The object can have a default environment.
- **Running:** the server sends the request with `fetch` (60 s timeout, redirects followed, answers over 2 MB are cut, binary answers are described and not printed). A request with a value that cannot be resolved is **not sent**: the runner names the missing `{{variables}}` before you press Run. **Ctrl+Enter** runs the selected request; the list icon of a file runs all of its requests in order, each keeps its last answer, and a dot shows how it went. The answer is shown as Response (JSON formatted), Headers and Request; the echoed request hides the values of `Authorization`, `Cookie`, API-key headers.
- **Limits:** only `http` / `https` URLs; nothing outside the folder is read (a path that leaves it, even through a link, is refused); running a request is only accepted from the local app. HTTP objects have no logs and cannot be started or stopped.

**Variables of the object.** Besides the env files, an HTTP object has its own **Variables** (its tab, and a section of the creation form): environments (`Shared` applies to all) with name / value rows. They are for when there is no `http-client.env.json`, or it lacks something; **an env file wins** when it defines the same variable (the row says so). A variable can be marked **secret**: it is hidden once saved (it shows as *saved*), the API never returns its value, and saving it empty keeps the stored one; type a new value to replace it. Secrets are stored in hive-am's database on this machine, **without encryption**, like the Telegram bot token.

## 15.2c Cluster

Groups servers and Docker containers **of the same colony** (not other clusters, not HTTP objects). **Start all** starts the members in the order they are listed, skipping the ones already up; **Stop all** stops them in the opposite order; **Restart all** does both. One failing does not keep the others from being tried: the failures are reported together. Its state comes from its members: **Running** when all are, **Starting** while one is, **Error** when one failed or only some are up (the detail says which), **Stopped** when none is. Its logs are the logs of the members with `[name]` in front of each line (the cursor is the members' cursors together, so following returns only what is new). On the map it is joined to its members by dashed lines. Deleting a boss leaves its members as they are; deleting a member, or moving it to another colony, takes it out of the bosses.

## 15.3 State, logs and live updates

- A background check runs every 3 s (`HIVE_AM_OBJECT_POLL_MS`) and tells the interface over the WebSocket (`objects_changed`) only when something changed; listing never waits on `docker` or a port.
- **Logs** are read with a *cursor*: the first call returns the last N lines, and each next call returns only what is new (a byte offset for servers, the time of the last line for Docker). The panel asks again every 1.2 s while it is open, strips colour codes, keeps the last 200 000 characters and follows the end unless you scroll up.

## 15.4 API

| Route | What it does |
|---|---|
| `GET /api/objects` | All objects with their state. |
| `POST /api/objects` | `{ name, kind, colony_id?, config }` |
| `PATCH /api/objects/:id` | `{ name?, colony_id?, config? }` (the kind cannot change). |
| `DELETE /api/objects/:id` | Deletes it (see 15.2 for what happens to the container). |
| `POST /api/objects/:id/action` | `{ action: "start" \| "stop" \| "restart" }` |
| `GET /api/objects/:id/logs?tail=&after=` | `{ text, cursor, reset? }` |
| `GET /api/objects/:id/stats` | What a server or Docker object uses now: `{ cpu, memBytes, memLimitBytes, pids, net, block, info, services? }` |

**Security:** objects run commands, so creating, changing, deleting and acting on them are refused when the request does not come from the local app (same rule as the git actions). Reading is open like the rest of the API, which only listens on `127.0.0.1`.

## 15.5 Agents that look after objects

An agent with the **Colony objects** skill (`default-objects`, one of the skills that ship with hive-am) gets three tools: `object_list`, `object_logs` and `object_action` (start, stop, restart). To make one, select an object on the map and press **Create a manager agent** in its panel: it opens the new-agent form with the skill, the colony and *Edit files* permission already set (the same skill can be added to any agent from the skill picker). The panel lists who looks after each object.

The rules are enforced by the server, not just written in the skill:

- An agent sees only the objects of **its own colony**; one with no colony sees the objects that have none. Another colony's object looks like one that does not exist.
- A **read-only** agent can list and read logs but cannot start, stop or restart anything. (Claude blocks every MCP tool in read-only mode anyway.)
- There is **no tool to create, edit or delete** objects, nor to change the command they run: that stays with people.
- Each action an agent takes is written in the server's log (`[hive-am] manager asked to restart`), so you can tell who did what.
- An agent without the skill is refused even if it reaches the tools.

API used by the MCP script: `POST /api/agent-objects/list`, `…/action`, `…/logs` with `{ from: <agent id>, … }`.

## 15.6 Choosing folders and files

Every field that holds a path uses the same picker (`PathPicker` in `web/components/ui.tsx`; `FolderPicker` is its folder mode): the folder of an agent or a colony, the folder of a server, the compose file (file mode: it lists the `.yml` / `.yaml` files) and the host side of a Docker volume (the *Add a folder of this machine* button). You can type the path or press Browse, move through the folders and press **Use this folder** (choosing a file, press the file). `GET /api/fs/dirs?path=&files=yml,yaml` lists folders, and files with those extensions.

## 15.7 Tests

`server/scripts/test-objects.ts`, `test-object-kinds.ts` (HTTP files, environments, variables and secrets, running against a local server, clusters), `test-object-supervision.ts` (restart policies, health checks, log size, stop timeout, Docker limits) and `test-object-tools.ts` (no model; the last goes through the real MCP script and HTTP API): runs real processes (state, port wait, logs by cursor, stop with grace and kill, restart, exit codes, custom stop command, a server started by another process and found again) and real Docker containers named `hive-am-*` from a local image (create, port mapping, label, logs without timestamps, restart, adopt an existing one, compose), plus the input validation. It skips the Docker part if Docker or the image is missing and never touches a container it did not create.

## 15.8 Not there yet

Terminals (a bottom panel) are the next step. Docker objects cannot be created on a remote Docker host, and PM2 is not integrated (a server object keeps its own process).
