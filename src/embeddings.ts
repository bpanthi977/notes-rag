import { OpenRouter } from "@openrouter/sdk";

const MODEL = "openai/text-embedding-3-small";

export interface EmbedOptions {
  batchSize?: number;
}

export async function embed(
  texts: string[],
  client: OpenRouter,
  options?: EmbedOptions
): Promise<number[][]> {
  const batchSize = options?.batchSize ?? 100;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const response = await client.embeddings.generate({
      requestBody: { model: MODEL, input: batch },
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
