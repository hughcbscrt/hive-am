# Telegram and Slack connections

A connection links a hive-am agent to a Telegram bot or a Slack app so you can talk to it from your phone or your workspace. Neither needs a public URL: hive-am asks Telegram for new messages, and opens its own connection to Slack. This chapter covers Telegram first; Slack has [its own section](#slack).

## How it works

- **A single conversation.** The connection is just an adapter. All messages from all threads and from hive-am's web chat share the agent's direct conversation. What you tell it on Telegram it remembers in the web chat, and the other way around.
- **The agent answers with `channel_reply`.** This is the tool it uses to reply to the thread of the message it is handling. Its normal text does **not** reach the Telegram chat.
- **While it works**, the bot shows "typing...". If the agent is busy, it tells you your message is queued.

![Connections screen with one connection called Store bot, agent Queen, status Off](img/conexiones-lista.jpg)

*The connections list. The card shows the name, the agent that answers (Queen), the platform, how many threads it has and its status (here **Off**). At the top right is **New connection**.*

## Create the bot in Telegram

1. In Telegram, open a conversation with **@BotFather**.
2. Send `/newbot` and follow the questions (the bot's name and username).
3. BotFather gives you a **token**. Copy it.

## Create the connection

1. Open **Connections** and click **New connection**.
2. Under **Platform**, leave **Telegram** (Slack appears as "Slack · soon" and cannot be chosen).
3. Enter a **Name**, a label for yourself (for example "Store bot").
4. Under **Agent that answers**, choose the agent.
5. Paste the **Bot token**.
6. Add the people who can message it directly (next section).
7. Click **Create connection**.

![Edit connection panel with Telegram platform, name, agent Queen, hidden bot token, people who can message it directly and group mode](img/conexion-editar.jpg)

*The connection panel. Point at **Agent that answers**, **Bot token** (it shows only the end of the saved token), **People (direct messages)**, and at the bottom the **Delete connection**, **Send test**, **Cancel** and **Save** buttons.*

> **Note:** the token is stored on this machine and is never shown again. When editing, leave it empty to keep the current one.

## People (direct messages)

The **People (direct messages)** list says who can message the bot privately. These people can also talk to it in groups that are **not** under **Allowed groups**; an allowed group follows its own rule (see [Groups](#groups)). Anyone else is only told their own Telegram id by the bot, at every message they send it.

### How to find a Telegram id

1. Save the connection and turn the bot on.
2. Message the bot from your Telegram account.
3. The bot replies with your id.
4. In the connection panel click **Add person**, enter the **Telegram id** and, if you want, the **Name (optional)**.
5. Click **Save**.

Each person has an **Admin** checkbox: they can reset the shared conversation with `/new`. Use **Remove** to take someone off the list. If the list is empty, nobody can message it directly.

## Groups

The form has three blocks: **People (direct messages)**, **Groups** (when it speaks and the names it answers to) and **Allowed groups** (which groups it admits, and who may talk in each).

In a private chat the bot always answers. For groups and topics, the **Groups** section lets you choose **When it speaks in a group**:

| Mode | What it does |
|---|---|
| **Only when called** | Answers when it is mentioned with @, someone replies to one of its messages, uses a command or says its name |
| **Listens and chimes in** | Reads everything that is written and speaks only when it has something useful to add |

- **Allowed groups:** click **Add group** and enter the group id (it usually starts with `-100`). Each allowed group has its own rule, and the agent's permissions apply to everyone it lets in. To find the id, mention the bot in the group: it replies with the chat id. A group that is not listed only admits the people in **People (direct messages)**.
- **Who can talk here:** under each allowed group choose **Everyone in it** (the default) or **Only these people**. With the second, add each person with **Add person** and their Telegram id (a number; anyone can see theirs with `/id` or by writing to the bot). Then:
  - only those people can talk to the agent in that group, in every topic. **People (direct messages)** does not open it: someone on that list who should talk there must be added to the group's list too;
  - someone on both lists keeps the **Admin** flag of **People (direct messages)** there, so they can use `/new`; the other people of the group are never admins;
  - anyone else is ignored. If they call the agent, the bot answers **at every message** that the group only admits its list, with their id and the group's, so you can add them. To keep a stranger from flooding the group, it sends at most 5 of these notices per person and 20 per group in a minute, and then stays silent;
  - with **Listens and chimes in**, their messages are not read at all: they do not reach the agent even as context;
  - with nobody listed, nobody can talk there;
  - a private chat does not change: being on a group's list gives no access by private message.
- **Names it answers to:** aliases separated by commas (for example "Morena, queen"). If someone writes one in a group, it counts as a mention.
- **Telegram hides group messages** that do not mention the bot (privacy mode). To use **Listens and chimes in**, send `/setprivacy` to @BotFather and choose **Disable**, then add the bot to each group again.

## Threads and muting

The connection panel lists the **Threads** (a private chat, a group or a group topic) with the last message and its activity. Each thread has a button to **Mute** or **Unmute**.

A muted thread does not wake the agent for general chatter. A mention, an alias, a reply to its message or a command does wake it. You can also mute from the chat:

| Command | Who | What it does |
|---|---|---|
| `/stop` | Any authorized person | Aborts the turn in progress |
| `/status` | Any authorized person | Shows agent, status, folder and queue |
| `/mute` and `/unmute` | Any authorized person | Mutes or unmutes the agent in that thread |
| `/new` | Admins only | Asks for confirmation (`/new confirm`) and resets the shared conversation |

The agent can also mute itself if someone asks it to.

## Files and images

- **Receiving files:** authorized people can send photos, documents, audio, voice notes and videos (up to 20 MB each and 5 per message). They are saved on your machine for 14 days and the agent opens them with its file tools. The agent cannot listen to audio or watch video. Turn it on or off with **Receive files**.
- **Seeing images:** many models do not accept images. This option lets you choose **With the agent's model** or **With another model** (for example Claude Haiku). With "another model", that model describes each image and the description travels with the message. **The image is sent to that provider.**
- **Sending files:** the agent sends files to the chat with `channel_send_file`, only from its working folder, the received-files folder or the temporary one. It never sends files such as `.env`, keys, databases or `.git` folders.

## Other settings

- **Bot language:** Spanish or English (the bot's notices).
- **If the agent finishes without replying:** **Tell the thread**, **Send its plain text** or **Do nothing**.
- **Reasoning effort:** **Agent default**, **Low**, **Medium**, **High**, **Extra high** or **Max**. It overrides the effort set on the agent, only for the turns of this connection; leave it on **Agent default** to use the agent's. **Low** answers a bit faster. With OpenCode the level becomes the variant its model has for it; if the model has none, the agent's own is used.
- **Active:** turn it off to stop the bot without deleting it.

## Statuses

Each card shows a status:

| Status | Meaning |
|---|---|
| **Connected** | The bot is active |
| **Connecting…** | It is starting up |
| **Problem** | Something failed (for example, an invalid token); the reason appears in the connection |
| **Off** | The connection is turned off |

## Send a test

With the connection saved and active, open its panel and click **Send test**. It checks the token and greets the allowed people. If it fails, you will see "The test failed" with the reason.

## Agent permissions

A **Read-only** agent cannot reply through a channel. If you try, the panel warns you and offers **Allow editing files**. With **Full access**, anyone on the list can make the agent run anything on your machine: hive-am shows a warning. More in [Permissions and security](13-permissions-and-security.md).

## Security

- It only answers authorized people (or groups).
- The token is never shown again, and the agent must not look for it or use it: it sends everything through hive-am's tools. This is an instruction to the model, not a technical barrier. If you suspect it leaked, generate a new one in @BotFather.
- Secrets are not shared over chat: before sending a text, the server blocks those that contain known keys or tokens.
- Messages from an external chat carry a header with their origin. In hive-am's web chat they appear as a channel bubble.

> **Tip:** if you share the agent with people you do not fully trust, use minimal permissions.

## Slack

A Slack connection works like a Telegram one (same single conversation, same allow list, same commands, files and reactions) with Slack's own habits. It also needs **no public URL**: hive-am opens a connection to Slack (Socket Mode) from your machine, so it works with hive-am running on your laptop. The agent answers only while that machine is on and hive-am is running.

### Create the Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps), **Create New App**, **From scratch**, give it a name and pick your workspace.
2. **Socket Mode**: turn it on. Slack asks you to create an **app-level token**: give it the `connections:write` scope and copy it (`xapp-…`).
3. **OAuth & Permissions**, **Bot Token Scopes**: add `app_mentions:read`, `channels:history`, `groups:history`, `im:history`, `mpim:history`, `chat:write`, `reactions:write`, `files:read`, `files:write`, `users:read`, `channels:read` and `groups:read`.
4. **Event Subscriptions**: turn them on and, under **Subscribe to bot events**, add `app_mention`, `message.channels`, `message.groups`, `message.im` and `message.mpim`. With Socket Mode no Request URL is needed.
5. **Slash Commands**: create one command, `/hive` (no URL needed with Socket Mode). You use it as `/hive status`, `/hive id`, `/hive new confirm`… Slack reserves names such as `/status` and `/mute`, which is why a single command is the simplest.
6. **App Home**: under **Show Tabs**, turn on the **Messages tab** and tick "Allow users to send Slash commands and messages from the messages tab", so people can write to the app by DM.
7. **Install App** to the workspace and copy the **Bot User OAuth Token** (`xoxb-…`).
8. In each channel where you want it, invite the app: `/invite @your-app`.

### Create the connection

In **Connections**, **New connection**, choose **Slack** and paste both tokens: **Bot token** (`xoxb-…`) and **App token** (`xapp-…`). Fill in the agent and the allowed people with their **Slack member id** (`U…`: open the person's profile, ⋮ menu, **Copy member ID**). The form says **Channels** and **Allowed channels** instead of groups. For whole channels, add their **channel id** (`C…`, at the bottom of the channel details). A channel can also be limited to some people with **Only these people**, listing their member ids (`U…`, or `W…` on Enterprise Grid); it works as in [Telegram groups](#groups) (only that list, not even **People (direct messages)**, and nobody if it is empty) and covers every thread of the channel. The notice to someone without access is posted in the thread of their message, so the whole channel sees it; that is why it has the same limit of 5 per person and 20 per channel in a minute. The platform of a saved connection cannot change.

### How it behaves in Slack

- **Threads.** Each conversation is a Slack thread. When someone writes to the agent in a channel, it answers **in a thread opened on that message**, and whoever keeps talking in that thread is talking to the agent (no need to mention it again). In a DM there are no threads.
- **Scheduled messages and reminders go to the channel**, not into the thread where they were asked.
- **No "typing…".** Slack has no such indicator for apps: nothing shows while the agent works, and the answer arrives when it is ready.
- **Commands** are the same as on Telegram (`new`, `stop`, `status`, `mute`, `unmute`, `help`, `id`), through `/hive <command>`. Slack sends no thread with a slash command, so the answer goes to the channel; to mute a single thread, write `@your-app /mute` inside it.
- **Reactions** use Slack's emoji; the agent can react with ✅, 🚀, 👀 and many more.

Next: [Resources](10-resources.md)
