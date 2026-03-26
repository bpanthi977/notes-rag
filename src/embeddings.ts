import { OpenRouter } from "@openrouter/sdk";

const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";

export interface EmbedOptions {
  batchSize?: number;
  model?: string;
}

export async function embed(
  texts: string[],
  client: OpenRouter,
  options?: EmbedOptions
): Promise<number[][]> {
  const batchSize = options?.batchSize ?? 100;
  const model = options?.model ?? DEFAULT_EMBEDDING_MODEL;
  const results: number[][] = [];

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
  }

  return results;
}
