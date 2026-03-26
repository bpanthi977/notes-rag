# RAG Query

Retrieves relevant chunks from the vector store and generates an answer using an LLM.

## Approach

### Retrieval

The question is embedded using the same model as the indexed chunks, then cosine similarity is computed in-memory against all stored vectors. The top-k chunks by score are selected.

```
sim(a, b) = dot(a, b) / (|a| * |b|)
```

No vector extension is needed — plain JS over Float32Arrays is fast enough for typical personal note collections.

### Chunk Ordering

Retrieved chunks are grouped by source file. Files are ordered by their best-scoring chunk (most relevant file first). Within each file, chunks are sorted by `chunkIndex` (document order). This preserves reading coherence when multiple adjacent chunks from the same file are retrieved.

### Answer Generation

Chunks are numbered `[1]`, `[2]`, ... in the order they appear in the context. The LLM is instructed to cite chunk numbers inline (e.g. `[1]`, `[2]`) and to answer only from the provided notes. After receiving the answer, cited numbers are parsed from the text and grouped by source file to produce a citation list.

---

## Interface

### `query(question, db, client, config?): Promise<QueryResult>`

```ts
interface QueryConfig {
  embeddingModel?: string; // default: DEFAULT_EMBEDDING_MODEL
  chatModel?: string;      // default: DEFAULT_CHAT_MODEL
  k?: number;              // number of chunks to retrieve (default: 5)
}

interface Citation {
  numbers: number[];  // citation numbers from the answer pointing to this file
  filePath: string;
}

interface QueryResult {
  answer: string;
  citations: Citation[];  // files referenced, in order of first appearance in the answer
}
```

### `formatCitationNumbers(numbers: number[]): string`

Formats an array of citation numbers as compact ranges: `[1, 2, 3]` → `[1-3]`, `[1, 3]` → `[1], [3]`.

### Flow summary:
1. Embed the question via `embed()`.
2. Load all vectors from DB via `getAllVectors()` and score by cosine similarity.
3. Take top-k chunks; fetch their text via `getChunkById()`.
4. Group by file, sort files by best score, sort chunks within each file by `chunkIndex`.
5. Assign sequential numbers `[1]`…`[k]` to chunks; build prompt instructing the LLM to cite inline.
6. Call the LLM via `client.chat.send()`.
7. Parse `[n]` citations from the answer; group by `filePath` in order of first appearance.
8. Return `{ answer, citations }`.
