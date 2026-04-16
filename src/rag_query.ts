import Database from "better-sqlite3";
import { embed } from "./embeddings";
import { getAllVectors, getChunkById } from "./store";
import { Chunk } from "./chunker";
import { EmbeddingClient, ChatClient, ChatMessage } from "./providers";
import { DEFAULT_RAG_RETRIEVAL_K } from "./constants";

export interface Citation {
  numbers: number[];   // citation numbers from the answer pointing to this file
  filePath: string;
  chunks: Array<{ number: number; text: string }>;
}

export interface QueryResult {
  answer: string;
  citations: Citation[];
}

export interface ConversationTurn {
  question: string;
  answer: string;
}

export interface QueryConfig {
  k?: number;
  allowedFilePaths?: Set<string>;
  history?: ConversationTurn[];
  onChunk?: (chunk: string) => void;
  onStart?: () => void;
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
  embeddingClient: EmbeddingClient,
  embeddingModel: string,
  chatClient: ChatClient,
  config?: QueryConfig
): Promise<QueryResult> {
  const k = config?.k ?? DEFAULT_RAG_RETRIEVAL_K;

  // 1. Embed the question
  const [questionVector] = await embed([question], embeddingClient);
  const qVec = new Float32Array(questionVector);

  // 2. Score all stored vectors (filtered to allowed files if specified)
  const { allowedFilePaths } = config ?? {};
  const allVectors = getAllVectors(db, embeddingModel)
    .filter(v => !allowedFilePaths || allowedFilePaths.has(v.filePath));
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
  const prompt = `Answer the question using only the notes provided below or the conversation history above (if it exits). ` +
    `Cite note chunk numbers inline (e.g. [1], [2]) when referencing them.\n\n` +
    `${context}\n\nQuestion: ${question}`;

  // 7. Call LLM
  const historyMessages = (config?.history ?? []).flatMap(turn => [
    { role: "user" as const, content: turn.question },
    { role: "assistant" as const, content: turn.answer },
  ]);

  const messages: ChatMessage[] = [{role: "system", content: "Your are personalized knowledge base assistant. Answer the last question asked based on the notes provided."}, ...historyMessages, { role: "user", content: prompt }];
  const { onChunk, onStart } = config ?? {};
  let started = false;
  const answer = await chatClient.chatStream(messages, (text) => {
    if (!started) { onStart?.(); started = true; }
    onChunk?.(text);
  });

  // Parse cited numbers in order of first appearance
  const orderedCited: number[] = [];
  const seen = new Set<number>();
  const citationRegex = /\[(\d+(?:,\s*\d+)*)\]/g;
  let match;
  while ((match = citationRegex.exec(answer)) !== null) {
    for (const part of match[1].split(',')) {
      const n = parseInt(part.trim(), 10);
      if (n >= 1 && n <= numberedChunks.length && !seen.has(n)) {
        orderedCited.push(n);
        seen.add(n);
      }
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

  const citations: Citation[] = fileOrder.map(fp => {
    const nums = fileNumbers.get(fp)!;
    return {
      filePath: fp,
      numbers: nums,
      chunks: nums.map(n => ({ number: n, text: numberedChunks[n - 1].text })),
    };
  });

  return { answer, citations };
}
