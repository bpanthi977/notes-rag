# RAG System Plan

## Context
Building a local RAG (Retrieval-Augmented Generation) system over personal `.org` notes. The system will ingest notes into a SQLite vector store, then answer questions via an interactive REPL by retrieving relevant chunks and prompting an LLM via OpenRouter.

---

## Architecture

```
/Users/bpanthi977/Dev/rag/
├── src/
│   ├── index.ts        # Interactive REPL entry point
│   ├── chunker.ts      # Parse .org files → paragraph chunks (with overlap)
│   ├── embeddings.ts   # OpenRouter embedding API calls
│   ├── store.ts        # SQLite: store/load chunks + embedding vectors
│   └── rag.ts          # Top-k retrieval + LLM answer generation
├── notes/              # User's .org files (created by user)
├── data/
│   └── vector-store.db # SQLite database (auto-created)
├── docs/
│   └── architecture.md # System overview doc
├── tsconfig.json
└── package.json
```

## Rules

- Commit your code frequently.
  - At lease commit after each task is complete
  - Commits should be such that it is easier for human to review
  - Specify the files you are committing in `git add` because, other
	changes might be going on parallely by the user.
- When you are given a tasks save the task specification and the plan
  inside docs/tasks/ with numbered filename (e.g. 01 setup project.md)
- Document architectural and design decisions inside docs/ and link
  those files in architecture section of CLAUDE.md
