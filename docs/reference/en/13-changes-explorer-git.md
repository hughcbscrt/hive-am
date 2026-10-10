# 13. Changes explorer (git)

On each agent's screen, next to **Chat**, there is a **Changes** tab. It is a **file explorer** of the folder the agent works in: it shows **all** the files, highlights those with changes according to git and, when one is selected, shows its **diff** or its content. **Code is not edited** from there, but the usual git actions (commit, pull, push, fetch, branches) can be done and the **history** consulted; see [13.8](#138-git-actions-and-history).

## 13.1 What you see

```
┌ Chat | Changes (9) ───────────────────────────────────────────────────────────────┐
│ ⎇ main  9320d97 initial commit · 10 min ago      9 files changed +8 −3  🔒 ⟳     │
├───────────────────────────┬───────────────────────────────────────────────────────┤
│ [Filter files…]           │ a.txt  [Modified] [Unstaged] +3 −1                     │
│ [All files | Changed · 9] │                      [Diff|File] [Unified|Side by side] │
│ ▾ dir                  1  │  1  1    one                                            │
│     d.ts        +1 −1 R   │  2     − two                                            │
│   .gitignore              │     2  + TWO CHANGED                                    │
│   a.txt         +3 −1 M ◀ │  …                                                      │
│   b.txt         +0 −1 D   │                                                         │
│   img.png             M   │                                                         │
│   new.txt       +2 −0 U   │                                                         │
└───────────────────────────┴───────────────────────────────────────────────────────┘
```

### Top bar

| Element | Meaning |
|---|---|
| `⎇ main  9320d97 ⌄` | Compact **branch badge**: branch (with an ellipsis if very long) + short hash + `↑n ↓n` if there are commits ahead of / behind the remote branch. It is a button: pressing it **expands the detail** (see below). With a detached branch it shows "detached at `<sha>`"; with no commits, "no commits yet" |
| `N files changed +A −D` | Summary of changes against the last commit |
| **Branches · Fetch · Pull · Push · Commit** | Git actions ([13.8](#138-git-actions-and-history)) |
| ⟳ | Refresh (the *tooltip* shows the time of the last read) |

If the agent works in a **subfolder** of the repository, everything is limited to that subfolder and a notice is shown ("Showing only `sub/`…").

**Expandable detail of the branch and the last commit.** Below the bar, with full text that wraps onto several lines (so a long branch name or message is not cut off): branch (with a button to copy it), remote branch and its state (in sync / ahead and behind / no remote branch), hash of the last commit (with a button to copy it), **full message**, author and when. It closes by pressing the badge again.

### File tree (left)

- It shows **all the files git knows about** in the agent's folder: the tracked ones plus new untracked ones, **without** those ignored by `.gitignore` (which is why `node_modules` does not appear). Deleted files still appear, marked.
- **Highlighting:** each file with changes carries a color bar on the left, a tinted background, its name in bold, the status letter and, if known, `+added −removed`. Folders that contain changes have a colored icon and a counter.
- **Ignored files:** what `.gitignore` hides (`node_modules/`, `build/`, `.env`, `*.log`…) also appears, **dimmed and in italics**, and can be opened and read (the preview carries the **Ignored** label and does not offer Blame). An ignored folder is **a single entry** that is listed **one level at a time when opened** (`GET …/git/ls?path=`), because it can contain tens of thousands of files; `GET …/git/tree` returns in `ignored` only the top-most entries. That listing is limited to folders git ignores (otherwise 400) and to the agent's folder, without `.git` or `..`. It can be turned off in **Settings → Show ignored files** (saved in this browser). Ignored files do not count as changes, do not show in "Changed", and the search only finds those already listed. Note: since they are files in the agent's folder, **the content of a `.env` is shown on screen** like any other file.
- **Filters:** a path search box (expands all matching branches) and the **All files / Changed · N** selector.
- **Folders:** chains of folders with a single child are compacted (`src/components`). When opened, the folders leading to some change are expanded; if the tree is small (≤ 40 files), all of them. Folders that **appear with new changes** while the agent works open by themselves.
- **Keyboard:** `↑` `↓` move the focus, `→` `←` open and close folders.
- The first file with changes is selected automatically.

### Statuses

| Letter | Status | Color | When |
|---|---|---|---|
| **M** | Modified | amber | The file changed |
| **A** | Added | green | New and already staged |
| **U** | Untracked | green | New and not yet added to git |
| **D** | Deleted | red (struck through) | Removed |
| **R** | Renamed | blue | Moved/renamed (even with edits) |
| **!** | Conflict | red | *Merge* conflict |
| **T** | Type changed | violet | File ↔ symbolic link, etc. |

The preview also indicates whether the change is **Staged** and/or **Unstaged**. Diffs are always computed against the **last commit** (`HEAD`; if the repository has no commits yet, against the empty tree): they include what is staged and what is not.

### Preview (right)

| Case | What it shows |
|---|---|
| File with text changes | **Diff** tab (default), in **Unified** or **Side by side** view, with line numbers and block headers (`@@ -1,4 +1,5 @@`) |
| File without changes | **File** tab: its content with line numbers |
| **File** tab of a file with changes | Marks of what changed since the last commit: **green** for added lines, **blue** for modified ones (those that replace removed ones) and a **red line with an arrow** between two lines where lines were removed (at the end of the file, under the last line). In a **new** file, everything green. The line-number margin carries a bar of the same color. **Pressing a mark** (the line number, or the tinted line without selecting text) opens right below it the **change block**: a diff of the block with its context lines and, in the header, a counter ("2 of 5") with two arrows to go to the **previous change** and the **next** one (also `Alt+↑` / `Alt+↓`): the file scrolls by itself to that change and its block opens. The arrows are disabled at the first and the last. It closes with the X or `Esc`. Pressing the same mark again closes it. To make clear **which block** it is, the lines it covers (from its first to its last changed line, without the context) are **shaded in amber with a bar in the margin** and the title says "Change block · lines 2–10"; the panel is placed **below the last line of the block** so as not to cover it (if the block is very long, more than ~25 lines from where you pressed, it is placed under the pressed line so it stays in view). The panel does not move the rows: it is drawn over the following ones and scrolls with the file |
| Image (png, jpg, gif, webp, svg, ico, bmp, avif) | The image on a checkerboard background (also if it was modified) |
| Binary file | "Binary file" notice (no text to show) |
| Deleted file | In **File**, the version from the last commit with a notice |
| Renamed file | "Renamed from `old/path`" notice and the diff between both |
| New untracked file | The whole content as added lines |
| Change without text (e.g. only permissions) | "No textual differences…" |

**Block headers.** Each block of a diff starts with a separator row (`⋯ ⋯ @@ -20,9 +20,10 @@`) without line numbers. Git adds the text of the nearest line above the block that "looks like" a function; it is only shown, in gray italics, in **code** files (in Markdown, YAML, JSON, INI, XML, Dockerfile and Makefile it means nothing and would look like an added line, so it is hidden).

Also: **Copy path** button, a notice when the diff or the file was trimmed for size. Long diffs and files scroll without a row limit (see [13.11](#1311-performance-with-large-files)).

## 13.2 When it is updated

| Moment | What is refreshed |
|---|---|
| When opening the agent screen | The **status** (feeds the tab's badge) |
| When opening the **Changes** tab | Status + file tree |
| When an agent turn finishes | Status (and tree if the tab is open) |
| **Every 5 s** while the agent works and the tab is open | Status + tree |
| ⟳ button | Everything |
| Changing the agent's effective folder | What was loaded is discarded and read again |

The **chat stays mounted** (just hidden) when you are in Changes: a half-written message and the scroll position are kept when you come back.

## 13.3 Cases without a repository

| Situation | Message |
|---|---|
| The folder is not a git repository | "This folder isn't a git repository — run `git init` in `<path>` to see file changes here" |
| `git` is not installed / not in the server's `PATH` | "git isn't available" |
| Another git error (e.g. dubious ownership of the folder) | "Couldn't read the repository" with git's text |

## 13.4 Read API

All under `/api/agents/:id/git/…`, and always over the agent's **effective folder**.

| Route | Response |
|---|---|
| `GET …/git/status` | `{ isRepo, root, scope, branch, detached, head, upstream, changes[], truncated, generatedAt }` or `{ isRepo:false, reason, message, cwd }`. Each change: `path, oldPath?, status, staged, unstaged, additions, deletions, binary` |
| `GET …/git/tree` | `{ isRepo, root, scope, files[], truncated }` (up to 30,000 files) |
| `GET …/git/diff?path=<path>&old=<old path>` | `{ path, diff, truncated, binary }` — unified diff (up to 600,000 characters) |
| `GET …/git/file?path=<path>` | `{ path, size, binary, truncated, content, source: 'worktree' \| 'head' }` (up to 1 MB) |
| `GET …/git/raw?path=<path>` | The bytes of an **image** (up to 8 MB) for the preview's `<img>` |

Paths are **relative to the repository root**.

## 13.5 Security

**Reads** (explorer, diffs, history) write nothing and are designed not to interfere with the agent; the **actions** that write have their own rules in [13.8](#138-git-actions-and-history). About reads:

- It **writes nothing** to the repository. All calls are read commands (`status`, `diff`, `ls-files`, `show`, `rev-parse`, `log`, `rev-list`). `GIT_OPTIONAL_LOCKS=0` prevents `git status` from touching the index while the agent uses git.
- It runs with `execFile` (**no shell**); paths always go after `--`.
- **Paths are validated**: they cannot be absolute or contain `..` or null bytes; they must stay **inside the agent's folder**, also checked with the real path (a symbolic link pointing outside is rejected). Any path that includes `.git` is rejected (its `config` can contain URLs with credentials).
- The headers of diffs of new files are rewritten so as **not to expose absolute paths**.
- Images are served with `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`, so an SVG never runs scripts.
- Maximum time per git command: 20 s; maximum sizes described above.

Remember that, like the rest of the API, it has **no authentication** ([document 12](12-operations-and-troubleshooting.md)).

## 13.6 Files

| File | Responsibility |
|---|---|
| `server/src/git/repo.ts` | Reading: `gitStatus`, `gitTree`, `gitDiff`, `gitFile`, `gitImagePath`; path validation |
| `server/src/api.ts` | The `…/git/*` routes (the `raw` one writes its own binary response) |
| `web/lib/git/useGit.ts` | Hook: status, tree, refresh and *polling* |
| `web/lib/git/gitTree.ts` | Builds the tree, compacts folders, filters and flattens rows |
| `web/lib/git/diff.ts` | Unified diff parser and pairing for the side-by-side view |
| `web/components/git/GitExplorer.tsx` | Bar, tree, preview and commit view |
| `web/components/git/ConflictResolver.tsx` · `web/lib/git/conflicts.ts` | Conflict resolver and the analysis/application of blocks |
| `web/components/git/CodeEditor.tsx` · `Code.tsx` · `GitSettings.tsx` · `web/lib/git/highlight.ts` · `web/lib/git/gitPrefs.ts` | Editor with highlighting, highlighted code, view settings, highlighter and preferences |
| `web/components/git/StatusLetter.tsx` · `web/lib/useDismiss.ts` | Shared pieces: the status letter (M/A/D/R/U/!/T) and closing popovers with an outside click or Esc (also used by `HelpPopover`) |
| `web/components/agents/useAgentSettings.tsx` · `DeleteAgentModal.tsx` | Editing and deleting an agent, shared by the chat and Colony |
| `web/components/git/GitActions.tsx` | Fetch/Pull/Push/Commit buttons, branch menu, commit dialog, history list |
| `server/src/git/ops.ts` | History, branches and the actions that write (commit, pull, push, fetch, switch, merge) |
| `web/app/agents/[id]/page.tsx` | **Chat / Changes** tabs and the badge |

## 13.7 Known limits

- It shows diffs against `HEAD`: it does not visually separate what is staged from what is not (it only indicates it with a label). A commit chooses whole files, not single lines.
- No syntax-aware or word-level diffs.
- Renames are detected with git's similarity heuristic (`-M`).
- No *cherry-pick* or interactive *rebase*; it does no *force push*. A file, a block or **single lines** inside a block can be discarded (only in the Unified view).
- In huge repositories the tree is trimmed to 30,000 files and the visible list to 2,000 rows (a notice is shown; the filter lets you reach the rest).
- Submodules appear as a single entry.

## 13.8 Git actions and history

Next to the changes summary, the bar offers **Branches**, **Fetch**, **Pull**, **Push** and **Commit**. Pull and Push show a counter (`↓n` / `↑n`) with the commits to bring in or to send; Commit shows how many files have changes. While an action runs, the buttons are disabled and the icon spins. When it finishes a notice appears (with the last line git printed) and the status is refreshed.

| Action | What it does | Details |
|---|---|---|
| **Commit** | Opens a dialog with the changed files (all checked), a message box and the **Commit** and **Commit & push** buttons (`Ctrl+Enter` confirms) | Only what is **checked** is committed: `git add -A -- <paths>` and `git commit -m <message> -- <paths>` (in the repository's first commit, what was just added). Renames include the old path. The repository's *hooks* run. With a **merge in progress** (e.g. after resolving a conflict) git does not accept partial commits, so everything that is staged is committed. |
| **Fetch** | `git fetch --all --prune` | Does not touch your files |
| **Pull** | `git pull --ff-only --no-edit` | Fast-forward only. If the branches **diverged**, the notice offers **Pull with merge** and **Pull with rebase** |
| **Push** | `git push`; if the branch has no *upstream* yet, `git push -u origin <branch>` | Never `--force`. Disabled with a detached branch |
| **Branches** | Menu with search, **local** and **remote** branches, and a field to **create** a new branch from the current one | Click on a branch = switch branch, **smart if needed** ([13.13](#1313-smart-branch-switch-and-stashes)); a remote one becomes a local branch that tracks it. The merge icon asks for confirmation and runs `git merge --no-edit <branch>` |
| **Abort merge** | `git merge --abort` | Appears in the notice when a merge (or pull with merge) ends with **conflicts** |

If git fails (conflicts, credentials, local changes that prevent switching branch…), **git's text as is** is shown in a red notice that closes with the X.

**Agent working.** If the agent is in a turn, a warning appears ("…committing, pulling or switching branches now can collide with its edits"). Actions are **not blocked**: the decision is yours.

### History

The **History** tab (next to *Files*) lists the commits of the current branch, **30 per page** with **Load more**: subject, short hash, author, relative date and branch labels (`merge` if it is a merge commit). It reloads by itself when `HEAD` changes. Choosing a commit shows its full message, author, date, the list of files with `+/−` and each one's diff (unified or side by side). For a **merge** commit, the changes against its first parent are shown (what the merge brought in). It is light: only one page of commits is requested and, on demand, the diff of **one** file.

### API (writes and history)

| Route | Description |
|---|---|
| `GET …/git/log?skip=N` | `{ commits[], hasMore }` (30 per page) |
| `GET …/git/commit?sha=` | Detail of a commit: message, author, date, files (up to 500) |
| `GET …/git/commit-diff?sha=&path=&old=` | Diff of a file in that commit |
| `GET …/git/branches` | `{ current, local[], remote[] }` |
| `POST …/git/commit` | `{ message, paths[] }` |
| `POST …/git/fetch` · `…/pull` (`{ mode: 'ff-only' \| 'merge' \| 'rebase' }`) · `…/push` | |
| `POST …/git/switch` | `{ branch, create? }` |
| `POST …/git/merge` · `…/merge-abort` | `{ branch }` / no body |

Actions answer `{ ok: true, output }`; if git fails, `400` with `{ error }` (git's text).

### Security of the actions

- **No shell:** `execFile`; the message goes as the value of `-m`, paths after `--`, and branch names are validated with `git check-ref-format` (and cannot start with `-`). Paths go through the same validation as reads (inside the agent's folder, never `.git`).
- **Never `--force`**, never `--no-verify`, and `GIT_TERMINAL_PROMPT=0` + `ssh -o BatchMode=yes`: if credentials are missing, git fails instead of waiting.
- **Local origin:** since the API accepts any origin (open CORS), the write routes reject (`403`) requests with an `Origin` header that is not `localhost`/`127.0.0.1` or the same host. An external web page cannot launch a commit or a push.
- **One write at a time per repository:** a lock on the server prevents collisions from a double click or two tabs (`index.lock`).
- Maximum times: 30 s for local actions and 120 s for network ones.

## 13.9 Resolving conflicts

When a merge (or a *pull* with merge or rebase) leaves conflicts, a **"Merge in progress"** (or **"Rebase in progress"**) strip appears with the number of files in conflict and the **Abort merge** buttons (`merge --abort`, or `rebase --abort` if it is a rebase). Files in conflict carry the letter **!** and, when selected, the preview is the **resolver**:

- **One block per conflict**, with two columns: **Mine (current branch)** and **Remote (incoming)**, with the name of each side's branch. Each block offers **Keep mine**, **Keep remote** and **Keep both** (**mine first** or **remote first**). Decisions can be mixed: block 1 mine, block 2 from the remote, block 3 both.
- **Editable result.** Below is the whole file, always editable (with line numbers, the same highlighting and the same themes as the viewer). Each block button only rewrites its block in that text; anything can be corrected by hand (for example if "both" leaves repeated code). **There is no automatic detection of duplicates**: two functions with the same name may be structured differently and removing them without you deciding would be dangerous. Marker lines (`<<<<<<<`, `=======`, `>>>>>>>`) are painted in another color.
- **Keep all mine / Keep all remote** (`git checkout --ours|--theirs`): they take a whole side of the file; if that side had deleted it, the file is removed. It is the only option for binary or too-large files.
- **Mark as resolved:** saves the result and does `git add`. It is rejected if `<<<<<<<` / `>>>>>>>` markers remain.
- **Restore conflict:** `git checkout -m -- <file>` puts the markers back.
- In a **rebase** git swaps the sides: the resolver takes it into account ("mine" is always the side with your commits).
- With all conflicts resolved, the strip shows **Finish merge (commit)** (the message comes prefilled with git's) or **Continue rebase** (`git rebase --continue`).

API: `POST …/git/resolve-side` `{ path, side: 'ours'|'theirs' }`, `…/resolve` `{ path, content }`, `…/unresolve` `{ path }`, `…/rebase-continue`. They are only accepted on files that git really has in conflict, with the same path and origin validations as the other actions. The state (`state: 'merge'|'rebase'|null`, `mergeMsg`) comes in `GET …/git/status`.

## 13.10 Code view settings and blame

**Settings** (sliders icon in the bar, saved only in this browser: `localStorage` `hive-git-view`):

| Setting | Effect |
|---|---|
| **Theme** | Hive (follows the app), GitLab Light, GitLab Dark, Solarized Light/Dark, Monokai, Dracula. It changes the background, line numbers, added/removed colors and the syntax |
| **Show whitespace** | Spaces as `·` and tabs as `→`. The real character is kept (widths do not change); the marker is drawn on top with CSS |
| **Tab width** | 2, 4 or 8 |

The settings apply equally to the **file viewer**, to **diffs** (unified and side by side, also in the history), to the resolver's blocks and to the **result editor**, which is a transparent `<textarea>` over a highlighted layer (same font and *scroll*), so it looks identical to the viewer and keeps the native cursor and selection.

**Highlighting:** `highlight.js` (core + 26 languages, loaded with the rest of the code) in `web/lib/git/highlight.ts`; the language comes from the extension (or `Dockerfile`/`Makefile`). Each line of a diff is highlighted separately. Above 250,000 characters it is not highlighted.

**Blame:** in the **File** tab of a tracked file, the **Blame** button adds a column with the short hash, the author and the relative time on the first line of each run from the same commit (runs alternate in tone). Hovering shows the commit subject and date; clicking opens that commit in **History**. Lines without a commit say "Not committed". Up to 5,000 lines (a notice is shown). `GET …/git/blame?path=` returns `{ commits, lines[] (one hash per line), truncated }` (`git blame --porcelain -w`).

**Dates.** Throughout the viewer (blame, history, a commit's detail, branch information) dates are shown in the format of the interface language, in 24-hour time, in Spanish and in English. The server delivers dates in ISO 8601 and the interface formats them according to the language (`dateLocale()` in `web/lib/i18n/core.ts`, `fmtDate`/`fmtDateTime` in `web/lib/format.ts`). Relative times ("5 min ago") use the same `ago()` as the rest of the app.

## 13.11 Performance with large files

A file of thousands of lines (e.g. a `.pm` of 2,200 lines / 80 KB) must not hang the interface. That is why:

- **Virtualized rows** (`web/components/git/VirtualLines.tsx`): the file viewer and the resolver's editor only put the visible rows plus a margin in the DOM (~50 in total), with a fixed height of 20 px and no line wrapping. Opening a 2,185-line file went from ~2,200 table rows to ~56 rows. **Diffs** (unified and side by side, also in the history) work the same way: a diff of ~2,900 rows puts ~60 in the DOM. The 2,000-row limit and the "Show all" button no longer exist.
- **Highlighting off the main thread** (`web/lib/git/useHighlighted.ts`, `highlight.worker.ts`): up to 15,000 characters are highlighted instantly; above that, a *Web Worker* does it. While the worker works (and while you edit), each line that did not change keeps its colors —compared from the start and from the end of the file— and only the edited lines look uncolored for a moment. In the editor, highlighting waits for 150 ms of calm.
- **Cheap rows:** each row receives the "show whitespace" preference already resolved (`CodeCell`, without subscribing per row) and diffs use memoized rows.
- **Highlight limit:** 1.2 M characters (more than any file the server sends, 1 MB).

Measured in development mode with that file: scrolling 30,000 px averages ~23 ms per frame; in the editor, each keystroke went from ~350 ms to ~95 ms, of which ~65 ms belong to the browser's own `<textarea>` with 83 KB of text (a plain `<textarea>` of that size takes ~33 ms to update its value and recompute the layout). In a production build it is lower.

**Side by side with long lines.** To be able to virtualize, rows are not split into several lines: in the **Unified** view long lines are scrolled with the horizontal bar; in **Side by side** each half takes exactly half the screen and **both scroll together** sideways: the code of all rows slides the same amount while the line numbers stay fixed. Below the diff there is a horizontal bar (it appears only if some line does not fit in its half); the *trackpad*'s horizontal scrolling or `Shift` + wheel also moves it.

## 13.12 Discarding changes

Three levels, always against the **last commit** (`HEAD`):

| Where | What it discards | How |
|---|---|---|
| **Discard** button in the file header | All the changes of that file | Modified / deleted / type change: `git restore --source=HEAD --staged --worktree`. Renamed: restores the original name and removes the new one. New untracked: **deletes** it (`git clean -f`). New already staged: **deletes** it (`git rm -f`) |
| **Discard block** button in the header of each diff block (modified files only) | Only that block | The server recomputes the diff against `HEAD`, takes block N and applies it **in reverse** (`git apply -R --index`, and if the stage does not match, only the working tree). If the `@@ -a,b +c,d @@` header no longer matches block N (the file changed since it was drawn) it is rejected with "The file changed since it was shown" |
| Undo icon in the bar | Everything changed in the agent's folder | `git restore --source=HEAD --staged --worktree` and `git clean -f -d`. It asks for confirmation (see below). Disabled with a merge or rebase in progress |

**Single lines.** In the header of each block, **Select lines** (Unified view only, modified files) puts a checkbox on each `+` or `−` line of the block; they are marked with the checkbox or by clicking on the row. The header changes to **All · Discard N lines · Cancel**. When discarding, the server builds a patch with only what is marked: an **unmarked** added line becomes context (it stays) and an **unmarked** removed line is omitted from the patch (it stays removed); then it applies that patch in reverse (`git apply -R --index`, or only to the working tree). Example: in a block with `−l4 −l5 −l6 +L5 +L6 +NEW1 +NEW2`, marking `l4`, `NEW1` and `NEW2` recovers `l4` and removes the two new lines, and leaves the replacement `l5, l6 → L5, L6` as is. The position of each line is counted among the **changed** lines of the block (from 0) and the `@@` header is verified the same way as when discarding a block.

**What asks for confirmation.** (1) **Discard all changes** (undo icon of the bar) **always** asks, because it is the only thing that can throw away a lot of work with one click. The "Discard all changes?" modal says with numbers how many files with changes go back to the last commit, and —in a red box— how many **new files will be DELETED completely** (with their list, up to 8 and "+N more"), the total of lines (`+A −D`) and that "all of this is lost for good". (2) Discarding **a file** also **always** asks: if it is new, "Delete files completely?"; otherwise, "Discard this file's changes?", which says what will happen depending on the case (it goes back to the last commit with its `+A −D` lines, the deleted file is restored or the rename is undone) and that it cannot be undone. (3) A **block** or **single lines** run **instantly**. There is no backup copy in any case.

Files in **conflict** cannot be discarded: they are resolved with the resolver or the merge is aborted ([13.9](#139-resolving-conflicts)).

API: `POST …/git/discard` `{ path, oldPath? }`, `…/discard-hunk` `{ path, index, header }`, `…/discard-lines` `{ path, index, header, lines[] }`, `…/discard-all`. Same path and origin validations as the other actions.

**Measured with large files** (development mode; a 2,193-line / 83 KB file with ~730 modified lines):

| Case | Result |
|---|---|
| A single block of ~1,456 changed lines: select lines, "All", toggle one | 17–28 ms per action |
| Discarding 1,455 of those 1,456 lines (client + server + refresh) | ~134 ms |
| 145 small blocks: scroll / discard a block | ~4 ms per step / ~111 ms |
| 2.2 MB file with a 3.7 MB diff | opens in ~0.5 s, ~55 rows in the DOM |
| 2.2 MB file view | opens in ~0.8 s, scrolling ~4 ms per step |

**Limits with huge files:**
- **Diff:** the server cuts the diff at 600,000 characters and the interface warns ("the diff was too large and is shown only in part"). Since the last block may end up incomplete, in that case its discard block / select lines buttons are **hidden** (discarding on a cut block would apply the whole real block, not what is visible). The other blocks and the file's **Discard** button remain available.
- **File view:** only the first 1 MB is shown ("Large file — showing only the first part").
- **Blame:** up to 5,000 lines.
- **Highlighting:** files over 15,000 characters are highlighted in a worker; above 1.2 M characters they are not highlighted.

## 13.13 Smart branch switch and stashes

### Switching branch without losing what you have uncommitted

The switch is **direct, with no dialog** (like JetBrains' *smart checkout*). `git switch` already carries your changes to the other branch when none of the files you modified is different between the two; when something collides, hive-am does the work for you. When you click on a branch, the server computes a **plan** (`GET …/git/switch-plan?branch=`): how many changes travel, which of your files are also different on the target branch (`overlap`), which **new** files of yours already exist there (`collisions`) and which **other agents are working right now in the same repository**.

- **Nothing collides:** a normal `git switch`. Notice: "Now on X; N changes came with you".
- **Something collides (`overlap` or `collisions`):** automatic **smart switch** (below). Same notice, and if a conflict needs resolving it says so ("— resolve the conflicts") and the strip appears.
- **A new file of yours that already exists on the other branch:** nothing is asked: **your version stays**, as a **modification** of that file (the notice says it: "`n.txt` already existed there: your version was kept"). The other version is one "Discard" away, and the diff against it is visible in the file itself.
- **The only thing it asks:** if **another agent is working right now** in the repository (or this same agent is in a turn), a short notice —"…switching branches changes the files it is editing"— with **Switch anyway**. Agents that share the **repository** are counted, even if they work in different subfolders.
- There is no "force switch": to throw away all changes there is **Discard all changes**, with its explicit modal.

**Smart switch** (`POST …/git/switch-smart` `{ branch }`): (1) `git stash push -u -m "hive-am smart switch: A -> B"` (includes new files); (2) `git switch B` (if it fails, the stash is reapplied and the error is returned); (3) it removes from the target branch the copies of the files that collide so that git can restore yours; (4) `git stash pop`. A conflict when reapplying **is not an error**: the files are left with markers, the stash is kept and the strip **"Smart switch in progress A → B"** appears.

- **Resolve:** with the usual resolver (here "Mine" are your saved changes and "Other branch" the other). With everything resolved, **Finish** removes the *stage* (a reapplied stash is not staged) and deletes the stash (`POST …/git/smart-finish`).
- **Cancel smart switch** (`…/smart-cancel`, with confirmation): deletes the new files that the reapplication already restored, `git reset --hard`, goes back to the original branch and reapplies the stash: your changes are left **exactly as they were**. What you edited while resolving is lost.
- If something fails halfway the stash is kept and the message says where it is (that is why it has a clear name).

### Stash manager

**Stashes · N** tab (next to Files and History). It lists each stash (message, branch, when; those from a smart switch carry the "smart switch" label) and on the right shows its files —also the **new** ones— with the diff. Buttons: **Save changes to stash** (with an optional message; includes new files and leaves the tree clean), **Apply** (keeps the stash), **Apply and delete** and **Delete** (with explicit confirmation). A conflict when applying is resolved with the resolver. Each operation receives the stash's hash (not its position) and is rejected if it no longer exists.

API: `GET …/git/stashes`, `…/git/stash?sha=`; `POST …/git/switch-smart`, `…/smart-finish`, `…/smart-cancel`, `…/stash-save`, `…/stash-apply` `{ sha, pop }`, `…/stash-drop`. State in `GET …/git/status`: `state: 'stash'` and `stash: { ref, sha, from, to }`. The same protections as always (paths inside the folder, local origin, one write at a time).

**Limits:** a reapplied stash does not keep the *stage* (everything ends up unstaged); the agents warning counts only those **working** at that moment that share the repository; files ignored by `.gitignore` do not travel with the stash.

**What counts as "a change" when walking through them.** git groups into one block (*hunk*) the changes that are less than 7 lines apart, so a file with many runs of changed lines can come out with few blocks. Editors walk through individual changes, and the viewer does the same: a **change** is a **run of added/removed lines**. Also, **all diffs are computed with git's `--histogram` algorithm** (instead of the default `Myers`): it aligns lines the way JetBrains does and splits changes the same way. Example measured with a Go file: with the default algorithm there were 23 runs and 4 git blocks; with histogram there are **16** changes (JetBrains counts 16; VS Code, with another algorithm, 12). The same algorithm is used in the `+/−` counts, in the history, in the blocks that are discarded and in the panel, which shows each change with up to 3 lines of context —only unchanged lines: the context **is cut where the neighboring change starts**, so lines added or removed from another change never appear and it is clear which one the visible content belongs to— and the title with the exact lines.

## 13.14 Tags, compare, search and other versions

Everything here is **read-only**: the working folder is never touched. Every branch, tag or commit that comes from the browser is first resolved to a commit (`rev-parse --verify`) and refused if it looks like an option, contains `..` or is not found.

- **Tags tab.** Lists the repository's tags (newest first, up to 1000, with search). Picking one shows its **Files** as they were at that tag (tree, highlighted reader, Markdown preview, pictures) and its **Changes** (the tag's commit). From there, **Create a branch here** makes a branch at the tag *without switching to it*.
- **Compare tab.** Two pickers (*From* → *To*) of branches, tags, remote branches or a pasted commit, with a swap button. Shows how many commits one is ahead/behind, the commits in between, the changed files and their diffs; changed pictures are shown before and after.
- **History filters.** Search by **message**, **author** or **content** (commits that added or removed that text, `git log -S`), pick a branch, a tag or *all branches*, or paste a hash to jump to it. **File history** (button in the file view) lists only the commits that touched that file, following renames, and opens that file in each commit.
- **View at…** (file view): the same file as it was at any branch, tag or commit, with a banner to go back to the current one.
- **Search in files.** In the Files tab, switch the filter from *Name* to *Content*: `git grep` over the working files (tracked and new, never ignored ones), up to 300 matches; clicking one opens the file at that line.
- **Branches.** Each local branch has a delete button (`git branch -d`: git refuses one with commits that are in no other branch, and the dialog then offers *Delete anyway*, `-D`). You cannot delete the branch you are on.
- **Keys.** `/` jumps to the filter; `Alt+1…5` switch tabs. The last file open is remembered per agent.

API (GET unless noted): `…/git/refs` (branches, remotes, tags), `…/git/tags`, `…/git/tag-tree?tag=`, `…/git/tag-file?tag=&path=`, `…/git/ref-file?ref=&path=`, `…/git/raw-at?ref=&path=` (pictures, served as inert images), `…/git/compare?base=&head=`, `…/git/compare-diff?base=&head=&path=`, `…/git/grep?q=&case=`, `…/git/log?skip=&q=&by=message|author|content&ref=&path=`; POST `…/git/branch-create` `{ branch, from }`, `…/git/branch-delete` `{ branch, force }`.

**Limits:** a tree is capped at 30 000 files, a tag list at 1000, a file at 1 MB, a comparison at 500 files and 100 commits. Pictures are read from git up to 20 MB. Measured on a repository with 3 200 files, 870 commits and about 700 tags, every call answers in well under half a second (a status takes about 0.4 s); repositories with hundreds of thousands of files were not measured.
