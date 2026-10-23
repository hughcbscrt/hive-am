# 15. Colony resources

> **Naming.** They were called *objects* until 1.1. In the app they are **resources** and the screen lives at `/resources` (`/objects` still redirects). The API (`/api/objects…`), the data folder (`~/.hive-am/objects`), the agent tools (`object_list`, `object_logs`, `object_action`) and the skill id (`default-objects`) keep the old name so nothing that uses them breaks.

## 15.0 The Resources screen

**Resources** in the left rail opens a screen laid out like an agent's: the list of resources at the left (grouped by colony, with a state dot, searchable, collapsible to icons; **+** creates one) and the selected resource on the right, with a header (state and Start / Stop / Restart, *Terminal here* where it applies) and tabs (the open tab is in the URL, `?tab=`, so a link opens it). Recreating a resource, clearing an HTTP history and forgetting an HTTP session ask for confirmation first. On the Colony map, selecting a hexagon still shows the small card, now with **Open panel** (and the pencil goes to its settings).

| Kind | Tabs |
|---|---|
| Server, Docker | **Summary** · **Logs** · **Settings** |
| Cluster | **Summary** (members) · **Logs** · **Settings** |
| HTTP requests | **Requests** · **Variables** · **Settings** |

- **Layout:** each tab uses the whole width and height of the screen: the latest output of the Summary grows to fill what is left, Logs fill the screen, and Settings flow into as many columns of cards as fit (*General*, *How it runs*, *Environment*, *Keeping it healthy*… one column in the creation drawer). State details the server writes in English ("2/3 running", "exited with code 3") are shown in the language of the interface.
- **Summary:** the state (and for how long it has been running), what it uses (CPU and memory with a short history, processes, network and disk for Docker), its details (command, folder, port, restart policy, health check; or image, ports, network, restart count, limits) and its latest output. A compose project lists its services; a cluster lists its members (15.2c).
- **Logs:** the whole screen. Search with highlighting (or *only matches*), error and warning lines coloured, follow the end (it stops following when you scroll up), wrap lines, text size, pause, clear the view, copy and download. It keeps the last 800 000 characters and draws the last 4 000 lines. For a cluster, each member has its colour and a chip to hide it.
- **Settings:** the same fields as when creating, in place, with a bar that says whether something is unsaved (*Save*, *Discard*, and *Save and restart* when it is running) and *Delete*. Changes to a running resource apply when it is restarted.


Besides agents, a colony can hold **resources**: things hive-am keeps running or watches next to them. Four kinds exist: **servers**, **Docker**, **HTTP requests** and **clusters** (called *boss* in the first version: the API still accepts that name, and existing ones were converted). They appear on the Colony map as hexagons (with the kind's colour and a state dot), inside the colony they belong to or free. Click one to see its state, start / stop / restart it and read its logs; the pencil edits it.

Create one with **New resource** (top right of the Colony screen): choose the kind, a name, the colony, and the settings below.

## 15.1 Server

A shell command that hive-am keeps running. Besides the fields below, **Keeping it healthy** (see 15.1b) sets what it does by itself.

| Field | Meaning |
|---|---|
| Folder | Absolute path where the command runs. |
| Start command | Run through `sh -c` (e.g. `npm run dev`, `java -jar app.jar`). |
| Stop command (optional) | Run first when stopping (e.g. `docker compose down`). The process is always stopped afterwards. |
| Port (optional) | The resource is **Starting** until something listens on `127.0.0.1:<port>`, then **Running**. A process that is alive for two minutes without opening it is shown as an error. |
| Environment variables | `NAME=value`, one per line, added to hive-am's own. |

How it runs: the command starts in its **own process group** with its output going straight to `~/.hive-am/objects/<id>.log`, and the pid and start time are saved in `<id>.json`. So:

- The server **keeps running if hive-am restarts**; afterwards it is found again by that pid and start time (a pid the system reuses for something else is not mistaken for it).
- **Stop** signals the whole group (`sh`, `npm`, `node`…): `SIGTERM` first, and `SIGKILL` if it has not ended after 8 s (`HIVE_AM_OBJECT_STOP_MS`).
- States: **Stopped** (never started, stopped by you, or ended with code 0), **Error** (ended with a non-zero code or by a signal; the detail says which), **Starting**, **Running**.
- A log over 5 MB is set aside as `.log.1` when the resource starts.

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

| Mode | What hive-am does | When the resource is deleted |
|---|---|---|
| **Create a container** (image, ports `8080:80`, volumes, variables, restart policy, command) | `docker run -d --name hive-am-<id> --label hive-am.object=<id>`, then `start` / `stop` / `restart` | The container is removed. |
| **Compose project** (file, project name, services) | `docker compose -f file [-p project] up -d / stop / restart` | The project is stopped, **not** removed. |
| **Existing container** (name or id) | Only `start` / `stop` / `restart` and reading its logs | Left as it is. **Never removed.** |

**Limits** (a container hive-am creates), and the **Network** card: memory (`512m`), CPUs, network, log size (`--log-opt max-size`, 3 files) and the time it gets to stop (`--stop-timeout`). They are part of what the container was created with: if you change one, the container is **created again** the next time it starts or restarts (what was inside it is lost, as with any recreate); a container created by an older version is left as it is. For *existing* and *compose* only the stop timeout applies.

State comes from `docker inspect` (running, restarting, exited with a code, unhealthy / health check pending) or, for compose, from `docker compose ps`. A container that is not there is **Stopped** (created ones) or **Unknown** (existing ones).

## 15.2b HTTP requests

A folder of `.http` / `.rest` files in the format of the IntelliJ and VS Code REST clients. Open its screen (see 15.0): the **Requests** tab has the `.http` files on the left (up to 300 files, 4 levels deep) with their requests under each; click a file to see its requests and run it whole, or a request to see it and its answer on the right. State: **Ready** (the folder is there; the detail says how many requests) or **Error**.

- **Format:** `###` separates requests (the text after it is the name, or `# @name x`); `@name = value` defines a variable; the request line is `METHOD URL [HTTP/1.1]`; lines that start with `?` or `&` continue the URL; headers follow until the first blank line; the rest is the body (`< ./file.json` inserts a file next to the `.http`, inside the folder); `> {% … %}` response handlers are ignored.
- **Variables:** `{{name}}` takes its value from the selected environment (the env files over the resource's own), and if the environment has none, from the file variables (`@name = value`), and `{{$uuid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}` and `{{$randomInt}}` are generated. Environments come from `http-client.env.json` (and `http-client.private.env.json` over it, for secrets) in the folder of the file or any folder above it; `$shared` applies to all. The resource can have a default environment.
- **Running:** the server sends the request with `fetch` (60 s timeout, redirects followed, answers over 2 MB are cut, binary answers are described and not printed). A request with a value that cannot be resolved is **not sent**: the runner names the missing `{{variables}}` before you press Run. **Ctrl+Enter** runs the selected request; the list icon of a file runs all of its requests in order, each keeps its last answer, and a dot shows how it went. The answer is shown as Response (JSON formatted), Headers and Request; the echoed request hides the values of `Authorization`, `Cookie`, API-key headers.
- **Limits:** only `http` / `https` URLs; nothing outside the folder is read (a path that leaves it, even through a link, is refused); running a request is only accepted from the local app. HTTP resources have no logs and cannot be started or stopped.

**Variables of the resource.** Besides the env files, an HTTP resource has its own **Variables** (its tab, and a section of the creation form): a page that explains how they work, **All environments** (values that apply whichever environment you pick) and one tab per environment (`dev`, `qa`…, which only apply when that environment is picked; when a value is missing there, the one from *All environments* is used), each with name / value rows. A panel lists **the variables your files use** (read from the `{{…}}` of every request) and, for each, whether it is defined here, in *All environments*, by an env file, by an `@name` line, or **missing**: click a missing one to add it. The name field suggests those names while you type. They are for when there is no `http-client.env.json`, or it lacks something; **an env file wins** when it defines the same variable (the row says so). A variable can be marked **secret**: it is hidden once saved (it shows as *saved*), the API never returns its value, and saving it empty keeps the stored one; type a new value to replace it. Secrets are stored in hive-am's database on this machine, **without encryption**, like the Telegram bot token.

### Chaining requests: response handlers and the session

A request can keep values from its answer for the next ones, or check the answer; the `.http` file says how, as in the IntelliJ and VS Code clients.

- **Handlers** (`> {% … %}` after the body, or on one line): run after the answer. `client.global.set("token", response.body.token)` keeps a value (usable as `{{token}}` from then on); `client.global.get`, `clear(name)` and `clearAll()` read and forget; `client.test("name", function () { client.assert(response.status === 200, "message"); })` checks the answer (each test is shown as passed or failed, with its message); `client.log(...)` writes to the Console. `response.status`, `response.body` (the parsed JSON, or the text), `response.headers.valueOf("X-Name")` and `response.contentType.mimeType` are available. The Requests screen shows a key icon on requests that have a handler, a **Tests** tab (`2/3`), a *Kept: token* chip and a coloured dot in the list (red when the status is an error, a test failed or the handler could not run).
- **References to answers:** a request with a name (`### login` or `# @name login`, one word) can be used by the next ones: `{{login.response.body.$.token}}` (or `.token`, `.items[0].id`), `{{login.response.headers.X-Session}}`, `{{login.response.status}}`, `{{login.response.body.*}}` (the whole text). A request that uses the answer of one that has not been run yet says so and offers to run it first.
- **Order and sequence:** the list icon of a file runs its requests in order, so each one finds what the one before kept; *Stop at the first failure* ends the run at the first error, error status, failed test or handler that could not run.
- **The session:** what handlers keep, and the last answer of each named request, live in memory per HTTP resource (a **Session** panel at the bottom of the left column): look at the values, set one by hand, forget one or all. They end when hive-am stops. **They win** over environments, the resource's variables and `@name` lines, because something set them on purpose and later. The Variables tab shows which variables a request's handler keeps (*kept by the answer of “login”*), so they do not count as missing.
- **No JavaScript is executed.** The handler is read by a small parser and run by a small interpreter that knows only what such handlers need: values, `response`, `client`, `JSON.parse` / `stringify`, `Math.floor` / `round` / `min` / `max`, `String` / `Number` / `parseInt` / `parseFloat`, `var` / `let` / `const`, `if` / `else`, arrow functions and `function` expressions (for `map`, `filter`, `find`, `some`, `every` and for `client.test`), comparisons, `&&`, `||`, `??`, `? :`, `+` (numbers and text), template strings, and a short list of string methods (`includes`, `startsWith`, `endsWith`, `indexOf`, `toLowerCase`, `toUpperCase`, `trim`, `split`, `slice`, `substring`, `replace`) and array methods (`includes`, `indexOf`, `join`, `slice`, `map`, `filter`, `find`, `some`, `every`). There is no `require`, `process`, `fetch`, `eval`, `new`, loops, `try`, `await` or access to prototypes (`constructor`, `__proto__`…), and a handler may only do a limited amount of work, so a `.http` file from someone else cannot run code on your machine. A handler that uses something outside of that is **not run** and the answer says what is not supported (the request itself was already sent). A handler *file* (`> ./checks.js`) is not run either: write the handler inside the `.http` file.
- **API:** `GET /api/objects/:id/http/session` (`{ globals, responses }`), `POST …/http/session` (`{ name, value }`), `DELETE …/http/session[?name=]`; the run answer adds `tests`, `logs`, `set`, `scriptError`, `scriptFile`.

## 15.2c Cluster

Groups servers and Docker containers **of the same colony** (not other clusters, not HTTP resources). **Start all** starts the members in the order they are listed, skipping the ones already up; **Stop all** stops them in the opposite order; **Restart all** does both. One failing does not keep the others from being tried: the failures are reported together. Its state comes from its members: **Running** when all are, **Starting** while one is, **Error** when one failed or only some are up (the detail says which), **Stopped** when none is. Its logs are the logs of the members with `[name]` in front of each line (the cursor is the members' cursors together, so following returns only what is new). On the map it is joined to its members by dashed lines. Deleting a boss leaves its members as they are; deleting a member, or moving it to another colony, takes it out of the bosses.

## 15.2d Suggestions from Docker and from the files

The forms ask Docker (read-only) so you do not have to type what already exists:

- **Image** (create a container): the images on this machine, with their size, age and how many containers use them; anything else can still be typed (it will be pulled).
- **Network** (create a container): the networks of this machine, with their driver and how many containers use them (Docker's own, `bridge`, `host` and `none`, first); any name can be typed.
- **Volumes** (create a container): one row each, with its source (a volume of this machine, with how many containers mount it, or a folder picked with the folder button), the path inside the container and **Read only**. A name that is not a volume yet is allowed (Docker creates it on the first start) and the row says so. The rows edit the same `volumes` list as before (`source:target[:options]`, other options such as `z` are kept), so a resource saved earlier shows as rows unchanged; a line the rows cannot show is kept as typed. Anonymous volumes (a 64-character name) are not offered.
- **Existing container:** the containers on this machine, with their image and state; the ones hive-am created are marked. A refresh button reloads the list.
- **Compose project:** once the file is chosen, its **services** appear as chips to pick (none picked = all of them) and the project name is suggested from the folder. They come from `docker compose config --services`; when Docker cannot read the file (a variable without a value, for instance) they are read from the file itself and it says so.
- If Docker is not available the lists are empty and the form says why (once); you can always type.
- How many containers use an image, a volume or a network comes from `docker ps -a --no-trunc` (its `Image`, `Mounts` and `Networks`; without `--no-trunc` Docker cuts the mounts). An image counts the containers whose `Image` is its reference (`nginx` and `nginx:latest` are the same); a container created from a tag that moved since is not counted. A folder whose path has a comma is not told apart from two mounts.

API: `GET /api/docker/containers` (each with `mounts` and `networks`), `GET /api/docker/images` (each with `inUse`), `GET /api/docker/volumes` (`{ available, error?, volumes: [{ name, driver, anonymous, managed, inUse }] }`), `GET /api/docker/networks` (`{ available, error?, networks: [{ name, id, driver, scope, builtin, managed, inUse }] }`), `GET /api/docker/compose-services?file=`. The volume and network lists are local app only with the Host pinned, like inspect. `managed` means the label `hive-am.created=1`. Read-only: they run only `docker ps`, `images`, `volume ls` and `network ls`.

## 15.3 State, logs and live updates

- A background check runs every 3 s (`HIVE_AM_OBJECT_POLL_MS`) and tells the interface over the WebSocket (`objects_changed`) only when something changed; listing never waits on `docker` or a port.
- **Logs** are read with a *cursor*: the first call returns the last N lines, and each next call returns only what is new (a byte offset for servers, the time of the last line for Docker). The panel asks again every 1.2 s while it is open, strips colour codes, keeps the last 200 000 characters and follows the end unless you scroll up.

## 15.4 API

| Route | What it does |
|---|---|
| `GET /api/objects` | All resources with their state. |
| `POST /api/objects` | `{ name, kind, colony_id?, config }` |
| `PATCH /api/objects/:id` | `{ name?, colony_id?, config? }` (the kind cannot change). |
| `DELETE /api/objects/:id` | Deletes it (see 15.2 for what happens to the container). |
| `POST /api/objects/:id/action` | `{ action: "start" \| "stop" \| "restart" }` |
| `GET /api/objects/:id/logs?tail=&after=` | `{ text, cursor, reset? }` |
| `GET /api/objects/:id/inspect?service=` | Docker only (a compose resource needs `service`). Always `configured` (what hive-am has for it); with `exists: true`, what `docker inspect` says plus `cfgStale`; with `exists: false`, `reason` (`not-created`, `not-found`, `no-service`, `no-docker`). Local app only. |
| `GET /api/objects/:id/inspect/raw?service=&reveal=1` | The whole `docker inspect` of its container (or of one compose service) as indented JSON: `{ available, error?, text, masked }`. Local app only. |
| `GET /api/docker/inspect?kind=&ref=&reveal=1` | The same for anything on this machine: `kind` is `container`, `image`, `volume` or `network`; `ref` must be a valid name (one that starts with `-` is refused with 400). `available: false` when Docker is not available. Local app only. |
| `POST /api/agent-objects/db/:op` | The tools of the Database management skill (see 15.12): `{ from: <agent id>, name?, … }`. |
| `GET /api/objects/:id/stats` | What a server or Docker resource uses now: `{ cpu, memBytes, memLimitBytes, pids, net, block, info, services? }` |

**Security:** resources run commands, so creating, changing, deleting and acting on them are refused when the request does not come from the local app (same rule as the git actions). Reading is open like the rest of the API, which only listens on `127.0.0.1`, except **Inspect**, which carries the container's variables in the clear and is local app only too.

## 15.5 Agents that look after resources

An agent with the **Colony resources** skill (`default-objects`, one of the skills that ship with hive-am) gets three tools: `object_list`, `object_logs` and `object_action` (start, stop, restart). To make one, select an resource on the map and press **Create a manager agent** in its panel: it opens the new-agent form with the skill, the colony and *Edit files* permission already set (the same skill can be added to any agent from the skill picker). The panel lists who looks after each resource.

**Choosing the manager.** A server, a Docker container, a cluster or a database can have **one manager agent**, chosen by searching the agents: in the resource's form (creating and editing), from its card on the colony map (*Add manager agent*, next to *Create manager agent*), or from an agent's form (*Resources it looks after*, which takes several). With a manager chosen, only that agent sees the resource in `object_list` and can act on it, even if it belongs to another colony; with none, the agents of its colony that have the skill do. Choosing an agent that lacks the skill gives it the skill; choosing a resource that another agent looks after moves it. API: `PUT /api/objects/:id/manager` with `{ agent_id }` (`null` clears it) and `PUT /api/agents/:id/resources` with `{ object_ids }` (local app only; both return `skillAdded`).

The rules are enforced by the server, not just written in the skill:

- An agent sees only the resources of **its own colony**; one with no colony sees the resources that have none. Another colony's resource looks like one that does not exist.
- A **read-only** agent can list and read logs but cannot start, stop or restart anything. (Claude blocks every MCP tool in read-only mode anyway.)
- There is **no tool to create, edit or delete** servers, containers, HTTP resources or clusters, nor to change the command they run: that stays with people. Databases are the one exception, with their own skill (15.12).
- Each action an agent takes is written in the server's log (`[hive-am] manager asked to restart`), so you can tell who did what.
- An agent without the skill is refused even if it reaches the tools.

API used by the MCP script: `POST /api/agent-objects/list`, `…/action`, `…/logs` with `{ from: <agent id>, … }`.

## 15.6 Choosing folders and files

Every field that holds a path uses the same picker (`PathPicker` in `web/components/ui.tsx`; `FolderPicker` is its folder mode): the folder of an agent or a colony, the folder of a server, the compose file (file mode: it lists the `.yml` / `.yaml` files) and the host side of a Docker volume (the *Add a folder of this machine* button). You can type the path or press Browse, move through the folders and press **Use this folder** (choosing a file, press the file). `GET /api/fs/dirs?path=&files=yml,yaml` lists folders, and files with those extensions.

## 15.7 Tests

`server/scripts/test-objects.ts`, `test-object-kinds.ts` (HTTP files, environments, variables and secrets, handlers and chains, running against a local server, clusters), `test-http-script.ts` (the handler interpreter and everything it refuses), `test-object-supervision.ts` (restart policies, health checks, log size, stop timeout, Docker limits) and `test-object-tools.ts` (no model; the last goes through the real MCP script and HTTP API): runs real processes (state, port wait, logs by cursor, stop with grace and kill, restart, exit codes, custom stop command, a server started by another process and found again) and real Docker containers named `hive-am-*` from a local image (create, port mapping, label, logs without timestamps, restart, adopt an existing one, compose, the lists of containers, images, volumes and networks with a volume, a network and a container `hive-am-test-*` it creates and removes), plus the input validation; the listings are also checked against a fake `docker` command that records every call (only read-only commands) and with no `docker` at all. It skips the real Docker part if Docker or the image is missing and never touches a container it did not create. `test-web-docker.ts` (no server) checks the volume rows of the form (`web/lib/dockerVolumes.ts`): a saved list shows as rows and comes back the same.

## 15.8 Not there yet

Docker resources cannot be created on a remote Docker host, and PM2 is not integrated: a server resource runs its command in its own process group and survives a restart of hive-am (see 15.1), but hive-am's supervisor (automatic restarts, health checks) only works while hive-am is running.

## 15.9 Seeing the values

The runner shows what each variable is worth right now, not only its name:

- **Variables tab of a file or request**: each variable with its current value, where it comes from (session, `@` in the file, env file, hive-am, answer of another request, generated on each run, or missing), what it hides when something weaker defines it too, and how often it is used. A missing one that comes from a named request offers to run it. The pencil sets a value for the session (it wins over everything until forgotten); secrets are masked and the ones stored in hive-am are never sent to the browser.
- **Request tab**: the request as it will be sent, with missing values marked; after a run, what was actually sent.
- **File tab**: the `.http` source with a ▶ per request, `{{variables}}` coloured by origin (hover for the value) and an editor (Ctrl+S) that saves the file on disk (existing `.http` / `.rest` files only, up to 1 MB).
- **Answers** as a foldable JSON tree; each value copies its reference (`{{name.response.body.$.path}}`) when the request has a name. The Session panel lists remembered answers with their data.
- **History tab**: the last 100 runs (newest first, kept on disk, so they survive a restart) with their answer; **Compare with…** shows the differences with the previous run of the request or any other: status, time, size, headers and a line diff of the answer; the session values live there too, and a value added there goes to the `default` environment.

API: `GET /api/objects/:id/http/variables?file=&index=&env=`, `GET|PUT /api/objects/:id/http/file`.
- **Copy as…**: next to Run, copies the request as cURL, wget, HTTPie, PowerShell, fetch, axios, Python, Go, PHP, Java, C#, Ruby, Rust or a raw HTTP message, with the values in effect now; what has no value stays as `{{name}}` and credential headers can be hidden. API: `GET /api/objects/:id/http/export?file=&index=&format=&env=&redact=1`.
- **New request**: the **+** next to the environment adds a request to a file (or a new `.http` file) from a form or from a pasted cURL command. `Authorization: Basic user password` is sent encoded. API: `POST /api/objects/:id/http/file` creates a file and never overwrites one.
- **Suggestions in the editor**: variables inside `{{ }}` (with their value), answers of named requests, generated values, methods, header names and common Content-Type / Accept values. Ctrl+Space opens them; arrows and Enter or Tab accept.
- **Authentication** tab: pick Bearer, Basic or API key (values can be `{{variables}}`) and it is written into the request as the header it means, for one request or for all of the file.
- **Checks** (Tests tab): status, time, a header, a value of the JSON (`$.data.id`) or a text, with a condition. They are saved in the file as a response handler (the first line carries them so they can be edited again) and every run reports each one. Handlers can also read `response.time` and `response.text`.
- **Filter the answer**: a box over the answer takes a text (shows the matching lines) or a JSONPath (`$.items[*].id`, `$..id`, `$.list[?(@.price > 10)]`, `[-1]`).
- **Export**: documentation in Markdown (with an example answer from the history) or a Postman v2.1 collection, for one file or all of them. API: `GET /api/objects/:id/http/docs?format=markdown|postman&file=`.
- **Run with data…** (file view): paste or load a CSV (names in the first line) or a JSON array of objects. The file runs once per row, the columns are variables for that row (they win over everything and are forgotten at the end) and a table shows each request in each row. Up to 200 rows.
- The **File** tab uses the same editor and theme picker as the code explorer (themes, visible whitespace, tab width — one setting for both), with highlighting for `.http` / `.rest` files.

## 15.10 Services and members

A compose resource lists its **services** like Docker Desktop: state (with health), image, published ports (they open in the browser), CPU and memory, and start / stop / restart / logs for each one without touching the others. A cluster lists its **members** as a tree: state, what each runs, CPU and memory, and under a compose member its services; the order arrows set the start order. API: `POST /api/objects/:id/service {service, action}` (only from this machine).

Each service has **Inspect** (how it runs, variables (secrets stay hidden until you show them), ports, mounts, networks, health checks, labels), a **shell** inside its container, **Create again** (removes the container and creates it from its image; what is inside is lost) and **Build again** (builds the image and creates the container). The whole resource has **Create again** / **Build again** too, in **More**. An existing container is never removed, so it cannot be created again from here.

**Inspect** is in **More** for a container hive-am creates and for an existing one, and in the menu of each compose service. It has two panels. **Configured in hive-am** is always there: for a container hive-am creates, its settings (name, image, ports, volumes, network, variables, restart policy, command, limits); for an existing one, its name; for a compose service, what `docker compose config --format json` says about it (only the name, with the reason, when the file cannot be read). **What Docker says** is the detail of `docker inspect` (a stopped container is inspected too, without the shell button), with its **Labels** grouped as hive-am's (`hive-am.*`), compose's (`com.docker.compose.*`) and the rest. When Docker has no container, the second panel is replaced by why: not created yet (hive-am creates it on the first start), not found (an existing container that is not there), a compose service never started, or Docker not available (not installed or not running: one notice, not an error). When the `hive-am.cfg` label of a container hive-am created differs from its current settings, Inspect says it will be created again on the next start.

When Docker has the container, Inspect has two tabs: **Summary** (the panels above) and **Raw JSON**, the whole `docker inspect` with the code explorer's highlighting, line numbers, theme and whitespace settings (past 15 000 characters it is highlighted in a Web Worker, and only the rows on screen are drawn). A box finds text and jumps from match to match (Enter, Shift+Enter, or the arrows). The server hides the value of every variable in `Config.Env` whose name looks like a secret (`pass`, `secret`, `token`, `api_key`, `auth`, `credential`, `private`) and, in the other variables, the password of any URL with credentials (`postgres://user:password@host/db` shows as `postgres://user:••••••••@host/db`), and says how many variables it touched; **Reveal** asks for them again in the clear. **Copy JSON** copies exactly what is shown. Only variables are hidden: labels, the command and other fields can carry secrets too and are shown as they are. The Summary tab hides the same values in the browser until **Reveal**. The three inspect routes are local app only with the Host pinned, like terminals: a page that reached hive-am through another name (DNS rebinding) gets 403. Each compose service has the same view from its **Inspect**.

**App templates.** Creating a Docker resource, **From a template** lists ready-made services (Redis, Valkey, PostgreSQL, MariaDB, MySQL, MongoDB, RabbitMQ, MinIO, Nginx, Mailpit, Adminer). Fill the few values (version, ports, user, password — a random password is suggested) and hive-am writes `docker-compose.yml` under its data folder (`stacks/<name>/`) and creates a compose resource, which you start when you want (the first start downloads the images). You can edit the file later. API: `GET /api/object-templates`, `POST /api/objects/from-template {template, name, values, colony_id}`.

## 15.11 Databases

A **database** resource is *used*, not started: hive-am opens a connection when it is asked something (its state, the schema, a query) and closes it right after, so nothing stays connected. Four engines: **MySQL / MariaDB**, **PostgreSQL**, **SQLite** and **SQL Server**.

- **Creating one.** Pick *Database*, then the engine on its tile. You can paste a **connection URL** (`postgresql://user:pass@host:5432/app?sslmode=require`, `mysql://…`, `mssql://…`, `sqlite:///path/app.db`) and the fields are filled in (what the URL says about SSL too, and any query parameter that is a driver property of that engine goes to the properties); or fill host, port, user, password and the database that opens by default; for SQLite, the file. **Test connection** works before saving, with what the form says. The name can stay empty: it is taken from the database and the engine. The password stays on the server: the interface receives it empty, and saving with it empty keeps the saved one.
- **SSL / TLS.** *Use SSL* encrypts the connection; the certificate of the server is checked unless *accept a self-signed certificate* is on (encrypted, not verified). For a server signed by a private authority, or one that asks the client to identify itself, give the files of the **CA certificate**, the **client certificate** and the **client key** (`.pem`, absolute paths, read each time it connects; a missing file says which one). Other TLS options (`ssl.minVersion`, `ssl.ciphers`, `ssl.servername`) are in the driver properties.
- **Driver properties.** The settings have a table of the options of the driver that opens the connection. Only the ones the Node driver (`mysql2`, `pg`, `tedious` through `mssql`, `better-sqlite3`) really takes are listed, under the name the driver gives them, with a description: so every row has an effect. For instance: MySQL `charset`, `timezone`, `connectTimeout`, `compress`; PostgreSQL `application_name`, `search_path`, `lock_timeout`, `keepAlive`; SQL Server `appName`, `instanceName`, `readOnlyIntent`, `packetSize`; SQLite `timeout`, `foreign_keys`, `cache_size`. Each has the right control (number, true/false, a list). What hive-am decides itself (host, port, credentials, read-only, the row limit, the query timeout, the format of results, `multipleStatements`) is not in the list, so it cannot be overridden. The list comes from the server (`GET /api/object-db/props`, in English and Spanish): a driver update that adds an option only needs one row in `server/src/objects/driver-props.ts`.
- **State.** `ready` with the version and how long the connection took (asked at most every 15 s), or an error with the reason (the password is never in the message). It has no start, stop or logs.
- **Queries tab.** An SQL editor with the same theme picker as the file explorer. **Ctrl/⌘ + Enter** runs it; a selection runs on its own. The result is a table (sticky header, `NULL` marked, numbers to the right, 500 rows at a time) that you can copy as CSV or JSON or download. **Save query** keeps it under a name (*Saved* menu).
- **Writing queries.** Tables, schemas, columns and SQL keywords are suggested while you type (after a table name or alias and a dot you get its columns; **Ctrl+Space** asks for them, Tab or Enter accepts). **Format** (Alt+Shift+F) tidies the query, or only the selected text, with the dialect of the engine. A query picked from the **History** or the saved ones is added at the end of the editor and left selected, so what you wrote stays and Ctrl/⌘ + Enter runs just it. In **History**, each saved query can be renamed, replaced with the text in the editor, or deleted (the *Saved* menu has a shortcut: *Manage saved queries…*).
- **Schema tab.** The databases of the server (to switch), the tables and views grouped by schema (with an estimate of rows where the engine gives one), and the columns of the one you pick: type, null, key, default. Double click, or **See the first rows**, writes `SELECT … LIMIT 100` (`TOP 100` on SQL Server) with the engine's own quoting.
- **History tab.** The last 200 queries (text, outcome, rows or error, time) and the saved ones, kept on disk; click one to bring it back to the editor.
- **Limits.** A result never holds more than **1000 rows** (1–10000 in the settings): the query is cut as soon as there is one more, so `SELECT * FROM huge` costs the same, and the screen says it was cut. A query that takes longer than **30 s** (1–600) is stopped (SQLite runs in a process of its own that is killed at the timeout: a query that never ends neither freezes hive-am nor goes on using a core).
- **Read-only (the default).** Only one statement that reads is accepted (`SELECT`, `WITH`, `SHOW`, `DESCRIBE`, `EXPLAIN`, a `PRAGMA` that does not set): hive-am checks the text (without comments or what is inside quotes: `INSERT`, `UPDATE`, `DELETE`, `DROP`, `SELECT … INTO`, `EXPLAIN ANALYZE` of a write are refused) and, where the engine allows it, the connection itself is read-only (PostgreSQL `BEGIN READ ONLY`, MySQL `READ ONLY` session, SQLite opened read-only). Turning it off in the settings lets writes run for real, and the map shows *Can write* in red.
- **On the map.** Its card shows the state, where it connects, the engine, read-only or can-write, **Test connection** and **Open panel**.
- **API** (local app only, because they use the saved password): `GET /api/object-db/props` (what the driver properties can be), `POST /api/object-db/test` (`{ id?, config }`), `GET /api/objects/:id/db/schema?database=`, `GET …/db/columns?schema=&table=&database=`, `POST …/db/query` (`{ sql, database? }`), `GET|DELETE …/db/history`, `GET|POST …/db/saved`, `DELETE …/db/saved/:id`.
- **Agents.** They see it in `object_list` (state); to look inside it and run SQL they need the **Database management** skill (15.12). Starting it or asking for its logs says what it is.

## 15.12 Agents that use a database

An agent with the **Database management** skill (`default-databases`, one of the skills that ship with hive-am; MCP capability `databases`) gets twenty tools with the prefix `object_db_`, one per operation. This deliberately breaks the rule "an agent cannot create, edit or delete resources", **only for databases**. Making an agent the manager of a database gives it this skill (and not *Colony resources*); one agent can look after servers and databases at once.

| Tool | What it does |
|---|---|
| `object_db_list` | The databases it looks after: name, engine, database and state (it does not need *Colony resources*). |
| `object_db_schema`, `_columns`, `_describe` | Databases, tables and views; the columns of a table; and a table in full (primary key, indexes, foreign keys, row count). |
| `object_db_search`, `_ddl`, `_sample`, `_explain` | Tables and columns by name; the `CREATE` statement (kept by MySQL and SQLite, put together from the catalog for PostgreSQL and SQL Server); the first rows; the plan of a statement **without running it**. |
| `object_db_query`, `_exec` | One statement (read, write or DDL); or several in **one transaction**, all applied or none (a failure says which statement it was; MySQL commits by itself on DDL). |
| `object_db_export` | A result as CSV or JSON in a file **inside the agent's own folder**: never outside it (a symbolic link included), never over an existing file unless `overwrite: true`. |
| `object_db_saved`, `_history` | The named queries and the last 200 queries (also the ones people ran; each entry says which agent ran it). |
| `object_db_sessions`, `_kill` | Who is connected and what they run (MySQL, PostgreSQL, SQL Server); cancel a query (MySQL, PostgreSQL) or end a session (SQL Server). SQLite answers "no sessions". |
| `object_db_config`, `_test` | How it connects (the password never shown: `passwordSet` says whether there is one), and a test of a saved connection. |
| `object_db_config_set`, `_create`, `_delete` | Change the connection (the engine cannot change), create a database resource (in the agent's colony, or none; the agent becomes its manager), delete one. A connection is **tested before it is saved**; nothing is saved if it fails. |

Any tool that takes `database` can use another database of the same server.

**What the agent may do** depends on its **effective** permission (the one it has after what its colony lends). The `readOnly` setting of the resource is for the person's panel and **does not apply to an agent**:

| | `plan` | `acceptEdits` | `bypassPermissions` |
|---|---|---|---|
| Discovery and reads, `explain`, `saved` and `history` list, `config`, `test` of a saved connection | yes | yes | yes |
| `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER` (`query`, `exec`), saved queries, clearing the history, `export`, `sessions` | no | yes | yes |
| `DROP` and `TRUNCATE` (also `ALTER … DROP`, also inside a script, which then runs nothing) | no | no | yes |
| `config_set`, a draft `test`, `create`, `delete`, `kill` | no | no | yes |

A `plan` agent always runs on a read-only connection with the text checked. `isDestructive()` (in `database.ts`) is a **guardrail, not a sandbox**: it ignores comments and quoted text, but does not see a `DELETE` without a `WHERE`, a `CALL`, a PostgreSQL `DO` block or a stored procedure. The real boundary is the grants of the database user.

**Scope and audit.** An agent sees the databases of its own colony, or only the ones it was chosen to look after; a foreign or unknown one looks like one that does not exist, and it can only move a resource into its own colony. Every query goes to the history of the resource (with `by`, the agent) and writes `[hive-am] <agent> ran <first 200 characters>` in the server log. There is no row or time limit of its own: the resource's `maxRows` and `timeoutSec` apply.

**Passwords are write-only.** An agent can set one with `create` or `config_set`, but nothing returns one: not a tool answer, an error, the history, the saved queries, the server log or a reply to a chat. SQL that sets a password (`IDENTIFIED BY '…'`, `PASSWORD '…'`, `WITH PASSWORD = '…'`) is stored with `***` in its place, and `findSecret` blocks a chat message that holds the password of any database resource (six characters or more). **Limit:** the value an agent types in a tool call is visible to that agent during its turn and stays in the CLI's own conversation store; the guarantee is that no tool lets it read a stored password back.

API used by the MCP script: `POST /api/agent-objects/db/<op>` with `{ from: <agent id>, … }`. Tests: `test-db-tools.ts` (SQLite, through the real MCP script) and `test-db-tools-engines.ts` (MySQL/MariaDB, PostgreSQL and SQL Server, with servers given through `DBT_*_PORT`).
