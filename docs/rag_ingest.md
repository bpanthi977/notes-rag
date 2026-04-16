# RAG Ingest

Incremental ingestion of `.org` and `.pdf` notes into the vector store.

## Approach

### Incremental Indexing

The ingestion process skips files that haven't changed since the last run. It uses the `file_index` table to track the `mtime_ms` (last-modified timestamp) of each file. 

1. Discovery: Walk the notes directory to find all `.org` and `.pdf` files.
2. Cleanup: Compare found files against the database (scoped to `notesDir` via `getFileIndex`). If a file within `notesDir` is in the database but no longer on disk, it is deleted from both `chunks` and `file_index` tables. Files indexed from other directories are not affected.
3. Change Detection: For each file on disk, check if its current `mtime_ms` differs from the one stored in `file_index`. If it's new or modified (or if `force` is true), it is marked for processing.

### Chunk-Level Embedding Reuse

To minimize API calls and costs, the system reuses embeddings at the chunk level.

1. Hashing: Each chunk's text is hashed using SHA-256.
2. Cache Lookup: Before calling the embedding API, the system queries the `chunks` and `embeddings` tables for these hashes.
3. Selective Embedding: Only chunks with hashes not found in the database are sent to the embedding API.
4. Deduplication: If multiple files (or different parts of the same file) contain the exact same chunk text, they will share the same embedding vector.

### Batching

Processing is done in batches (default 50 files) to balance memory usage and API efficiency. 

1. Files are chunked and hashed in a batch.
2. A single database query retrieves all existing embeddings for those hashes.
3. Uncached texts are sent to the embedding API (using the batch size defined in `src/embeddings.ts`).
4. Results are persisted to the database file-by-file within a transaction.

---

## Interface

### `getFilesToIndex(notesDir, db, force?, recursive?): FileInfo[]`

Scans the notes directory, removes stale (deleted) files from the DB, and returns the list of files that need (re-)indexing.

```ts
interface FileInfo { filePath: string; mtime: number }

getFilesToIndex(notesDir: string, db: Database, force?: boolean, recursive?: boolean): FileInfo[]
// force=true bypasses mtime check and returns all files
// recursive=true walks subdirectories (default: false, top-level only)
```

### `ingestFiles(filesToIndex, db, client, options?): Promise<void>`

Embeds and persists a list of files (as returned by `getFilesToIndex`).

```ts
interface IngestOptions {
  embeddingModel?: string;        // default: DEFAULT_EMBEDDING_MODEL
  maxFilesForChunks?: number;     // files per batch (default: 50)
  maxChunksForEmbedding?: number; // max chunks per embed() API call (default: 100)
}
```

### Flow summary:
1. Call `getFilesToIndex` to scan for changes and clean up deleted files from db.
2. Pass the result to `ingestFiles`, which processes in batches:
   - Chunk and hash texts.
   - Fetch existing vectors from DB.
   - Embed uncached chunks via API.
   - `upsertFileChunks`: Update `chunks` and `embeddings` tables.
   - `upsertFileIndex`: Update `file_index` with new `mtime_ms`.
3. Logs summary: files, chunks, reused vs new embeddings.
