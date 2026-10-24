# hive-am diagrams

> 🇪🇸 [Leer en español](../es/README.md)

Ten diagrams of how hive-am works inside. Each page follows one real path through the code (a chat message, a turn, a delegation, a wake-up...) and maps every step to a file, a function and a line, says which test script covers that path and lists its edge cases. The [reference](../../reference/en/README.md) explains each piece; these pages show how the pieces connect.

Lines checked against commit `60f69d8`. Line numbers move as the code changes: when one does not match, search the file for the function or symbol named next to it.

## Diagrams

7. [Source map of `server/src`](07-server-source-map.md): one line per file, "to change this, open that".
8. [Data model](08-data-model.md): the SQLite tables, their relations and the migration that created each one.

## How to read a page

- Every page has the same sections: what it shows and when to look at it, the diagram, a **Step by step** table, the scripts that cover the path, edge cases and links.
- Paths are relative to the repository root. `server/src/runtime.ts:57` means line 57 of that file; the function or symbol in the next column is on that line or a few lines below.
- **Covered by** names scripts in `server/scripts/`. A script marked *no model* runs without any CLI or account; *starts a server* means it needs its own `HIVE_AM_PORT` (never 4400); *needs a real model* means it drives a real agent (it takes a provider argument). How to run them: [reference 12](../../reference/en/12-operations-and-troubleshooting.md).
- The diagrams are Mermaid blocks, which GitHub draws. They simplify on purpose; the tables are exact.
