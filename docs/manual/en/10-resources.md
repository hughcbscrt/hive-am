# Resources

Besides agents, a colony can have **resources**: things hive-am keeps running or watches alongside your agents. There are five types: **Server**, **Docker**, **HTTP requests**, **Database** and **Cluster**. Each one appears on the Colony map as a hexagon, in the color of its type and with a status dot.

In this chapter you learn how to create a resource, how to use each type and how to let a manager agent look after it for you. The examples use the "Online store" project: the store API, a Redis, a SQLite database, a file of HTTP requests and a cluster that groups the first two.

## The Resources screen

**Resources** in the left menu opens a screen with two areas:

- **Resource list** (on the left): resources are grouped by colony, each with a status dot, its type and a summary. At the top there is a search box (**Find a resource**) and the **+** button to create one. The list can be collapsed to icons.
- **The selected resource** (on the right): a header with its status and actions, and the tabs below.

These are the statuses you see in the header and in the list:

| Status | What it means |
|---|---|
| **Running** | It is up (and, if you set a port, something is already listening). |
| **Starting** | It started, but is not listening on its port yet. |
| **Stopped** | It never started, you stopped it, or it ended with code 0. |
| **Error** | It ended with a code other than 0, or its health check failed. The details give the reason. |
| **Unknown** | It is an existing container that Docker cannot find. |
| **Ready** | Only for HTTP requests and databases: they are used, not started. |

The tabs depend on the type:

| Type | Tabs |
|---|---|
| Server and Docker | **Summary**, **Logs**, **Settings** |
| Cluster | **Summary** (with its members), **Logs**, **Settings** |
| HTTP requests | **Requests**, **History**, **Variables**, **Settings** |
| Database | **Queries**, **Schema**, **History**, **Settings** |

> **Tip:** the open tab is kept in the page address (`?tab=`), so you can copy the link and open it directly on that tab.

## Create a resource

1. Press **+** in the Resources list (or **New resource**, at the top right of the Colony screen). The **New resource** panel opens.
2. Under **What kind of resource**, pick a card: **Server**, **Docker**, **HTTP requests**, **Database** or **Cluster**.
3. Under **General**, type the **Name** (for a database it can stay empty: it is taken from the database and the engine).
4. Pick the **Colony** it belongs to. You can leave it as **No colony**.
5. If you want, search for a **Manager agent** (explained further down).
6. Fill in the fields specific to the type (you see them in the next sections) and press **Create**.

![The New resource panel open over the Resources screen, with the five type cards and the Name, Colony and Manager agent fields](img/recurso-nuevo.jpg)

*The New resource panel. At the top are the five type cards (Server is selected). Below, the General section with Name, Colony and Manager agent. Press Create when you are done.*

You edit a resource later from its **Settings** tab (or with the pencil on its card on the map). The type cannot be changed.

> **Note:** creating, changing, deleting and acting on a resource is only accepted from the local app, because resources run commands on your machine.

## Server

A server is a shell command that hive-am keeps running: `npm run dev`, `node server.mjs`, `java -jar app.jar`. You get its logs, its CPU and memory use, and actions to start, stop and restart it.

### Fields when creating

| Field | What it is for |
|---|---|
| **Folder** | Where the command runs. Press **Browse** to pick it. |
| **Start command** | What gets run, for example `npm run dev`. |
| **Stop command (optional)** | Runs before the process is stopped (for example `docker compose down`). The process is always stopped after it. |
| **Port (optional)** | If you set it, the resource is **Starting** until something listens on that port, and then **Running**. A process that stays alive for two minutes without opening it is shown as an error. |
| **Environment variables** | One `NAME=value` per line, added to hive-am's own. |

### Start, stop and restart

The resource header has **Start**, **Stop** and **Restart**, plus **Terminal** to open a terminal in its folder. Two details worth knowing:

- The server **keeps running if hive-am restarts**. When hive-am comes back, it finds the server again.
- **Stop** asks the process to end and, if it does not within 8 seconds, forces it. You can adjust that time under **Seconds to stop**.

### Summary

The **Summary** tab brings together three cards and the latest output.

![Summary tab of the Store API server: Running status, CPU and memory, command details and latest output](img/recurso-servidor-resumen.jpg)

*Summary of the "Store API" server. At the top, the status (Running for 13 min), the usage (CPU 0%, memory 49.5 MB) and the details (command, folder, port 4555, restart policy, health check, PID). Below, the latest output and the See all the logs link.*

### Logs

The **Logs** tab fills the whole screen. You can:

1. Type in **Search in the logs** to highlight matches, or tick **Only matches** to see just those lines.
2. Keep **Follow the end** on to see new lines as they arrive (if you scroll up, it stops following).
3. Use the buttons on the right: wrap lines, text size, pause, clear the view, copy and download.

Error and warning lines are colored.

![Logs tab of the server with the search box, the Only matches checkbox and the toolbar buttons](img/recurso-servidor-logs.jpg)

*The Logs tab. At the top are the search, the Only matches checkbox and the buttons on the right (wrap lines, size, pause, clear, copy, download). Bottom left, the line counter.*

### Settings and keeping it healthy

The **Settings** tab shows the same fields as when creating, spread over cards (**General**, **How it runs**, **Environment**, **Keeping it healthy**). At the bottom there is a bar that tells you whether anything is unsaved and offers **Save**, **Discard**, **Save and restart** (if it is running) and **Delete resource**. Changes to a running resource apply when you restart it.

![Settings tab of the server with the General, How it runs, Environment and Keeping it healthy cards](img/recurso-servidor-configuracion.jpg)

*Server settings. On the right is the Keeping it healthy card, with If it ends by itself (Restart after a failure) and the HTTP Health check. At the bottom, the bar with Delete resource, Discard, Save and restart and Save.*

The **Keeping it healthy** card defines what hive-am does on its own:

- **If it ends by itself:** do nothing (the default), restart after a failure, or always restart. Each restart waits longer than the one before (1 s, 2 s, 4 s, up to 30 s) and there is a cap under **Max restarts** (by default 5 in 10 minutes). If the cap is exceeded, the server stays in error and says it gave up. Stopping it yourself is never undone.
- **Health check:** it can be HTTP (healthy if the URL answers 2xx or 3xx), port (something accepts connections) or command (it ends with 0). It repeats every N seconds (**Every (s)**, 15 by default) and, after several **Failures in a row** (3 by default), the server is shown as an error with the reason. Tick **Restart it when it is unhealthy** if you also want it restarted.
- **Seconds to stop:** the time allowed after the stop signal before it is forced (8 by default).
- **Log size (MB):** when the log reaches this size (5 by default), the older part is set aside and the file starts over.

> **Note:** the restart counters live in memory. If hive-am stops, the server keeps running but nobody restarts it; hive-am takes over again when it starts.

## Docker

A Docker resource manages containers. It needs the `docker` command on your machine. When creating it, you pick one of three modes under **How it is managed**:

| Mode | What hive-am does | When you delete the resource |
|---|---|---|
| **Create a container** | Creates the container from an **Image**, with **Ports** (`8080:80`), **Volumes** (one row each: a volume or a folder, and where it goes), environment variables, **Restart policy** and **Command (optional)**. | The container is removed. |
| **Compose project** | Manages a **Compose file**, with **Project name (optional)** and **Services (optional)** (empty means all). | The project is stopped, not removed. |
| **Existing container** | Only starts, stops and restarts it, and reads its logs. | It is left as it is. It is never removed. |

The forms ask Docker to suggest what already exists: local images, networks and volumes (each says how many containers use it), existing containers (the ones hive-am created are marked) and, when you pick a compose file, its services. If Docker is not available, the lists are empty and you can always type the value by hand.

In **Volumes**, press **Add a volume** and, in the row, pick a volume of this machine, type a new name (Docker creates it the first time the container starts, and the row tells you) or press **Folder** to choose a folder; then write the path inside the container (a row needs both sides to be saved, and says so) and tick **Read only** if the container should not write there. A resource you saved before shows its volumes in these rows.

Under the image, **Build from a Dockerfile** builds an image for you: choose the Dockerfile (a file named `Dockerfile`, `Containerfile`, `Dockerfile.something` or `something.Dockerfile`), optionally the folder it builds from (by default its own folder), and the image name (suggested from the folder), then press **Build**. When it ends, the new image is picked. The Dockerfile's steps run on your machine and may download base images, so it can take a few minutes; if it fails you see the last lines of the output. Building does not create the container: that happens on **Start**, as always. Next to the Dockerfile, **Edit** opens it in the code editor and **Save as copy** writes a copy next to it (`Dockerfile.copy` by default) that becomes the file to build. Saving asks first and builds nothing: the next **Build** uses it.

If the network you type does not exist on this machine, the field tells you the container will not start without it and offers **Create network**; a volume row with a new name offers **Create it now**. What hive-am creates is marked *created by hive-am* and stays even if you cancel the form. In the suggestions, a network or a volume hive-am created that no container uses has a delete button: it asks first, and hive-am checks again before deleting. Networks and volumes that hive-am did not create, Docker's own networks and anything in use are never deleted.

In **Create a container** mode you can pick the **Network** and set limits (memory, CPUs, log size, time to stop). If you change one, the container is created again the next time it starts or restarts, and what was inside it is lost.

**Additional networks** connect the container to more networks than the main one: add them by name (or pick one of this machine) and remove them with the **×** of each chip. **More options of docker run** has a few more settings, each checked: user, working folder, entrypoint, hostname and labels. There is no field for other flags.

**Change a container hive-am created.** In **Settings**, **Save** only saves: the next start uses the new settings. **Save and apply** changes the container now. Adding or removing an additional network happens in place, without creating the container again (it keeps its id, running or stopped). Anything else needs the container to be created again, so hive-am first shows a confirmation with what changes, what is lost (files written inside it, its logs, restart count, id and IP), the anonymous volumes that would be left unmounted, and the commands it will run. Nothing happens in Docker until you confirm. Named volumes and folders are kept, even one you took out. The time to stop applies the next time it stops.

**An existing container is never changed by hive-am.** To change how it runs, use **Create a managed copy** (in **More**, or in its **Settings**): the form of a new container opens filled in from the existing one (image, ports, volumes, variables, networks, limits and options), with a list of what could not be copied. The original is only read. Its ports stay taken while it runs, so change them in the copy or stop the original first.

The **Summary** of a Docker resource adds processes, network and disk, and shows the image, the ports and the number of restarts.

**Inspect** (in **More**, for a created or an existing container) shows two panels: **Configured in hive-am**, what you set up (always there, even if the container does not exist), and **What Docker says**, the live detail with its variables, ports, mounts, networks, health checks and **Labels**. If Docker does not have the container yet (it is created the first time you start it), cannot find it, or is not running, Inspect says so instead of failing. If you changed the settings since the container was created, it warns that the container will be created again on the next start.

Its **Raw JSON** tab shows everything `docker inspect` says, highlighted, with a search box that jumps to each match and a **Copy JSON** button that copies what you see. Variables whose name looks like a secret (passwords, tokens, keys) arrive hidden, and so does the password inside a URL such as `postgres://user:password@host/db`; press **Reveal** to see them. Labels and the command are not hidden, so check them before sharing the JSON. Each compose service has the same tab.

**Relations.** Every Docker resource has a **Relations** tab with a map of what it uses and who shares it: images on the left, containers in the middle, and on the right its volumes, the folders of your machine it mounts (shown apart from volumes, with a folder icon and a dashed border) and its networks. Choose any of them to light up what it is joined to and see its detail under the map; **Inspect** opens right there. The map only shows this resource's neighbourhood: a volume or network shared by many containers shows 12 of them and says how many more, and Docker's own networks (`bridge`, `host`, `none`) only say how many containers use them. A container of a hive-am resource offers **Edit settings**. It is read only: nothing changes from the map.

![Summary of the Cart Redis Docker resource: status, CPU and memory, network and disk, and details such as container, image and ports](img/recurso-docker.jpg)

*Summary of "Cart Redis", an existing container (Managed as: Existing container). Note the usage (CPU, memory, processes, network and disk) and the details with the redis:7-alpine image and the published ports.*

A compose resource lists its **services**, and each one has its own actions to start, stop, restart and see logs. Each service also offers **Inspect**, a shell inside the container, **Create again** and **Build again and create**.

**Edit the compose file.** A compose resource has a **File** tab with its compose file in the code editor (highlighted, with line numbers; the theme and whitespace come from the code settings). The path and size are at the top. **Save** asks first, naming the file it replaces, and writes it on disk (you can tick *Do not ask again for this file in this session*); **Ctrl+S** (**Cmd+S**) does the same. **Discard** goes back to what was saved. Saving does not touch Docker: if services are running, a notice says they keep the previous definition and offers **Create again** (with its usual confirmation). If Docker cannot read the file, it is saved anyway and the notice shows Docker's error, so you can fix it. If the file changed on disk since you opened it (another editor, for instance), hive-am does not overwrite it: choose **Reload** or **Overwrite** (after a confirmation). In **Settings**, **Edit the file** next to the compose file opens this tab.

**Save as copy** writes the text in the editor (saved or not) next to the original with the name you choose (`docker-compose.copy.yml` by default); the original does not change. With **Use the copy in this resource** (on by default) the resource uses the copy from then on, without touching Docker: the next **Start** or **Create again** uses it. A name that already exists is only replaced after you confirm it. If services are running when the resource switches to the copy, the same notice offers **Create again**. An existing container has no file to edit.

A file with Windows line endings keeps them when you save it. Going to another resource from the list does not ask about unsaved changes in the **File** tab: save them first.

## HTTP requests

An HTTP requests resource points to a **folder with `.http` or `.rest` files**, in the format used by the REST clients of IntelliJ and VS Code. It is not started or stopped, and it has no logs: it is for sending requests and reviewing responses.

### Create

When you pick **HTTP requests**, fill in:

- **Folder with the .http files:** every `.http` and `.rest` file inside is read (up to 4 levels deep).
- **Default environment (optional):** one of the names in `http-client.env.json`, for example `dev`.

The status becomes **Ready** and the details say how many requests and files it found.

### The runner

The **Requests** tab has, on the left, the **Environment** selector, a request search box and the list of files with their requests. If you press a file, you see its requests on the right and you can run them all.

![Requests tab of the Store API (HTTP) resource with the store.http file open and its three requests not yet run](img/recurso-http-archivo.jpg)

*The store.http file with its three requests (List products, Service status and Missing product), all "not run". At the top right is the Run the whole file button; on the left, the Environment selector (dev).*

### Run a request

1. Pick the **Environment** (for example `dev`).
2. Press a request in the list.
3. Press **Run** or use **Ctrl+Enter**.

If the request uses a `{{variable}}` with no value, it is not sent: the runner tells you which ones are missing. Pick an environment that defines them or add them.

The response has these tabs:

| Tab | What it shows |
|---|---|
| **Response** | The body, as a collapsible JSON tree (or **Text**). A box at the top filters by text or by JSONPath (`$.items[*].id`). |
| **Headers** | The response headers. |
| **Tests** | The checks and whether they passed (for example `2/2`). |
| **Request** | The request as it will be sent or was sent. It hides the values of `Authorization`, `Cookie` and API keys. |
| **Variables** | Each variable with its current value and where it comes from. |
| **Authentication** | Bearer, Basic or API key; it is written into the request as the matching header. |

![Response to the List products request: JSON tree with two products, status 200 OK, 6 ms, and the Response, Headers, Tests, Request, Variables and Authentication tabs](img/http-respuesta.jpg)

*Response to "List products" (GET {{base}}/products). At the top right you see 200 OK, 6 ms and 112 B, and the "Kept: firstSku" label. Below, the JSON tree with the two products.*

### Tests and chaining requests

Inside the `.http` file, a `> {% ... %}` block after the body runs when the response arrives. With it you can:

- Check the response: `client.test("name", function () { client.assert(response.status === 200, "message"); })`.
- Keep a value for the following requests: `client.global.set("token", response.body.token)`. From then on you use it as `{{token}}`.

The **Tests** tab shows each test as passed or failed and lets you **Add a check** (status, time, a header, a JSON value or a text) and **Save checks**, which writes them into the file.

![Tests tab of List products with two passed checks: responds 200 and has products](img/http-pruebas.jpg)

*The Tests tab (2/2) of "List products": "responds 200" and "has products" passed. On the right are Add a check and Save checks.*

> **Note:** hive-am does not run real JavaScript. A small interpreter understands only what these scripts need (`response`, `client`, comparisons, `if`, arrow functions, basic string and list methods). If a script uses anything outside that, it does not run and the response says what is not supported (the request was already sent). An external script file (`> ./checks.js`) does not run either.

A named request (`### login`) can be used in the ones that follow: `{{login.response.body.$.token}}`.

### Run the whole file

The **Run the whole file** button (or the list icon next to the file) runs its requests in order, so each one finds what the previous one kept. Each request keeps its last response and a colored dot shows how it went: green if all was well, red if the status was an error, a test failed or the script could not run. Turn on **Stop at the first failure** if you want to cut at the first problem.

![After running the whole file: List products 200 with tests 2/2, Service status 200 and Missing product 404 in red](img/http-ejecutar-todo.jpg)

*Result of Run the whole file. The Last run column shows 200 (3 ms), 200 (2 ms) and 404 (1 ms) in red; the Tests column shows 2/2. In the list on the left, one green or red dot per request.*

If you open a request that answered with an error, the status shows in red and you can review its headers and tests as with any other response.

![404 Not Found response of the Missing product request, with the error body shown as a tree](img/http-respuesta-404.jpg)

*A response with an error: at the top right, the 404 Not Found status in red with its time and size, and the body of the response below. This request has no tests: open the Tests tab to add them.*

### Variables and secrets

A `{{variable}}` takes its value from the chosen environment (`http-client.env.json`, and `http-client.private.env.json` for secrets), from the resource's own variables or from the file's (`@name = value`). What a script keeps in the session wins over everything else, and an env file wins over the resource's variables. Some values are also generated for you: `{{$uuid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}` and `{{$randomInt}}`.

The resource's **Variables** tab has **All environments** (values that always apply) and one tab per environment (`dev`, `local`, or a new one with **New environment** and **+**). To add one:

1. Pick **All environments** or the environment you want.
2. Press **Add a variable**.
3. Type the name and the value. If it is a secret, mark it as one.
4. Press **Save**.

![Variables tab of the HTTP resource with the All environments, dev and local tabs, and the Add a variable button](img/http-variables.jpg)

*The resource's Variables tab. At the top are All environments, dev and local, and a field for a new environment. Below, the Add a variable button and the bar with Discard and Save.*

A secret is hidden once saved and the interface never receives its value. Saving it empty keeps the previous one.

> **Note:** secrets are stored in hive-am's database on your machine, **without encryption**, just like the Telegram bot token.

### History and compare

The **History** tab keeps the last 100 runs, with their response, and survives a restart. **Compare with…** shows the differences against the previous run of that request or any other: status, time, size, headers and a diff of the response.

Other runner helpers: **Copy as…** (cURL, fetch, Python and other formats), the **+** next to the environment to add a new request (from a form or by pasting a cURL command) and **Run with data…** to run a file once for each row of a CSV or a JSON array.

## Database

A database resource is *used*, not started: hive-am opens a connection when you ask it for something (its status, the schema, a query) and closes it right after. It supports **MySQL / MariaDB**, **PostgreSQL**, **SQLite** and **SQL Server**.

### Create the connection

1. Pick **Database** and the engine on its card.
2. Paste a **Connection URL** (`postgresql://user:password@host:5432/app`, `mysql://...`, `mssql://...`, `sqlite:///path/app.db`) and the fields fill in by themselves. Or fill in **Host**, **Port**, **User**, **Password** and the default database. For SQLite, give the file.
3. Press **Test connection** before saving to check that it works.
4. Press **Create**.

The password stays on the server: the interface receives it empty, and saving with the field empty keeps the previous one. The status becomes **Ready**, with the engine version and how long the connection took.

If your server requires it, turn on **Use SSL / TLS**. The certificate is verified unless you accept a self-signed one, and you can give the `.pem` files for the CA and the client. The settings also have a table of **driver properties** (for example `charset` on MySQL or `application_name` on PostgreSQL).

### Read-only by default

At first only statements that read are accepted (`SELECT`, `WITH`, `SHOW`, `DESCRIBE`, `EXPLAIN` and a `PRAGMA` that changes nothing). The editor shows the **Read-only** badge. If you turn that option off in the **Settings**, writes run for real and the map shows **Can write** in red.

A result never brings back more than 1000 rows by default, and a query that takes longer than 30 seconds is stopped. Both limits can be adjusted in the settings.

### Write and run queries

1. Open the **Queries** tab.
2. Write your SQL in the editor (with highlighting and suggestions for tables and columns; **Ctrl+Space** asks for them).
3. Press **Run** or use **Ctrl/Cmd+Enter**. If you select a piece of text, only the selection runs.
4. Look at the results table. You can copy it as **CSV** or **JSON**, or press **Download CSV**.

**Format** tidies the query using the engine's dialect. **Save query** keeps it with a name and you find it in the **Saved** menu.

![Queries tab of the Store database with a highlighted SQL query and a table of 20 order rows](img/db-consulta.jpg)

*The Queries tab of "Store database" (SQLite). At the top, the Run, Save query, Format and Saved buttons, and the Read-only badge. Below, the result: 20 rows in 60 ms, with the CSV, JSON and Download CSV buttons.*

### Schema

The **Schema** tab lists the tables and views (grouped by schema where the engine allows it) with a search box. When you pick one you see its columns: type, whether it allows null, key and default value. **See the first rows** writes a `SELECT ... LIMIT 100` (`TOP 100` on SQL Server) into the editor, with the engine's own quoting, and **Copy name** copies the table name.

![Schema tab with the customers, orders and products tables, and the columns of orders](img/db-esquema.jpg)

*Schema of the database. On the left are the customers, orders and products tables; on the right, the columns of orders with their type, null, key (PRI) and default value. At the top right, the See the first rows button.*

### History

The **History** tab shows your **Saved queries** and your **Recent queries** (the last 200, with the time, the rows and how long they took). One click on a query brings it into the editor. **Clear history** clears the recent ones.

![History tab with no saved queries and one recent query of 20 rows](img/db-historial.jpg)

*The database history. There are no saved queries yet; under Recent queries is the one you ran, with "20 rows, 60 ms". At the top right is Clear history.*

> **Note:** agents see the database in `object_list` (with its status), but they do not yet have a tool to query it.

## Cluster

A cluster groups servers and Docker containers **from the same colony** (not other clusters or HTTP requests). It is for starting and stopping the whole environment at once.

### Create and manage

1. Create a resource of type **Cluster**.
2. Under **Resources it groups**, pick the servers and containers.
3. In the **Summary** tab, order the members with the up and down arrows: that is the **Start order**.

The header offers **Start all**, **Stop all** and **Restart all**. Start all starts the members in the listed order, skipping the ones that are already up; stop all stops them in the opposite order. If one fails, hive-am tries the others and reports all the failures together.

![Summary of the Store environment cluster with two ordered members, a 2/2 running status and unified logs](img/recurso-cluster.jpg)

*Summary of the "Store environment" cluster. The Members table shows the start order (Store API first, Cart Redis after), their status, CPU and memory, and the buttons for each member. Below, the latest output with the member name in square brackets.*

The cluster's status comes from its members: **Running** if all of them are, **Starting** while one is starting, **Error** if one failed or only some are up, and **Stopped** if none is.

The cluster's **Logs** gather those of all members, with a color and a label per member (you can hide any of them). Deleting a cluster leaves its members as they were.

## Agents that look after resources

An agent with the **Colony resources** skill gets three tools:

- `object_list`: see the resources and their status.
- `object_logs`: read a resource's logs.
- `object_action`: start, stop or restart a resource.

These are the only tools. An agent **cannot create, edit or delete** resources, or change the command they run: that is left to people (unless you give it the **Colony builder** skill, see below). Also, the skill is not just an instruction: the server enforces the rules.

- An agent sees only the resources of **its own colony**.
- A **read-only** agent can list and read logs, but not start, stop or restart.
- Every action is written to the server log, so you know who did what.

### Agents and databases

To let an agent use a **database**, give it the **Database management** skill (choosing it as the manager of a database gives it the skill). It can then look at the structure (tables, columns, keys, indexes), run SQL, keep saved queries, read the history and, with the right permission, change the data. What it may do depends on its permission:

- **Read-only:** look and read. Nothing it writes can reach the database.
- **Edit files:** also insert, update, delete, create and alter, run a script of several statements as one transaction (all or nothing), save queries, export a result to a file in its own folder and look at who is connected. It cannot `DROP` or `TRUNCATE`.
- **Full access:** also `DROP` and `TRUNCATE`, change how the resource connects, create and delete database resources and cancel what another session is running.

The **read-only** switch of the resource is for you, in its panel: it does not stop an agent. What decides is the agent's permission, so for a database that matters, give the agent a database user with limited grants. A password an agent sets is stored and never shown again, and no answer, history entry or log holds it. Every query an agent runs appears in the **History** tab with the name of the agent. More in the reference, [section 15.12](../../reference/en/15-colony-resources.md#1512-agents-that-use-a-database).

### Choose a manager agent

A server, a Docker container, a cluster or a database can have **one manager agent**. With one chosen, only that agent sees the resource and can act on it, even if it is in another colony. With none, it is looked after by the agents of its colony that have the skill.

You can choose it in three ways:

1. In the resource form (when creating or editing), under **Manager agent**: search for an agent.
2. On the resource card on the Colony map, with **Add manager agent**.
3. From an agent's form, under **Resources it looks after** (it accepts several).

Choosing an agent that does not have the skill gives it the skill. Choosing a resource that another agent already looks after takes it away from that agent.

You can also create a new agent that is already set up: pick the resource on the map and press **Create a manager agent** on its card.

### Agents that create resources

An agent with the **Colony builder** skill can create, change and delete resources of any colony from a chat (servers, Docker, HTTP requests, databases and clusters, with the same fields as the form) and choose the agent that looks after each one. It never sees or writes a secret: passwords and secret variables come empty, `env` values come as `***`, and if it tries to save a password the server refuses it. Create the resource with the agent and then fill in the password yourself in its form. It deletes a resource only after you say yes to the exact name. It does not start or stop resources: that is still **Colony resources**. More in [Permissions and security](13-permissions-and-security.md#agents-that-build-colonies).

## The resource card in the colony

On the Colony map, each resource is a hexagon. When you press it, a card appears with its status, its command, the actions and the recent logs.

![Colony map with the Store API server card open: status, command, Start, Stop and Restart buttons, logs and the Who looks after it section](img/colonia-tarjeta-recurso.jpg)

*The "Store API" card over the map. At the top are the status and the Open panel button; then the command, Start, Stop and Restart, Terminal here and Logs in the panel. Below, Who looks after it with Create a manager agent and Add manager agent. On the map, a dotted line joins the server to its cluster.*

Press **Open panel** to go to the resource's full screen. The pencil on the card opens its settings. A cluster is joined to its members with dotted lines.

Next: [Changes explorer (git)](11-changes-explorer-git.md)
