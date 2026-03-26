# REPL

Interactive question-answering loop over indexed notes (`src/index.ts`).

## Approach

On startup, opens the SQLite DB, prints current stats, and enters a readline loop. Special commands control ingestion and exit; any other input is treated as a question and answered via the RAG pipeline.

## Environment

- `OPENROUTER_API_KEY` — required; exits with an error message if missing
- `NOTES_DIR` — resolved in order:
  1. First CLI argument (`node index.js <path>`)
  2. Current working directory, if its name is `notes` or `Notes`
  3. `./notes` relative to the current working directory

## Commands

| Input | Behavior |
|-------|----------|
| `:ingest` | Run `getFilesToIndex` + `ingestFiles`, print updated stats |
| `:quit` / `:exit` / Ctrl-C | Close DB and exit |
| anything else | Call `query()`, print the answer |

## Example session

```
1240 chunks, 1240 embeddings indexed.
Commands: :ingest | :quit
> What is positional encoding?
[answer from LLM...]
> :quit
Bye!
```
