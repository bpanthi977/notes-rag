import { OpenRouter } from "@openrouter/sdk";
import Database from "better-sqlite3";
import { embed } from "./embeddings";
import { getAllVectors, getChunkById } from "./store";
import { Chunk } from "./chunker";

const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";
const DEFAULT_CHAT_MODEL = "anthropic/claude-3.5-haiku";

export interface QueryConfig {
  embeddingModel?: string;
  chatModel?: string;
  k?: number;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function query(
  question: string,
  db: Database.Database,
  client: OpenRouter,
  config?: QueryConfig
): Promise<string> {
  const embeddingModel = config?.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
  const chatModel = config?.chatModel ?? DEFAULT_CHAT_MODEL;
  const k = config?.k ?? 5;

  // 1. Embed the question
  const [questionVector] = await embed([question], client, { model: embeddingModel });
  const qVec = new Float32Array(questionVector);

  // 2. Score all stored vectors
  const allVectors = getAllVectors(db);
  const scored = allVectors.map(({ chunkId, vector }) => ({
    chunkId,
    score: cosineSimilarity(qVec, vector),
  }));

  // 3. Top-k by score
  scored.sort((a, b) => b.score - a.score);
  const topK = scored.slice(0, k);

  // 4. Fetch chunks
  const chunksWithScores: { chunk: Chunk; score: number }[] = [];
  for (const { chunkId, score } of topK) {
    const chunk = getChunkById(db, chunkId);
    if (chunk) chunksWithScores.push({ chunk, score });
  }

  // 5. Group by filePath, sort files by best score, sort chunks within file by chunkIndex
  const fileMap = new Map<string, { chunks: Chunk[]; bestScore: number }>();
  for (const { chunk, score } of chunksWithScores) {
    const entry = fileMap.get(chunk.filePath);
    if (entry) {
      entry.chunks.push(chunk);
      entry.bestScore = Math.max(entry.bestScore, score);
    } else {
      fileMap.set(chunk.filePath, { chunks: [chunk], bestScore: score });
    }
  }

  const sortedFiles = [...fileMap.entries()].sort(
    (a, b) => b[1].bestScore - a[1].bestScore
  );

  const contextParts: string[] = [];
  for (const [, { chunks }] of sortedFiles) {
    chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
    for (const chunk of chunks) {
      contextParts.push(chunk.text);
    }
  }

  // 6. Build prompt
  const context = contextParts.join("\n---\n");
  const prompt = `Answer the question based on the following notes:\n\n${context}\n\nQuestion: ${question}`;

  // 7. Call LLM
  const response = await client.chat.send({
    chatGenerationParams: {
      model: chatModel,
      messages: [{ role: "user", content: prompt }],
    },
  });

  if (typeof response === "string") {
    throw new Error(`Chat API returned unexpected string: ${response}`);
  }

  const content = (response as { choices: { message: { content?: string } }[] }).choices[0]?.message?.content;
  return typeof content === "string" ? content : "";
}
