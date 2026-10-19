# Troubleshooting

This guide collects the most common problems when using hive-am, with their likely cause and what to do. Each section is a question: find the one that looks like what you see.

## The sidebar says "Server offline. Retrying…"

The server is not running or is on another port. The interface retries on its own.

1. Look at the terminal where you started hive-am: is it still open and free of errors?
2. If you closed it, start it again (`npx hive-am` or `hive-am`).
3. If you changed the API port with `HIVE_AM_PORT`, the interface has to point to the same port. With the npm package the API port is fixed (4400).

When the server comes back, the indicator changes to **Connected to server**.

## Instead of the lists I see a notice that they could not load

The API did not respond (it was starting, stopped or on another port). Start the server: the interface retries on its own with longer and longer pauses, or click **Retry**.

## On startup it says the port is already in use

You will see `port N is already in use: is hive-am already running?` and the program exits. Another instance (or something else) is already using that port.

1. Stop the other instance. On Linux or macOS, `lsof -ti :4400` tells you which process uses the API port.
2. If you need two instances, use another port: `HIVE_AM_PORT` for the server (when running from the source code) and `HIVE_AM_WEB_PORT` for the interface.

## The provider shows as "not found"

When you create an agent, the provider card shows **not found** when the program (`claude`, `opencode` or `kiro-cli`) is not in the `PATH` of the hive-am server.

1. Check that the program works in your terminal.
2. Install it, or start hive-am from a terminal where it is available.
3. Restart hive-am and open the form again: it should show as **installed**.

## The turn fails with "produced no events"

The command-line tool ran but sent nothing hive-am could use, and said something else instead (often its usage text). The first line it printed appears in the notice.

1. Read that line: it says what the tool did not like.
2. Update the tool, or try the same command by hand in your terminal.

## The turn fails with an "exited with code N" error

The command-line tool failed: expired session, invalid model, no credits, and so on. The detail appears in the red notice in the conversation.

1. Read the text of the notice.
2. Try the same command by hand in your terminal with the matching tool.
3. If the session expired, sign in again in that tool.

> **Note:** raw errors from the tools are shown as they arrive, untranslated.

## "This agent has no working folder…"

The agent has no folder of its own and does not belong to a colony that lends it one. Open its settings and choose a **Working folder**, or put it in a colony that has a folder and that it follows.

## "Folder does not exist"

The path you typed does not exist on disk. hive-am does not expand `~`, so type the full path (for example `/home/your-user/project`) or pick the folder with the **Browse** button.

## An agent cannot edit files or run commands

It is almost always the agent's permission level (or its colony's, if it follows it).

- **Read-only:** plans and reads; never edits or runs commands.
- **Edit files:** edits inside its folder, without touching `.git` or private keys. In OpenCode and Kiro it blocks all commands. In Claude it only lets file commands through.
- **Full access:** no restrictions.

Change the level in the agent's settings (or in the colony, if it inherits it). An agent with an external connection needs at least **Edit files**. More in [chapter 13](13-permissions-and-security.md).

## My message was lost after a restart or shutdown

If the server stops in the middle of a turn, that turn is lost. The session stays intact and the agent goes back to **Idle** on restart, but you have to send the message again.

## The session does not resume or the agent seems to start from scratch

Normally the next message continues the same real session, even after a restart. There are cases where a new session is started:

- If you change a colony's folder and that moves its agents, they start a new conversation. The earlier one is not lost: it stays in the agent's **Sessions** tab, where you can read and resume it.
- In OpenCode, a session recorded with a folder different from the agent's is replaced by a new one when you send the next message.
- Clicking **New conversation** starts a new session on purpose. The current one is kept in **Sessions**.

More details in [chapter 7](07-sessions.md).

## The history is empty

The tool may have changed the format of its files, or the session may have been deleted in the tool itself. Conversations live in each tool's own stores, not in hive-am: if they no longer exist there, hive-am cannot show them.

## An orchestrator does not delegate

If it has no workers connected, it cannot delegate. Connect them in **Relations** or in the **Team** section of its form, and explicitly ask it to delegate to a worker by name. If the orchestrator does not see a new agent, start a **New conversation**. More in [chapter 5](05-orchestration-and-relations.md).

## An orchestrator waits forever for a worker

Delegation has no time limit. If the worker hung, click **Stop** on the worker. A busy worker makes the orchestrator wait, because each agent handles one turn at a time.

## Stop did not empty the queue

**Stop** aborts the turn in progress, but messages that were already queued go on their way.

## A terminal does not open

Check that you did not start with `HIVE_AM_TERMINALS=0` and that you open hive-am from `localhost` or `127.0.0.1`: through a local network address there are no terminals. Details in [chapter 12](12-terminals.md).

## A request answers 413 "The request is too big"

The body is too large. Send less text. For files, the limit is 5 per message and 20 MB each.

## Typing in the chat is slow

This happens with very long conversations with many tools expanded. Collapse the tools with **Collapse all tools** (the link under the text field toggles between expanding and collapsing). If you run hive-am from the source code in development mode, the built version (`next build` and `next start`) is noticeably faster.

## An agent's cost does not show

This is expected: if the model is not from a known family and the tool does not report the cost, it is not shown. Values with `≈` are estimates based on list prices.

## The install fails because of `better-sqlite3`

There is no prebuilt binary for your Node version or your system. Use Node 20 LTS or install your system's build tools.

## I want to back up or reset my data

- **Back up:** stop hive-am and copy the whole `~/.hive-am` folder.
- **Reset everything:** stop hive-am and delete `~/.hive-am`. It is recreated on startup. Your conversations are not lost, because they are in each tool's own stores.
- **Move it elsewhere:** set `HIVE_AM_HOME` before starting.

If the problem you have is not here, check the error messages in the conversation and in the terminal where hive-am runs: they almost always say what failed.

Back to the [manual contents](README.md)
