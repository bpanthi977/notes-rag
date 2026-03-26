import { OpenRouter } from "@openrouter/sdk";
import { DEFAULT_EMBEDDING_CALL_BATCH_SIZE, DEFAULT_EMBEDDING_MODEL } from "./constants";

export interface EmbedOptions {
  batchSize?: number;
  model?: string;
  onBatchDone?: (chunksEmbedded: number, totalChunks: number) => void;
}

export async function embed(
  texts: string[],
  client: OpenRouter,
  options?: EmbedOptions
): Promise<number[][]> {
  const batchSize = options?.batchSize ?? DEFAULT_EMBEDDING_CALL_BATCH_SIZE;
  const model = options?.model ?? DEFAULT_EMBEDDING_MODEL;
  const { onBatchDone } = options ?? {};
  const results: number[][] = [];
  let chunksEmbedded = 0;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const response = await client.embeddings.generate({
      requestBody: { model, input: batch },
    });

    if (typeof response === "string") {
      throw new Error(`Embeddings API returned unexpected string: ${response}`);
    }

    for (const item of response.data) {
      if (typeof item.embedding === "string") {
        throw new Error("Embeddings API returned base64 encoding; expected float array");
      }
      results.push(item.embedding);
    }

    chunksEmbedded += batch.length;
    onBatchDone?.(chunksEmbedded, texts.length);
  }

  return results;
}
