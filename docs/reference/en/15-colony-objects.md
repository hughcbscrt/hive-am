# 15. Colony objects

Besides agents, a colony can hold **objects**: things hive-am keeps running or watches next to them. Two kinds exist today: **servers** and **Docker**. They appear on the Colony map as hexagons (with the kind's colour and a state dot), inside the colony they belong to or free. Click one to see its state, start / stop / restart it and read its logs; the pencil edits it.

Create one with **New object** (top right of the Colony screen): choose the kind, a name, the colony, and the settings below.

## 15.1 Server

A shell command that hive-am keeps running.

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

## 15.2 Docker

Needs the `docker` command. Every value is passed as a separate argument (no shell), and names and mappings are validated (an image or volume that looks like an option is refused).

| Mode | What hive-am does | When the object is deleted |
|---|---|---|
| **Create a container** (image, ports `8080:80`, volumes, variables, restart policy, command) | `docker run -d --name hive-am-<id> --label hive-am.object=<id>`, then `start` / `stop` / `restart` | The container is removed. |
| **Compose project** (file, project name, services) | `docker compose -f file [-p project] up -d / stop / restart` | The project is stopped, **not** removed. |
| **Existing container** (name or id) | Only `start` / `stop` / `restart` and reading its logs | Left as it is. **Never removed.** |

State comes from `docker inspect` (running, restarting, exited with a code, unhealthy / health check pending) or, for compose, from `docker compose ps`. A container that is not there is **Stopped** (created ones) or **Unknown** (existing ones).

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

`server/scripts/test-objects.ts` and `test-object-tools.ts` (no model; the second goes through the real MCP script and HTTP API): runs real processes (state, port wait, logs by cursor, stop with grace and kill, restart, exit codes, custom stop command, a server started by another process and found again) and real Docker containers named `hive-am-*` from a local image (create, port mapping, label, logs without timestamps, restart, adopt an existing one, compose), plus the input validation. It skips the Docker part if Docker or the image is missing and never touches a container it did not create.

## 15.8 Not there yet

Terminals (a bottom panel), the HTTP-requests object and the *boss* object that groups others are the next steps. Docker objects cannot be created on a remote Docker host, and PM2 is not integrated (a server object keeps its own process).
