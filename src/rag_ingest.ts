import * as fs from 'fs';
import * as crypto from 'crypto';
import Database from 'better-sqlite3';
import { OpenRouter } from '@openrouter/sdk';
import { walkOrgFiles } from './utils';
import {
  getFileIndex,
  getEmbeddingsByHashes,
  upsertFileChunks,
  upsertFileIndex,
  deleteFile,
} from './store';
import { chunkFile, Chunk } from './chunker';
import { embed } from './embeddings';
import { DEFAULT_EMBEDDING_MODEL, DEFAULT_MAX_FILES_FOR_CHUNKS, DEFAULT_MAX_CHUNKS_FOR_EMBEDDING } from './constants';

export interface IngestOptions {
  force?: boolean; // force=true bypasses mtime check
  embeddingModel?: string; // default: "openai/text-embedding-3-small"
  maxFilesForChunks?: number; // max files to chunk at once (default: 50)
  maxChunksForEmbedding?: number; // max chunks per embed() API call (default: embed()'s own batch size)
}

function computeHash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function getFilesToIndex(
  notesDir: string,
  db: Database.Database,
  options: IngestOptions
): Promise<{ filePath: string; mtime: number }[]> {
  const allCurrentPaths = walkOrgFiles(notesDir);
  const trackedFiles = getFileIndex(db);
  const filesToIndex: { filePath: string; mtime: number }[] = [];

  const currentPathsSet = new Set(allCurrentPaths);
  for (const [trackedPath] of trackedFiles) {
    if (!currentPathsSet.has(trackedPath)) {
      console.log(`Removing stale file: ${trackedPath}`);
      deleteFile(db, trackedPath);
    }
  }

  for (const filePath of allCurrentPaths) {
    const stats = fs.statSync(filePath);
    const mtime = stats.mtimeMs;
    const lastMtime = trackedFiles.get(filePath);

    if (options.force || lastMtime === undefined || mtime !== lastMtime) {
      filesToIndex.push({ filePath, mtime });
    }
  }

  return filesToIndex;
}

export async function ingest(
  notesDir: string,
  db: Database.Database,
  client: OpenRouter,
  options: IngestOptions = {}
): Promise<void> {
  const {
    force = false,
    embeddingModel = DEFAULT_EMBEDDING_MODEL,
    maxFilesForChunks = DEFAULT_MAX_FILES_FOR_CHUNKS,
    maxChunksForEmbedding = DEFAULT_MAX_CHUNKS_FOR_EMBEDDING,
  } = options;

  const filesToIndex = getFilesToIndex(notesDir, db, { force });

  if (filesToIndex.length === 0) {
    console.log('No new or changed files to ingest.');
    return;
  }

  let totalFilesProcessed = 0;
  let totalChunksCount = 0;
  let reusedEmbeddingsCount = 0;
  let newEmbeddingsCount = 0;

  for (let i = 0; i < filesToIndex.length; i += maxFilesForChunks) {
    const batch = filesToIndex.slice(i, i + maxFilesForChunks);
    const fileData: { filePath: string; mtime: number; chunks: Chunk[]; hashes: string[] }[] = [];
    const allHashesInBatch = new Set<string>();

    for (const { filePath, mtime } of batch) {
      const chunks = chunkFile(filePath);
      const hashes = chunks.map(c => computeHash(c.text));
      fileData.push({ filePath, mtime, chunks, hashes });
      hashes.forEach(h => allHashesInBatch.add(h));
    }

    const cachedVectors = getEmbeddingsByHashes(db, Array.from(allHashesInBatch));
    const chunksToEmbed: { text: string; hash: string }[] = [];
    const textToEmbedSet = new Set<string>();

    for (const file of fileData) {
      for (let j = 0; j < file.chunks.length; j++) {
        const hash = file.hashes[j];
        if (!cachedVectors.has(hash) && !textToEmbedSet.has(file.chunks[j].text)) {
          chunksToEmbed.push({ text: file.chunks[j].text, hash });
          textToEmbedSet.add(file.chunks[j].text);
        }
      }
    }

    if (chunksToEmbed.length > 0) {
      const newVectors = await embed(
        chunksToEmbed.map(c => c.text),
        client,
        { model: embeddingModel, batchSize: maxChunksForEmbedding }
      );
      for (let j = 0; j < chunksToEmbed.length; j++) {
        cachedVectors.set(chunksToEmbed[j].hash, new Float32Array(newVectors[j]));
      }
      newEmbeddingsCount += chunksToEmbed.length;
    }

    for (const file of fileData) {
      const vectorsForFile: number[][] = file.hashes.map(h => Array.from(cachedVectors.get(h)!));
      upsertFileChunks(db, file.chunks, file.hashes, vectorsForFile, embeddingModel);
      upsertFileIndex(db, file.filePath, file.mtime);
      
      totalFilesProcessed++;
      totalChunksCount += file.chunks.length;
    }
  }

  reusedEmbeddingsCount = totalChunksCount - newEmbeddingsCount;

  console.log(
    `Ingest summary: ${totalFilesProcessed} files, ${totalChunksCount} chunks (${reusedEmbeddingsCount} reused, ${newEmbeddingsCount} new embeddings)`
  );
}
