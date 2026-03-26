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

The ordered chunk texts are joined with `---` separators and sent to an LLM as context along with the question. The LLM returns a natural language answer grounded in the retrieved notes.

---

## Interface

### `query(question, db, client, config?): Promise<string>`

```ts
interface QueryConfig {
  embeddingModel?: string; // default: "openai/text-embedding-3-small"
  chatModel?: string;      // default: "anthropic/claude-3.5-haiku"
  k?: number;              // number of chunks to retrieve (default: 5)
}
```

### Flow summary:
1. Embed the question via `embed()`.
2. Load all vectors from DB via `getAllVectors()` and score by cosine similarity.
3. Take top-k chunks; fetch their text via `getChunkById()`.
4. Group by file, sort files by best score, sort chunks within each file by `chunkIndex`.
5. Build prompt with retrieved context and call the LLM via `client.chat.send()`.
6. Return the answer string.
