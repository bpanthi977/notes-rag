import { EmbeddingClient } from "./providers";
import { DEFAULT_EMBEDDING_CALL_BATCH_SIZE } from "./constants";

export interface EmbedOptions {
  batchSize?: number;
  onBatchDone?: (chunksEmbedded: number, totalChunks: number) => void;
}

export async function embed(
  texts: string[],
  client: EmbeddingClient,
  options?: EmbedOptions
): Promise<number[][]> {
  const batchSize = options?.batchSize ?? DEFAULT_EMBEDDING_CALL_BATCH_SIZE;
  const { onBatchDone } = options ?? {};
  const results: number[][] = [];
  let chunksEmbedded = 0;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchResults = await client.embed(batch);
    for (const vec of batchResults) {
      results.push(vec);
    }
    chunksEmbedded += batch.length;
    onBatchDone?.(chunksEmbedded, texts.length);
  }

  return results;
}
