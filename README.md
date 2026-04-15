# notes-rag

Local RAG system for personal `.org` notes. Ingests notes into a SQLite vector store and answers questions interactively, citing sources inline.

## Features

- Incremental indexing — skips unchanged files using mtime and content hashing
- Heading-aware chunking with overlap for better context preservation
- In-memory cosine similarity retrieval (no external vector DB)
- Cited answers — LLM references chunks by number; `:sources` shows full text
- Conversation history maintained across turns in a session

## Setup

```bash
npm install
export OPENROUTER_API_KEY=your_key_here
npm start [--recursive] [<notes-dir>]
```

**Notes directory resolution** (in order of precedence):
1. CLI argument
2. `NOTES_DIR` environment variable
3. Current directory if named `notes` or `Notes`
4. `./notes` relative to current directory

## Usage

```
$ npm start ~/my-notes
Notes: /Users/you/my-notes
42/50 files indexed (8 stale), 1240 chunks, 1240 embeddings.
Commands: :ingest | :clear | :sources | :quit
> What is positional encoding?
Transformers inject position information via sinusoidal functions [1]. Common
variants include absolute and relative encodings [2].
Sources: [1-2] transformers.org
> :sources
[1] Positional encoding adds sinusoidal functions of different frequencies...
[2] Common variants include absolute and relative positional encodings...
> :quit
Bye!
```

| Command   | Effect |
|-----------|--------|
| `:ingest` | Re-index new or modified `.org` files |
| `:clear`  | Clear screen, reset conversation history |
| `:sources`| Show full text of chunks cited in the last answer |
| `:quit` / `:exit` | Exit |

## Configuration

| Item | Default |
|------|---------|
| Embedding model | `openai/text-embedding-3-small` |
| Chat model | `google/gemini-3.1-flash-lite-preview` |
| Chunk size | 800 chars |
| Chunk overlap | 200 chars |
| Top-k retrieval | 5 chunks |
| Database | `~/.cache/notes-rag/vector-store.db` |

## Tech Stack

TypeScript · SQLite (`better-sqlite3`) · OpenRouter SDK
