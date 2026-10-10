# 16. Terminals

A panel at the bottom of every screen holds **terminals** (real shells) and the **logs** of objects, in tabs. Open it with **Ctrl+`** (or the *Terminal* button at the bottom of the left rail); the first time it starts a terminal in your home folder. Drag its top edge to resize it: the screen above gets the height that is left, so nothing hides behind it (a chat stays usable while you watch a server).

## 16.1 What you can open

- **+** a terminal in the folder of the last one (home at first); the folder button asks for a folder.
- From an **agent**'s header: a terminal in the agent's folder.
- From an **object**'s panel (see [15](15-colony-objects.md)): for a **server**, *Terminal here* (in its folder); for a Docker container (created or existing), *Shell in the container* (`docker exec -it … bash`, or `sh` when there is no bash); a compose project has several containers, so it only has logs. Every kind that has logs also has *Logs in the panel*.

Tabs show what is open; × closes one (a terminal is ended); a grey dot means the shell ended (its exit code is in the tooltip and printed in the terminal). The panel's state (open, height, last tab) is remembered by the browser.

## 16.2 How it works

Each terminal is a pseudo-terminal (`node-pty`) in the **server**, shown with xterm.js. So:

- Reloading the page, or opening another one, shows the same terminals; what they printed last (256 KB) is replayed. They end when the server stops (unlike server objects, which keep running).
- Colours, cursor keys, `vim`, `top`, resizing and non-ASCII text work as in any terminal. The shell is yours (`$SHELL`, interactive) with your environment, minus hive-am's own variables.
- Up to **12** terminals at a time.

API: `GET /api/terminals` (`{ enabled, terminals }`), `POST /api/terminals` (`{ cwd?, title?, objectId?, agentId? }`), `DELETE /api/terminals/:id`, and the socket `/ws/terminal?id=` (JSON messages: `in`, `resize` from the page; `init`, `out`, `exit`, `gone` from the server).

## 16.3 Security

A terminal is **your shell on your machine**: anyone who can talk to it can run anything you can. So:

- Only this machine: the `Host` must be a loopback name (`localhost`, `127.0.0.1`, `[::1]`; a page that reached the server under another name, as in DNS rebinding, is refused) and a browser's `Origin` must be one too: **another website open in your browser cannot reach a terminal**. This applies to listing, creating, closing and the socket. Opening hive-am through a LAN address does not give terminals.
- The server listens on `127.0.0.1` only.
- `HIVE_AM_TERMINALS=0` turns terminals off completely (the panel says so).
- **Agents have no tool to open or use terminals.** An agent keeps working with its CLI's own tools and its permission level.

## 16.4 The terminal library

`node-pty` (the prebuilt build, `@homebridge/node-pty-prebuilt-multiarch`) is an **optional** dependency: where it cannot be installed or loaded, hive-am still runs, and opening a terminal says so. Reinstall without `--omit=optional` (or install that package) to get it.

## 16.5 Tests

`server/scripts/test-terminals.ts` (no model): a real shell over the socket (input, output, resize, non-ASCII, replay for a second page, exit code), who may reach it (another origin, a rebound host name), a shell inside a real container, a terminal for a server object, limits and the off switch.
