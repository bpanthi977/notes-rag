# REPL

Interactive question-answering loop over indexed notes (`src/index.ts`).

## Approach

On startup, opens the SQLite DB, prints current stats, and enters a readline loop. Special commands control ingestion and exit; any other input is treated as a question and answered via the RAG pipeline.

## Environment

- `OPENROUTER_API_KEY` — required; exits with an error message if missing
- `NOTES_DIR` — resolved in order:
  1. First non-flag CLI argument (`node index.js [--recursive] <path>`)
  2. Current working directory, if its name is `notes` or `Notes`
  3. `./notes` relative to the current working directory

- `--recursive` — optional flag; when present, subdirectories of the notes folder are also walked for `.org` files (default: shallow, top-level only)

  The resolved path is canonicalized via `fs.realpathSync()` (symlinks resolved) before use, so the CLI can be invoked from any directory and file paths stored in the DB remain consistent.

## Commands

| Input | Behavior |
|-------|----------|
| `:ingest` | Run `getFilesToIndex` + `ingestFiles`, print updated stats |
| `:clear` | Clear terminal, reset conversation history, re-display headline |
| `:quit` / `:exit` / Ctrl-C | Close DB and exit |
| anything else | Call `query()`, print the answer |

## UI

Feedback is provided via two elements implemented in `src/ui.ts`:

- **Spinner** — animates during query processing. Stops before streaming the LLM response so chunks are not corrupted.
- **Progress bar** — shown during `:ingest`. Displays a 30-char `#`/`.` bar, current file count, active stage (`chunking` → `embedding` → `storing`), and current filename.

## Example session

```
1240 chunks, 1240 embeddings indexed.
Commands: :ingest | :quit
> What is positional encoding?
[answer from LLM...]
> :quit
Bye!
```
