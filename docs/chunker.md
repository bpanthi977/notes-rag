# Chunker

Parses `.org` files into `Chunk` objects suitable for embedding and retrieval.

## Approach

Chunks are scoped to heading sections — the active heading hierarchy is prepended to each chunk's text, and accumulated text is always flushed at heading boundaries.

Within a section, consecutive paragraphs are merged until the combined size is just below `maxChunkChars`. Sections larger than the limit are split into overlapping windows (of size `overlap`, with word-boundary aligned) so context around split points is preserved.

`:PROPERTIES: … :END:` drawers are stripped and never appear in chunk text.

---

## Interface

### `Chunk`

```ts
interface Chunk {
  text: string;           // heading context + content, ready to embed
  headingContext: string; // " > "-joined heading path (may be empty)
  filePath: string;       // absolute path to the source .org file
  chunkIndex: number;     // zero-based index within the file
}
```

`text` is what gets embedded and stored. `headingContext` and `filePath` are available for display or filtering.

### `ChunkConfig`

```ts
interface ChunkConfig {
  maxChunkChars?: number;  // max characters per chunk (default: 800)
  overlap?: number;        // overlap between split windows in characters (default: 200)
}
```

Both fields are optional. Omitting the config entirely uses the defaults.

### `chunkFile(filePath: string, config?: ChunkConfig): Chunk[]`

Parses a single `.org` file and returns all chunks in order.
