# Embeddings

Generates vector embeddings for text using the OpenRouter API.

## Approach

The `embed` function takes an array of text strings and an OpenRouter client. It sends these texts in batches to the OpenRouter embedding API, obtaining numerical vector representations. This approach includes handling potential batching and allows for model selection, optimizing API calls and ensuring efficient generation of embeddings.

## Interface

### `EmbedOptions`

```ts
interface EmbedOptions {
  batchSize?: number; // Optional: The number of texts to send per batch to the embedding API.
  model?: string;     // Optional: The specific embedding model to use.
}
```

### `embed(texts: string[], client: OpenRouter, options?: EmbedOptions): Promise<number[][]>`

An asynchronous function that generates embeddings for an array of text strings.

*   `texts`: An array of strings for which to generate embeddings.
*   `client`: An initialized `OpenRouter` client instance.
*   `options`: Optional configuration for the embedding process, including `batchSize` and `model`.

Returns a Promise that resolves to a 2D array of numbers, where each inner array is an embedding vector for a corresponding input text.