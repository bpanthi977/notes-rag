# Store

Persists chunks and embedding vectors to SQLite, and tracks which files have been indexed.

## Approach

### Two-table chunk storage

Chunks and their embedding vectors are stored in separate tables linked by `chunk_id`. This keeps the schema clean: `chunks` holds text metadata, `embeddings` holds the binary vector blob. Deleting a chunk cascades to its embedding automatically.

### Incremental indexing via file_index

A `file_index` table tracks the last-modified timestamp (`mtime_ms`) of each indexed file. On re-ingest, files whose mtime hasn't changed are skipped entirely without reading or chunking them. Files that no longer exist on disk are detected by diffing the tracked set against the current directory, and their chunks are removed.

### Chunk-level embedding deduplication via content_hash

Each chunk row stores a `content_hash` (SHA-256 of `chunk.text`). Before deleting old rows for a re-indexed file, the ingest pipeline queries existing embeddings by hash. Chunks whose text is unchanged reuse the stored vector — no API call needed. Only new or modified chunks are sent to the embedding API.

This means editing a few paragraphs in a large file costs only a few embedding calls, not one per chunk in the file.

### Vector encoding

`Float32Array` values are stored as raw byte buffers (`BLOB`). This is compact and fast to deserialize — no JSON parsing, no base64 overhead.

---

## Interface

### `initDB(dbPath: string): Database`

Opens or creates the SQLite database at `dbPath`, creates all tables and indexes if absent, and returns the database handle.

### `upsertFileChunks(db, chunks: Chunk[], hashes: string[], vectors: number[][], model: string): void`

Deletes all existing rows for `chunks[0].filePath`, then inserts the new chunks with their `content_hash` values and embedding vectors in a single transaction.

### `getEmbeddingsByHashes(db, hashes: string[]): Map<string, Float32Array>`

Returns a map of `content_hash → vector` for any hashes that already have an embedding in the database. Used to reuse vectors for unchanged chunks before old rows are deleted.

### `getFileIndex(db, notesDir?: string): Map<string, number>`

Returns a map of `filePath → mtime_ms` for files tracked in `file_index`. If `notesDir` is provided, only files whose path matches `notesDir/*` (SQL GLOB) are returned.

### `upsertFileIndex(db, filePath: string, mtimeMs: number): void`

Records (or updates) the indexed mtime for a file. Called only after `upsertChunks` succeeds so that a failed embedding run leaves no stale index entry.

### `getAllVectors(db): { chunkId: number; vector: Float32Array }[]`

Returns all stored vectors with their chunk IDs. Used by the retrieval pipeline for in-memory cosine similarity scoring.

### `getChunkById(db, id: number): Chunk | undefined`

Fetches a single chunk by its primary key. Used to load chunk text after top-k retrieval.

### `getStats(db, notesDir?: string): { chunkCount: number; embeddingCount: number; indexedFileCount: number }`

Returns counts of indexed files, chunks, and embeddings in a single query. If `notesDir` is provided, all three counts are scoped to files matching `notesDir/*`.
