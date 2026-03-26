import { OpenRouter } from "@openrouter/sdk";
import Database from "better-sqlite3";
import { embed } from "./embeddings";
import { getAllVectors, getChunkById } from "./store";
import { Chunk } from "./chunker";
import { DEFAULT_EMBEDDING_MODEL, DEFAULT_CHAT_MODEL, DEFAULT_RAG_RETRIEVAL_K } from "./constants";

export interface Citation {
  numbers: number[];   // citation numbers from the answer pointing to this file
  filePath: string;
}

export interface QueryResult {
  answer: string;
  citations: Citation[];
}

export interface QueryConfig {
  embeddingModel?: string;
  chatModel?: string;
  k?: number;
}

export function formatCitationNumbers(numbers: number[]): string {
  const sorted = [...numbers].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0], end = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
    } else {
      ranges.push(start === end ? `[${start}]` : `[${start}-${end}]`);
      start = end = sorted[i];
    }
  }
  ranges.push(start === end ? `[${start}]` : `[${start}-${end}]`);
  return ranges.join(', ');
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
): Promise<QueryResult> {
  const embeddingModel = config?.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
  const chatModel = config?.chatModel ?? DEFAULT_CHAT_MODEL;
  const k = config?.k ?? DEFAULT_RAG_RETRIEVAL_K;

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

  // 5b. Build numbered chunks list (preserving filePath for citation tracking)
  const numberedChunks: Array<{ text: string; filePath: string }> = [];
  for (const [, { chunks }] of sortedFiles) {
    chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
    for (const chunk of chunks) {
      numberedChunks.push({ text: chunk.text, filePath: chunk.filePath });
    }
  }

  // 6. Build prompt with numbered context
  const context = numberedChunks
    .map((c, i) => `[${i + 1}]\n${c.text}`)
    .join("\n---\n");
  const prompt =
    `Answer the question using only the notes provided below. ` +
    `Cite source chunk numbers inline (e.g. [1], [2]).\n\n` +
    `${context}\n\nQuestion: ${question}`;

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
  const answer = typeof content === "string" ? content : "";

  // Parse cited numbers in order of first appearance
  const orderedCited: number[] = [];
  const seen = new Set<number>();
  const citationRegex = /\[(\d+)\]/g;
  let match;
  while ((match = citationRegex.exec(answer)) !== null) {
    const n = parseInt(match[1], 10);
    if (n >= 1 && n <= numberedChunks.length && !seen.has(n)) {
      orderedCited.push(n);
      seen.add(n);
    }
  }

  // Group citation numbers by file in order of first appearance
  const fileOrder: string[] = [];
  const fileNumbers = new Map<string, number[]>();
  for (const n of orderedCited) {
    const fp = numberedChunks[n - 1].filePath;
    if (!fileNumbers.has(fp)) {
      fileNumbers.set(fp, []);
      fileOrder.push(fp);
    }
    fileNumbers.get(fp)!.push(n);
  }

  const citations: Citation[] = fileOrder.map(fp => ({
    filePath: fp,
    numbers: fileNumbers.get(fp)!,
  }));

  return { answer, citations };
}
