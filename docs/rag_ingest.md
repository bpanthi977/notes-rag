# RAG Ingest

Incremental ingestion of `.org` notes into the vector store.

## Approach

### Incremental Indexing

The ingestion process skips files that haven't changed since the last run. It uses the `file_index` table to track the `mtime_ms` (last-modified timestamp) of each file. 

1. Discovery: Walk the notes directory to find all `.org` files.
2. Cleanup: Compare found files against the database. If a file is in the database but no longer on disk, it is deleted from both `chunks` and `file_index` tables.
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

### `ingest(notesDir: string, db: Database, client: OpenRouter, options?: IngestOptions): Promise<void>`

The main entry point for the ingestion pipeline.

```ts
interface IngestOptions {
  force?: boolean;                // Bypass mtime check and re-process all files
  embeddingModel?: string;        // The model to use (default: "openai/text-embedding-3-small")
  maxFilesForChunks?: number;     // Number of files to process in one batch (default: 50)
  maxChunksForEmbedding?: number; // Max chunks per embed() API call
}
```

### Flow summary:
1. `getFilesToIndex`: Scans directory, removes stale files, and identifies changed files.
2. For each batch of files:
   - Chunk and hash texts.
   - Fetch existing vectors from DB.
   - Embed remaining texts via API.
   - `upsertFileChunks`: Update `chunks` and `embeddings` tables.
   - `upsertFileIndex`: Update `file_index` with new `mtime_ms`.
3. Log summary of processed files, chunks, and API calls saved.
