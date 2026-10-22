# Getting started

This chapter takes you from zero to your first agent in a conversation: what you need, how to start hive-am, how to move around the interface, and how to create and test an agent.

## Requirements

- **Node.js 20 or later.**
- **macOS or Linux.**
- At least one of these tools installed **and signed in**: `claude` (Claude Code), `opencode` or `kiro-cli`. You do not need all three.

> **Note:** hive-am runs those tools exactly as they are on your machine. If one does not work on its own in your terminal, it will not work from hive-am either.

## How to start hive-am

Pick one of the three ways.

**With npx (nothing to install):**

```bash
npx hive-am
```

**With a global install:**

```bash
npm install -g hive-am
hive-am
```

**From the source code:**

```bash
git clone git@github.com:hughcbscrt/hive-am.git
cd hive-am
npm install
npm run dev
```

Once it starts, open <http://127.0.0.1:4401> in your browser.

### Ports

- The server (API and WebSocket) uses port **4400**.
- The web interface uses port **4401**. To change it: `HIVE_AM_WEB_PORT=4500 hive-am`.
- With the npm package, the API port is fixed.

### Stop, update and help

- Stop hive-am with **Ctrl+C** in the terminal where you started it. To leave it running without keeping a terminal open, start it with `hive-am start --background`: it prints where its log is, and later `hive-am status` tells you whether it is running, `hive-am logs -f` shows what it prints and `hive-am stop` stops it (`hive-am restart` does both). Servers and containers you left as resources keep running.
- Update with `hive-am update` (it checks npm for a newer version and installs it; `hive-am update --check` only says whether there is one, and `hive-am update --restart` also restarts a hive-am you left running in the background). With npx: `npx hive-am@latest`. `hive-am version` prints the version you have.
- `hive-am --help` shows the options and `hive-am --version` shows the installed version.

### Where your data is stored

Everything is stored in `~/.hive-am` (the database is `~/.hive-am/hive-am.db`). To use another folder, set the `HIVE_AM_HOME` variable before starting. Conversations are not there: they live in the stores of each tool (Claude Code, OpenCode, Kiro). hive-am keeps its own record within limits: old channel messages, delegations and conversations that the tool no longer has are forgotten after a while, never the conversations themselves ([details](13-permissions-and-security.md)).

> **Tip:** to back up your data, stop hive-am and copy the whole `~/.hive-am` folder.

## Tour of the interface

![The colony map](img/colonia-mapa.jpg)

*The colony map, with the menu on the left.*

The side menu has six entries:

- **Home**: every section of hive-am as a card, what is happening now and the latest delegations (see below). The hive-am logo also takes you there.
- **Chat**: your last conversation ([chapter 4](04-chat.md)).
- **Colony**: the map with your agents and resources ([chapter 2](02-the-colony.md)).
- **Resources**: servers, containers, HTTP requests and clusters ([chapter 10](10-resources.md)).
- **Agents**: the list of all your agents and their workspace ([chapter 3](03-agents.md)).
- **Schedules**: messages sent at a set time ([chapter 8](08-schedules.md)).

Five sections are not in the menu. Open them from **Home** or with **Ctrl K** (**⌘ K** on a Mac); a line under the entries reminds you:

- **Relations**: the canvas where you connect orchestrators with workers ([chapter 5](05-orchestration-and-relations.md)).
- **Connections**: links with Telegram and Slack ([chapter 9](09-telegram-connections.md)).
- **Agent types**: agent templates, and **Skills**: reusable knowledge ([chapter 6](06-types-and-skills.md)).
- **Sessions**: the conversations of all your agents ([chapter 7](07-sessions.md)).

Each of them shows a **‹ Home** link above its title to go back.

At the bottom of the menu are the **Activity** button (notices of finished agents, see below), the **Terminal** button (opens the terminal panel, [chapter 12](12-terminals.md)), the server status with the installed hive-am version (for example `v1.7.0`) on the same row, and **Switch theme**. The keyboard icon next to **EN** / **ES**, at the top, opens the list of shortcuts.

### Home

Home (`/`) is the first screen. At the top, **Search agents, sections and actions** opens the command palette and **Keyboard shortcuts** opens the list of shortcuts. Under them, a row says what is happening now, showing only what is not zero: the agents working (opens **Agents**), the unread notices (opens **Activity**), the delegations in progress (scrolls down to them) and the connections with an error (opens **Connections**). When there is nothing, it says that all is quiet.

Then come the ten sections as cards, in three groups:

- **Work**: Chat (with the name of your last chat), Agents, Colony (the agents working, or how many colonies you have) and Relations.
- **Operate**: Resources, Schedules and Connections (in red, how many have an error).
- **Library and history**: Agent types, Skills and Sessions.

The cards show the totals hive-am already has, and nothing for Relations, Schedules and Sessions. At the bottom are the three latest delegations; **View all** opens the Colony screen, which lists six. With no agents yet, a card on top offers **Create an agent**. If the data cannot be loaded, a message offers **Retry** and the cards still open their sections.

To give the screen more room, the panel button next to the hive-am name (**Collapse the menu**) folds the menu to a narrow column of icons. Hovering or focusing an icon shows its name, counts stay as small badges, and **EN** / **ES** stay one above the other. The same button (**Expand the menu**) opens it again. Your choice is remembered in the browser. On a narrow screen (under 760 px) the menu is a bar at the top with its labels, and it does not fold.

### Activity: what finished while you were elsewhere

When an agent finishes a reply while you are not looking at its chat (you are on another screen, on another agent, or the tab is in the background), it leaves a **notice**: a green dot on its avatar (red when it needs attention) in the side list of the chat and on the Colony map, and a number on the **Activity** button. Activity is the first button at the bottom of the menu, right above **Terminal**; its badge counts the agents with something unread (green, or red when one of them failed; `99+` from 100). The browser tab says it too: `(3) hive-am`.

Click **Activity** to open its panel:

- **Unread**: one row per agent, the most recent first, with its colony, **Finished** or **Needs attention**, how long ago and the first words of its last reply. Click a row to open that chat, or the **×** to mark it as read. **Mark all as read** clears the list.
- **Now**: the agents working right now and the orchestrators waiting for a delegation, with what each one is doing.
- **Browser notifications**: off by default. Switch it on to get a system notification when an agent finishes while this tab is in the background or without focus; the browser asks for permission only then. Clicking the notification opens that agent. If the browser blocks notifications for the site, the switch is disabled and says so.

A notice is cleared when you open that agent's chat with the tab visible. Only one is kept per agent (a newer one replaces it), notices older than 7 days are dropped, and so are those of deleted agents. A worker that finishes a delegation fine does not leave a notice (its orchestrator does when it gets the result); a failed delegation does.

> **Note:** notices live only in this browser (`localStorage`), together with a short excerpt of each reply (up to 140 characters). **Mark all as read** deletes those excerpts. hive-am only notices the turns that end while one of its tabs is open; for anything older, look at **Sessions**.

The panel opens upwards next to the menu and closes with **Esc**, with a click outside or by tabbing out of it. On a narrow screen the Activity button stays at the right end of the top bar and the panel opens as a sheet at the bottom.

### Connection indicator

Near the bottom of the menu, **Connected** appears with a green dot while the interface is talking to the server (hover it to read **Connected to server**). If the server stops, the text changes to **Server offline. Retrying…** and the interface reconnects on its own. If you see that message, check [chapter 14](14-troubleshooting.md).

### Language

The **EN** / **ES** selector at the top of the menu changes the interface language. The language is remembered in the browser. If none is saved, the browser language is used (Spanish if it starts with "es", English otherwise).

![The interface in English after choosing EN](img/idioma-ingles.jpg)

*The same screen in English. The **EN** / **ES** selector is at the top left, under the hive-am name.*

> **Note:** the names and descriptions you write yourself (agents, colonies, types) are not translated. Only the interface's own texts change.

### Light and dark theme

Click **Switch theme** (at the bottom of the menu) to toggle between the light and dark themes. Your choice is saved in the browser. With no saved choice, hive-am follows your system preference.

![The Colony screen in the dark theme](img/tema-oscuro.jpg)

*The dark theme. The **Switch theme** button is at the bottom left, with the pointer over it.*

### Command palette and shortcuts

**Jump to…**, right under **EN** / **ES** at the top of the menu, opens the command palette; so do **Ctrl K** (**⌘ K** on a Mac) from anywhere and the search button of Home. Type to filter, move with **↑** / **↓** and open with **Enter**; **Esc** (or **Ctrl K** again) closes it. With nothing typed it lists, in this order:

- **Unread**: the agents with a notice, the most recent first.
- **More sections**: Relations, Connections, Agent types, Skills and Sessions, the sections that are not in the menu.
- **Agents**: the first five, the ones working first, then your last chat, then the most recently active (keep typing to find the rest).
- **Go to**: the screens of the menu.
- **Actions**: show activity, jump to the latest unread, mark all as read, collapse or expand the menu, switch theme, switch language, show or hide the terminal and the list of shortcuts.

When you type, **More sections** goes away, **Agents** shows up to 50 and **Go to** lists every section. The filter looks at the name, colony, description, provider and model, without caring about capitals or accents ("agil" finds "Ágil"). Sections are also found by other words, in English and in Spanish: "telegram" or "slack" find Connections, "history" or "sesiones" find Sessions, "templates" finds Agent types. When a section was found by one of those words, the word shows next to its name.

The list of shortcuts opens with **?**, with the keyboard icon at the top of the menu, with the **Keyboard shortcuts** button of Home and with the action of the palette.

| Keys | What it does |
|---|---|
| **Ctrl K** (**⌘ K**) | Open or close the command palette |
| **Ctrl B** (**⌘ B**) | Collapse or expand the menu |
| **Ctrl .** (**⌘ .**) | Open the agent with the latest unread notice |
| **?** | Show the list of shortcuts (outside text fields) |
| **Ctrl `** | Show or hide the terminal |
| **Esc** | Close the open panel |
| **Ctrl Enter** (**⌘ Enter**) | Send or run in editors |

On a Mac only **⌘** works (Ctrl stays for the terminal). The first three work while you type in the chat box or a search field, but not inside a terminal, the Markdown editor or a code or query editor, where those keys keep their own meaning (Ctrl+B is bold there); **Ctrl `** works everywhere. **?** is typed as a normal character inside a text field. With a dialog open the shortcuts wait until it closes, except **Ctrl K**, which closes the palette.

## Your first agent

You are going to create an agent, give it a working folder and send it a message.

1. Go to **Colony** in the menu, click **New** (top right) and choose **New agent**. You can also click **Add agent** on the dotted hexagon of a colony: that way the agent is created inside that colony.
2. Choose how to start:
   - A **type** from the list: it fills in provider, model, instructions and skills for you.
   - **Blank agent** ("Configure everything yourself."): you start with nothing.

   ![The New agent panel with the list of types and Blank agent](img/agente-nuevo-tipos.jpg)

   *Step 1 of the **New agent** panel: three sample types (Builder, Reviewer, Queen) and the **Blank agent** option. Each type shows its provider on the right.*

3. Fill in the form:
   - **Name**: short and unique. Orchestrators address workers by this name.
   - **What is it for?**: one line. Orchestrators read it to decide who gets each task.
   - **Role**: **Worker** (does the work it receives) or **Orchestrator** (plans and delegates).
   - **Colony**: optional. A colony can lend it a folder, permissions, skills and context.
   - **Provider**: **Claude Code**, **OpenCode**, **Kiro** or **Cursor**. Each card shows whether it is installed (**installed**) or not (**not found**).
   - **Model**: the one you want to use. Left at the default, it uses the tool's own default.
   - **Working folder**: type it or click **Browse**. It is required, unless the agent follows its colony's folder.
   - **What can it do?** (permissions): **Read-only**, **Edit files** or **Full access**.

   ![The New agent form created from the Builder type](img/agente-nuevo-formulario.jpg)

   *Step 2: the form created from the "Builder" type. At the top are **Name**, **What is it for?**, **Role** and **Colony**. Below them are the provider cards. At the bottom, **Back** and **Create agent**.*

4. Click **Create agent**. A notice appears with the name of the new agent.
5. Open its chat: select its hexagon in **Colony** and click **Open chat**, or go in from **Agents**.
6. Type a message in the field at the bottom and press Enter (Shift+Enter inserts a new line).

![The conversation with the agent Queen](img/chat-conversacion.jpg)

*An agent's chat (here Queen). At the top, its status and statistics bar. In the middle, the conversation. At the bottom, the field for typing, with the button to attach files.*

> **Tip:** start with **Read-only** if you want the agent to explore your project without touching anything. Once you trust it, move up to **Edit files**. **Full access** runs any command without asking: use it only in trusted or disposable folders.

> **Note:** the provider and the model are never inherited from the colony: you always choose them per agent.

### What if something fails

- If you click **Create agent** without a folder, the form asks you to pick one (or to put the agent in a colony that provides one).
- If the provider shows as **not found**, the tool is not in hive-am's `PATH`. See [chapter 14](14-troubleshooting.md).

Next: [The colony](02-the-colony.md)
