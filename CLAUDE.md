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
│   ├── rag_ingest.ts   # Ingest org notes into the vector store (incremental)
│   ├── rag_query.ts    # Top-k retrieval + LLM answer generation
│   └── utils.ts        # Shared utilities (walkOrgFiles)
├── notes/              # User's .org files (created by user)
├── data/
│   └── vector-store.db # SQLite database (auto-created)
├── docs/
│   ├── chunker.md      # Chunker design and interface
│   ├── store.md        # Store design and interface (incremental indexing)
│   ├── rag_ingest.md   # Ingest design and interface (incremental indexing)
│   ├── rag_query.md    # Query design and interface (retrieval + LLM)
│   └── architecture.md # System overview doc (TODO: task 07)
├── tsconfig.json
└── package.json
```

## Rules

- Commit your code frequently.
  - At lease commit after each task is complete
  - Commits should be such that it is easier for human to review
  - Specify the files you are committing in `git add` because, other
	changes might be going on parallely by the user.

- After planning save the task specification and the plan
  inside docs/tasks/ with numbered filename (e.g. 01 setup project.md)

  After completion the tasks are moved to docs/tasks/done

  When asked to work on a task, just read that particular tasks file
  and other architecture files from docs/. Don't read other task files.

- Document architectural and design decisions inside docs/ and link
  those files in architecture section of CLAUDE.md
  - For each part of the architecture, don't go into implementation details but rather
	the ideas/approach of that part, and the interface (i.e. functions
	and types that other piece of code will use to interact with that part)
  - When you complete a task, update the documentation for the
	relevant part if necessary.

- When planning read the docs/ file before looking at the code because
  it has the overall idea and the interface documentation need to make
  plans.
