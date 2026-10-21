# 11. Frontend

Next.js 15 (App Router) + React 19 + TypeScript. Almost everything is a **client component** (`'use client'`): the interface depends on live state and the WebSocket, so server rendering is not used for data.

## 11.1 Screens

### Colony (`/`, `app/page.tsx`)

Swarm map and detail panel.

- **Header:** the title with a help icon (**?**) that opens a popover with "how to read the map" (closes with Esc, an outside click or the same icon), and a single **New** menu (agent, colony, resource).
- **Statistics:** agents, resources, orchestrators, working now and tasks in progress; each one is a **link** (to the agents list, the resources screen or the recent feed).
- **Loading and errors:** a skeleton while the API has not answered and, if it fails, an error banner with a *Retry* button (never an empty colony).
- **Honeycomb:** one hexagonal cell per agent, grouped by colony (see 11.2). Besides dragging, colonies (by their name) and free hexagons can be **moved with the arrow keys** (Shift for bigger steps).
- **Right panel:** when a cell is selected it shows description, provider, model, effective folder ("· from colony" if inherited), session, team (orchestrators), a **colony selector** (moves the agent), an **Open chat** button and, in the top right corner, the **settings** button that opens `AgentEditDrawer`.
- **Recent delegations:** the last 6, taken from the store (`dispatches`, refreshed by the WebSocket, no polling), with links to the agent and the session.

### Agents (`/agents`)

Table with search (name, description, folder), filters by role and provider, and columns: agent, provider · model, colony, effective folder, status and last update. The whole row is clickable **and reachable by keyboard** (Tab, then Enter or Space), and the table scrolls horizontally on a phone. Search, role and provider filters are remembered in the browser (`hive-am.agents.q`, `.role`, `.provider`). Different empty states for "no agents" and "no results".

### Agent (`/agents/<id>`)

Agent switcher + chat + collapsible settings (see [document 10](10-chat-and-display.md)). The header is a `WorkspaceHeader`. The settings panel and its tab live in the URL (`?tab=config|notebook|sessions`), so a link opens them; on screens wider than 1100 px the open panel reserves its width in the chat (it no longer covers it) and its width is dragged and remembered. In the header, the **Chat / Changes** control toggles between the conversation and the [git changes explorer](13-changes-explorer-git.md). The settings panel has two tabs:

- **Configuration:** the full `AgentForm` with a bottom bar *Save changes* / *Discard* and a *Delete agent* button (with confirmation).
- **Sessions:** conversations and delegated tasks.

Header: back to Colony, avatar, name, role, provider, model, status, **New conversation** (with confirmation) and **Settings**.

### Connections (`/connections`)
Cards of the external connections with their live status (refreshed every 5 s) and a side panel to create or edit them (closing it with unsaved changes asks first). Details in [document 14](14-external-connections.md).

### Types (`/types`)

Cards of types (role, provider, model, number of skills, number of agents that use it) with **Edit** (side panel) and **Create agent**. The editor includes provider selector, model, permissions, prompt (monospace, with a character counter) and skills.

### Skills (`/skills`)

List on the left (search and usage `N agents · M types`) and editor on the right (name, description, instructions with *Write/Preview* tabs). A *Delete* button with confirmation says how many agents/types it affects. Switching to another skill, or leaving, with unsaved changes asks for confirmation; a failed deletion shows an error notice.

### Relations (`/relations`)

React Flow canvas; see [document 9](09-orchestration-and-relations.md#relations-canvas-apprelationspagetsx).

### Sessions (`/sessions`)

List by day with search and a provider filter, and a transcript panel with an **Open agent** link. The chosen session is in the URL (`?session=<id>`). The transcript uses the chat's own blocks (`History`), so **tool calls and thinking are shown** and long messages are no longer folded.

## 11.2 The honeycomb (Colony map)

Implemented in `app/page.tsx`, with no charting libraries: absolutely positioned HTML cells and SVG layers.

**Geometry.** Pointy-top hexagons with radius `S = 74`; width `W = √3·S`, height `H = 2·S`. Positions come from **axial coordinates** walked in a spiral (ring 0, 1, 2…), with `x = W·(q + r/2)` and `y = 1.5·S·r`.

**Grouping.**

1. A *cluster* is created per colony and an extra "No colony" one for agents without a colony (omitted if empty and there are already agents).
2. Inside each cluster the order is: orchestrators first (center), then the workers they connect (`orderMembers`), then the rest. That way direct connections stay close.
3. A **ghost cell** "Add agent" is added to each cluster (creates the agent already inside that colony). An empty colony shows only that cell.
4. Clusters are arranged in rows (*shelf packing*) with a maximum row width of 880 px, spacing of 36 px, inner margin of 26 px and 50 px on top for the label.

**Colony outline (it only surrounds the hexagons).** For each cluster the polygons of its hexagons are drawn **twice** in an SVG under the cells: first with a wide stroke in the colony's color and rounded joins, then on top with a somewhat narrower stroke in the tinted background color. What sticks out is a continuous ring that follows the outer edge of the union; there is no need to compute the geometric union.

**Cells.** Buttons with a hexagonal `clip-path`. Border in the provider's color; orchestrator cells use the honey color. A pulsing dot indicates work; red if there is an error. A label with name and provider, and a `↑ name` / `↓ N` pill that indicates the relation.

**Relations.** SVG above the cells (see [document 9](09-orchestration-and-relations.md#colony-screen-apppagetsx)).

**Fit to screen.** A `ResizeObserver` measures the panel and scales the whole map with `transform: scale(k)` (`k ≤ 1`, never enlarges) so that it fits without horizontal scroll.

**Moving things and zoom.** A colony can be dragged by its name label, and a free agent or resource by its hexagon (a drag is told apart from a click by a 6 px threshold); the position is kept in this browser (`localStorage`, `hive-colony-layout`) as absolute canvas pixels, and a button puts everything back. The map has **zoom** (− / + buttons, Ctrl/⌘ + wheel, 40–250 %, kept in `hive-colony-zoom`) on top of the fit-to-screen scale; zoomed in, the panel scrolls.

**Hover/selection.** The state `focus = hover ?? selected` decides which cells and lines are highlighted or dimmed (`dim`, `linked`).

## 11.3 Global state (`lib/store.tsx`)

A single React context (`useHive()`), with no state libraries. It holds the data (agents, types, skills, colonies, providers), the connection state, the live turns and the `finished` counter. It also holds `dispatches` (the delegation log, reloaded when the WebSocket reports changes) and the load state: `ready` is `true` only after the API has answered, `error` carries the message and `retry()` tries again. It exposes `refresh([...])`, `agent(id)`, `clearLive(id)` and `onTurnEnd(listener)`: the listener runs outside React each time a streamed turn ends (a `status` event to `idle` or `error` for an agent with a live turn, the same condition that bumps `finished`), with the origin, the result and an excerpt read before the reducer drops the turn. `clearLive` dispatches its `status` with `silent: true`, so dismissing an error banner is not a turn end. For performance there are narrow hooks (`useHiveSelector`, `useHiveData`, `useLive`, `useFinished`, `useAgent`, `useHiveActions`); `useHive()` keeps its old shape. The WebSocket is `wss:` when the page is https. WebSocket details in [document 5](05-backend-frontend-communication.md#56-state-in-the-browser-libstoretsx).

Utility hooks in `web/lib/hooks/`:

| Hook | What it does |
|---|---|
| `usePolling(fn, ms, opts)` | Periodic call that never overlaps itself, pauses while the tab is hidden, backs off on errors and reports one error per streak |
| `usePersistentState(key, initial)` | State saved as JSON in `localStorage` (safe when storage is blocked; the first render uses the default) |
| `useQueryState(key, initial)` | State in the URL (`?tab=`) with `history.replaceState`: no reload and no history entries |
| `useUnsavedGuard(dirty)` | Warns before closing or reloading the tab with unsaved changes. Inside the app, drawers and panels ask with a `ConfirmDialog` before discarding them (no native `window.confirm`) |
| `useResizableWidth({ key, min, default, max, side })` | The width a drawer or panel is dragged to, remembered in `localStorage` (used by `Drawer` and the agent's settings panel) |

`lib/api.ts` throws `ApiError` (with `status`), accepts `{ signal, timeoutMs }` in each call and offers `isAbort(e)`. `lib/format.ts` has `fmtTime`, `fmtDate` and `fmtDateTime`, which use the app's language instead of the browser's.

### Unread notices (`lib/attention.tsx`, `lib/attentionRules.ts`)

`AttentionProvider` (inside `HiveProvider`, in `Shell`) listens to `onTurnEnd` and keeps one notice per agent, `{ kind: 'done' | 'error', at, snippet }`, in `localStorage` under `hive-am.unread` (synced between tabs with the `storage` event). It skips the agent on screen (route `/agents/<id>` with the tab visible) and delegated turns that ended well; it clears the notice of the agent on screen; once `ready` it prunes deleted agents, notices older than 7 days and keeps 100. `snippet` is the error, or the last text block, collapsed to one line and cut to 140 code points; it stays in this browser until the notice is read (**Mark all as read** empties the key). It also sets the tab title (`(N) hive-am`, kept with a `MutationObserver` if Next resets it), says new notices through a polite `.sr-only` live region (one message every 2 s at most) and, when `hive-am.notify` is `true` and the browser granted it, shows a `Notification` (tag = agent id, silent) while the tab is hidden or without focus. It reads the store with narrow selectors only, never `live`. `useAttention()` gives `unread`, `latest`, `markRead`, `markAll`, the notification state and `announce`; `useActivityPanel()` opens and closes the **Activity** panel (`components/ActivityPanel.tsx`, the first item of the rail foot, which is `sticky` at the bottom of the rail). The pure rules (`turnEnd`, `shouldRecord`, `pruneUnread`, `badgeOf`, `tabTitle`, `dotState`, `statusLine`) are tested by `server/scripts/test-web-attention.ts`. The dot on an avatar (`StatePip`) is honey and pulsing while working, red for an error status or an error notice, green for a `done` notice on an idle agent, and has its state as accessible name.

`lib/types.ts` **replicates by hand** the backend's types (`server/src/types.ts`). There is no shared package: if you change an API type, update both.

## 11.4 Shared components

| Component | Function |
|---|---|
| `Hex` | Hexagonal avatar with initials; provider color, or honey if orchestrator; sizes `sm`, normal, `lg` |
| `ProviderBadge`, `StatusChip`, `RoleChip` | Small labels for provider, status and role |
| `Dialog` / `Modal` / `Drawer` | One mechanism for layers (`Dialog.tsx`): rendered in a portal, the rest of the page becomes `inert` while one is open, a **global stack** (only the topmost reacts to Esc, so a modal over a drawer no longer closes both), focus trapped inside and returned to what opened it on close, and scroll of the page locked. The initial focus goes to the element with `data-autofocus` (otherwise the first control that is not the close button); an element that must stay active under a dialog carries `data-live`. `Modal` has a close button. The `Drawer` is **expandable**: an expand button in its header (560 px ↔ 1100 px), a draggable left edge (min. 420 px, max. screen − 80 px) and double-click to toggle; the width is remembered (`hive-am.drawerWidth`, via `useResizableWidth`) and shared by all panels |
| `ConfirmDialog` | Confirmation (`danger` puts the initial focus on Cancel): handles the busy state and, if the action fails, shows an error toast and stays open |
| `Tabs` / `TabPanel` | Tabs with ARIA roles, a roving tabindex and Left/Right/Home/End keys; the same `idPrefix` goes to both |
| `EmptyState`, `Banner`, `SearchInput`, `CheckRow` | The empty state (with `className`), the notice (with an optional `action` button, e.g. *Retry*), the search box (with `ref`, `autoFocus` and `onKeyDown`) and the checkbox row (`compact` for dense lists) |
| `WorkspaceHeader` | Header of the agent and resource screens: back link, avatar, title, one primary action and secondary ones that **collapse into the `Menu`** when the header itself is narrower than 760 px |
| `useCombobox` (`combobox.ts`) | Ids, `aria-activedescendant` and `aria-controls` for dropdown lists (`SkillPicker`, `PickSearch`, `Suggest`) |
| `MasterDetail` (`objects/`) | The list-and-detail layout shared by the resource screens |
| `objects/db/` and `objects/http/` | The database and HTTP resource screens split by responsibility: `DbWorkspace.tsx` keeps the state and the tabs and mounts `QueryPane`, `Results`, `SchemaPane`, `HistoryPane` and `NameModal` (pure SQL helpers in `dbSql.ts`); `HttpWorkspace.tsx` is a thin shell over the `useHttpWorkspace` hook (all state, effects and actions) and the presentational `HttpRequestList`, `HttpResponseView`, `HttpResponseTabs`, `HttpFileView`, `HttpHistoryPane` and `HttpSessionBlock` |
| `MemberPick` (`agents/`) | Picker of members used by the colony editor |
| `Field`, `Segmented` | Field with label, help and error (the label is tied to its `input`, `select`, `textarea` or `PasswordInput` with `useId`); segmented control |
| `ProviderPicker` | Three cards with an installed indicator |
| `ModelField` | Free text with provider suggestions |
| `PermissionField` | Segmented control with the explanation of the chosen permission |
| `SkillPicker` | List of skills with checkboxes (`.skillrow` + `.check`), reused for colony members and teams |
| `SkillPicker` (mode and weight) | Each chosen skill is a pill with its `always` / `on demand` button (chosen per agent, type or colony); below the picker, what always goes in the prompt is summed up |
| `NotebookPanel` | **Notebook** tab of the agent's settings: edits its memory (see 7.3.2) |
| `FolderPicker` | Path field + folder explorer (uses `GET /api/fs/dirs`) |
| `Toaster` / `useToast` | Transient notices: errors are announced (`role="alert"`), manual close, pause on hover or focus, identical notices are not repeated, at most 5 |
| `PathPicker` | Folder or file picker; it shows loading and, if `GET /api/fs/dirs` fails, the error with a *Retry* button |
| `AgentForm` | The single agent form (includes inheritance and *Team*); the types screen renders it with `mode="type"` |
| `ColonyEditor` | Colony editor + inheritance dialog |
| `NewAgentDrawer`, `AgentEditDrawer` | Create and edit agents in a side panel |

## 11.5 Styles and theme (`app/globals.css`)

A single CSS file, organized in commented sections (shell, primitives, hex, colony, table, workspace, chat, tools, statistics, colonies, canvas, picker…).

### Design tokens

Defined in `:root` and redefined for the dark theme (a single dark block, `:root[data-theme='dark']`):

| Group | Variables |
|---|---|
| Surfaces | `--bg`, `--bg-deep`, `--surface`, `--surface-2` |
| Text | `--ink`, `--ink-2`, `--muted` |
| Lines | `--line`, `--line-strong` |
| Accent | `--honey`, `--honey-ink`, `--honey-soft` (honey: orchestrators and primary actions) |
| Status | `--ok`, `--err`, `--err-soft`, `--err-ink` (error text), `--danger` (alias of `--err`) |
| Colors by meaning | `--cluster` (clusters), `--link-manager` (manager links), `--series-mix` (how much the chart series are mixed with the background in dark) |
| Layers | `--z-1` … `--z-6`, `--z-drop`, `--z-pop`, `--z-side`, `--z-menu`, `--z-dock`, `--z-card`, `--z-fullscreen`, `--z-dialog`, `--z-toast`, `--z-tooltip`: no raw `z-index` numbers in the CSS |
| Font size | `--fs-micro` (11), `--fs-caption` (11.5), `--fs-small` (12), `--fs-hint` (12.5), `--fs-ui` (13), `--fs-ui-lg` (13.5), `--fs-body` (14), `--fs-lead` (15) |
| Providers | `--p-claude`, `--p-opencode`, `--p-kiro` |
| Shape | `--radius`, `--radius-sm`, `--shadow` |
| Typography | `--font-display` (Bricolage Grotesque), `--font-body` (Hanken Grotesk), `--font-mono` (JetBrains Mono) |

### Light/dark theme

- `data-theme` attribute on `<html>`: `light` or `dark`. An inline script in `layout.tsx` sets it (and `lang`) **before the first paint** from `localStorage` or, without a saved choice, from `prefers-color-scheme` (which it keeps following), so a dark page never flashes light.
- The **Switch theme** button (sidebar, with `aria-pressed`) toggles and saves the choice in `localStorage` (`hive-theme`).
- Under it, the rail shows the version (`v1.7.0`, `.rail-ver`). `web/next.config.mjs` reads it from `web/package.json` (which `make release` bumps with the others) and bakes it in at build time as `NEXT_PUBLIC_HIVE_AM_VERSION`; with no version it shows nothing. Hidden under 760px.
- The contrast of `--muted` and `--ok` was raised to meet 4.5:1 for text in the light theme.
- The hexagons' initials are dark in the dark theme to keep contrast.

### Typography

Fonts are loaded with `next/font/google` in `layout.tsx`, so **the first build needs network access**; without it system fonts are used (the variables have a `fallback`).

### Responsive and accessibility

- Breakpoints: **1100 px** (columns stack) and **760 px** (the sidebar becomes a top bar).
- The sidebar (`Shell.tsx`, `.rail`) folds from 220 px to 64 px with its header button (`aria-expanded`, `aria-label` *Collapse the menu* / *Expand the menu*). The width is `--rail-w` on `.shell`; folded, each entry keeps its label as `aria-label` (with the count) and `title` (shown by the global tooltip), counts become badges (`99+` above 99) and EN/ES stack. The state is saved in `localStorage` (`hive-am.railCollapsed`) and the inline script of `layout.tsx` applies it as `data-rail` on `<html>` before the first paint, so a reload never flashes the wide sidebar; the width only animates after a click (`.rail-anim`). Under 760 px the folding is ignored and the button hidden.
- Visible focus on all controls (`:focus-visible`), `aria-label` on icon-only buttons, `aria-pressed`/`aria-current`/`aria-selected` on state controls, `role="dialog"` on panels and dialogs.
- `prefers-reduced-motion` disables animations and transitions.
- Global shortcuts (`lib/hotkeys.ts`, rules in `lib/hotkeyRules.ts`, tested by `server/scripts/test-web-hotkeys.ts`): one `keydown` on `window` in the bubbling phase (Ctrl+` of `lib/dock.tsx` stays in the capture phase). `Mod` is Ctrl, or ⌘ on a Mac (`metaKey` only; detected after mounting). **Mod K** opens or closes the command palette (`components/CommandPalette.tsx`, a `Dialog` with `useCombobox`; what it lists is `lib/paletteRules.ts`, tested by `test-web-palette.ts`), **Mod B** folds the rail, **Mod .** opens the latest unread notice (with none it says `attn.noUnread` in the live region) and **?** opens `ShortcutsSheet`. Ignored always with `isComposing`, `repeat`, `altKey` or `defaultPrevented`; Mod keys work in plain text fields but not inside `[data-hotkeys="own"]` (xterm, `MarkdownEditor`, `CodeEditor`, `SourceEditor`, `SqlEditor`, the database query pane), nor with a layer open (`dialogDepth() > 0`) except Mod K while the palette is the layer; **?** is ignored in fields, comboboxes, `own` areas, with a layer or a `[role="menu"]` open; `/` is left to the git explorer. Mark any new editor that has its own keys with `data-hotkeys="own"`. `lib/theme.ts` (`flipTheme`) and `chatHref()` of `lib/lastChat.ts` are shared by the rail and the palette.
- Dialogs trap and return focus; tabs, the file tree and the lists are used with the keyboard; the chat is a `role="log"`; table rows that open something are focusable.
- Utility classes replace repeated inline styles: `.cluster` (a wrapping row), `.stack-s`, `.stack-l`, `.gap-xs`, `.gap-m`, `.push-r`, `.ellipsis` and `.mt-*`, besides the older `.row`, `.col`, `.grow`, `.gap-s`, `.gap-l`.

### Convention and a lesson learned

Selectors are **global**: a generic class name can clash with another component. Four cases have been fixed:

| Clash | Symptom | Fix |
|---|---|---|
| `.shell` (the app layout) also used as a modifier of the Shell row | The Shell tool row became huge and empty | Renamed to `.is-shell` |
| `.empty` (empty state) used as a modifier of the selector's subtitle | The selector rows were deformed | Renamed to `.blank` |
| `.name-cell span` (description) also reached the `<span class="hex">` avatar | Illegible gray initials in the agents table | Scoped to `.name-cell > div > span` |
| `.split` (two-panel layout of Skills/Types, with `display: grid`) used as a modifier of the diff table | The explorer's "side by side" view ended up 340 px wide | Renamed to `.is-split` (and `.empty` → `.void`) |

**Practical rule:** before adding a modifier class, `grep` that the name does not already exist in `globals.css`; and scope descendant selectors (`>`) when they contain reusable components.

## 11.6 Performance

- The chat history is memoized (`History`), each markdown block too (`Md`, `Blocks`), and the text box keeps its own state.
- Components that only need data (chat, navigation, colony) read the narrow hooks of the store, so the streaming `live` state does not re-render them on every token.
- The map is computed with `useMemo` from agents and colonies.
- The relations canvas uses its own node state and only recomputes the layout when the agents change.

## 11.7 Data the interface expects

A summary of what each screen needs from the backend, for whoever touches the API:

| Screen | Endpoints |
|---|---|
| All | `GET /api/agents`, `/types`, `/skills`, `/colonies`, `/providers`, WebSocket |
| Colony | `GET /api/dispatches`; `PATCH /api/agents/:id` (move colony); `POST/PATCH/DELETE /api/colonies` |
| Agent | `GET …/history`, `…/stats`, `…/live`, `…/sessions`; `POST …/messages`, `…/stop`, `…/new-session`, `…/resume-session`; `PATCH/DELETE /api/agents/:id` |
| Types | `POST/PATCH/DELETE /api/types` |
| Skills | `GET /api/skills/usage`; `POST/PATCH/DELETE /api/skills` |
| Notebook | `GET/PUT /api/agents/:id/notebook` |
| Relations | `PUT /api/orchestrators/:id/workers` |
| Sessions | `GET /api/sessions`; `GET /api/agents/:id/history?session=` |
| Forms | `GET /api/providers/:p/models`; `GET /api/fs/dirs` |

## 11.8 Internationalization (i18n)

The whole interface is available in **English** and **Spanish**. The system is its own and small (no libraries) and lives in `web/lib/i18n/`.

### Language switch

- It is **at the top of the sidebar**, below the logo (`/icon.png`, the same as the favicon; hidden when the bar collapses): an `EN | ES` control (`LanguageSwitch` in `components/Shell.tsx`).
- The change is **immediate** and does not reload the page.
- **Nothing about the language appears in the URL**: the routes (`/agents`, `/relations`, …) are the same in both languages. The choice is stored only in `localStorage` (`hive-locale`).
- Initial language: the one saved in `localStorage`; if none, the browser's (`es*` → Spanish, anything else → English). `<html lang>` is also updated.
- Since the screens are client-side, on the first load the base English text is briefly visible before the saved language is applied.

### Pieces

| File | Function |
|---|---|
| `en.ts` | Flat catalog `{ 'dotted.key': 'Text' }`. **It is the source of all keys**: the `DictKey` and `MessageKey` types come from it. |
| `es.ts` | `Record<DictKey, string>`: if a key that exists in `en.ts` is missing (or an extra one is present), **`tsc` fails**. |
| `core.ts` | `translate(key, params?)`, `getLocale()`, `detectLocale()`, `intlLocale()` (tag for `Intl`/`toLocale*`) and `translateServerError()`. It keeps the current language in a module variable. |
| `index.tsx` | `I18nProvider` (state, persistence, `<html lang>`) and the `useI18n()` hook → `{ t, locale, setLocale }`. |

### How it is used

```tsx
const { t } = useI18n();
t('nav.agents')                              // "Agents" / "Agentes"
t('newAgent.created', { name: a.name })      // "{name} created" → "x creado"
t('chat.tools', { count: 3 })                // plural: "3 tools" / "3 herramientas"
```

- **Parameters:** `{name}` in the text is replaced by `params.name`.
- **Plurals:** if `params.count` is a number, `key_one` or `key_other` is used according to `Intl.PluralRules`; both must exist in the two catalogs. If the text must show the number with separators, an already formatted parameter is also passed (e.g. `n: fmtNum(...)`).
- **Dynamic keys:** allowed when all variants exist (`t(\`role.${role}\`)`, `t(\`status.${status}\`)`, `permission.<id>.label`, `provider.<id>.blurb`).
- **Outside components** (utilities such as `ago()`, the tools' `describe()`, validations): `translate` from `lib/i18n/core` is used at render time; the component that calls them uses `useI18n()` to re-render when the language changes. Memoized components that show translated text call `useI18n()` (context consumers update even inside `memo`).
- **Dates:** `intlLocale()` gives `es-MX` / `en-US` for `toLocaleDateString`.

### Server errors

The backend answers in English. `lib/api.ts` passes each message through `translateServerError()`, which recognizes it with a table of regular expressions (names and paths are kept as parameters) and returns the translated text. **Unrecognized** messages (for example, a CLI's *stderr*) are shown as is. The turn's own messages (`turn.error`) go through the same function.

### What is **not** translated

- Brand names: Claude Code, OpenCode, Kiro.
- Content created by the user or by the seed: names and descriptions of agents, types, skills and colonies.
- What the models say and the tools' output.
- The **instructions agents receive** (identity, team, delegation): they are text for the model and stay in English (`server/src/instructions.ts`).
- "Raw" tool names that have no label of their own (Grep, Glob, WebFetch…), which are shown as the CLI reports them.
- The document's `<title>` and description (`app/layout.tsx`), fixed to `hive-am`.

### Adding or changing a text

1. Write the key and its text in **`en.ts`** and its translation in **`es.ts`** (same key, same `{parameters}`).
2. Use it with `t('…')`. Do not write visible text directly in JSX, attributes (`placeholder`, `aria-label`, `title`), notices (`toast`) or validation messages.
3. Run `npm run typecheck`: it detects nonexistent keys and differences between catalogs.

Key convention: `<area>.<element>`, for example `agent.sessions.empty`, `colony.err.name`, `tool.k.path`. Shared texts live in `common.*`, `role.*`, `status.*` and `permission.*`.

### Adding a language

1. Create `web/lib/i18n/<code>.ts` with `Record<DictKey, string>`.
2. Add the code to `Locale` and to `LOCALES` in `core.ts`, and the dictionary to `dicts`; adjust `intlLocale()` and `detectLocale()`.
3. Plurals use `Intl.PluralRules`: if the language has more forms than `one`/`other`, extend `translate()`.

### Development note

With `next dev`, when the catalogs are edited, hot reloading restarts the `core.ts` module; `I18nProvider` re-synchronizes the language on every render so that the interface does not stay in a language different from the switch's.

## Agent information card (hover)

When hovering (or focusing with the keyboard) over an agent in the **side list** (expanded or collapsed) or on a cell of the **colony map**, a card appears with its information: name, role and status, description, current activity, provider and model, effective permissions, folder, colony, team (orchestrator) or who directs it (worker), session and last update.

- `web/components/agents/AgentCard.tsx`: hook `useAgentCard()` (returns `bind(id)` and `node`) and the card, rendered with `createPortal` in `<body>` and positioned to the right of the element (to the left if it does not fit).
- It opens after ~280 ms (no delay when moving from one agent to another), closes with `Esc`, scroll, resize, click or on leaving. It ignores touch pointers and is not shown on screens < 760 px.
- `web/lib/activity.ts`: `activity()` (formerly inside `AgentSwitcher`), shared with the list.
- The line under each name is `statusLine()` (`lib/attentionRules.ts`), the same in the list and in the **Now** section of the Activity panel: open delegations of the agent (`dispatches` with `from_id` = the agent, `queued` or `running`, the oldest first, targets that no longer exist left out), then `activity()`, then an unread `done` notice, then the error status, then the description. Delegations come from the store's `dispatches`, the 50 most recent. `.sw-sub` and `.sw-meta` are one line each (the model is cut before the time), so a row is about 72 px whatever its state; the group heading shows `.sg-unread` (`attn.group.unread`) and the folded list's heading a green or red dot.
