import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { Chunk } from './chunker';

export function initDB(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path       TEXT NOT NULL,
      heading_context TEXT,
      text            TEXT NOT NULL,
      chunk_index     INTEGER NOT NULL,
      content_hash    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(content_hash);

    CREATE TABLE IF NOT EXISTS embeddings (
      chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
      model    TEXT NOT NULL,
      vector   BLOB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS file_index (
      file_path   TEXT PRIMARY KEY,
      mtime_ms    INTEGER NOT NULL,
      indexed_at  INTEGER NOT NULL
    );
  `);

  return db;
}

export function upsertFileChunks(
  db: Database.Database,
  chunks: Chunk[],
  hashes: string[],
  vectors: number[][],
  model: string
): void {
  if (chunks.length === 0) return;
  const filePath = chunks[0].filePath;

  const insertChunk = db.prepare(`
    INSERT INTO chunks (file_path, heading_context, text, chunk_index, content_hash)
    VALUES (@filePath, @headingContext, @text, @chunkIndex, @contentHash)
  `);
  const insertEmbedding = db.prepare(
    'INSERT INTO embeddings (chunk_id, model, vector) VALUES (?, ?, ?)'
  );

  db.transaction(() => {
    db.prepare('DELETE FROM chunks WHERE file_path = ?').run(filePath);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const result = insertChunk.run({
        filePath: chunk.filePath,
        headingContext: chunk.headingContext,
        text: chunk.text,
        chunkIndex: chunk.chunkIndex,
        contentHash: hashes[i],
      });
      const vector = Buffer.from(new Float32Array(vectors[i]).buffer);
      insertEmbedding.run(result.lastInsertRowid, model, vector);
    }
  })();
}

export function getEmbeddingsByHashes(
  db: Database.Database,
  hashes: string[]
): Map<string, Float32Array> {
  const result = new Map<string, Float32Array>();
  if (hashes.length === 0) return result;

  const placeholders = hashes.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT c.content_hash, e.vector
    FROM chunks c
    JOIN embeddings e ON c.id = e.chunk_id
    WHERE c.content_hash IN (${placeholders})
  `).all(...hashes) as { content_hash: string; vector: Buffer }[];

  for (const row of rows) {
    if (!result.has(row.content_hash)) {
      result.set(
        row.content_hash,
        new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4)
      );
    }
  }
  return result;
}

export function getFileIndex(db: Database.Database): Map<string, number> {
  const rows = db.prepare('SELECT file_path, mtime_ms FROM file_index').all() as
    { file_path: string; mtime_ms: number }[];
  return new Map(rows.map(r => [r.file_path, r.mtime_ms]));
}

export function upsertFileIndex(
  db: Database.Database,
  filePath: string,
  mtimeMs: number
): void {
  db.prepare(
    'INSERT OR REPLACE INTO file_index (file_path, mtime_ms, indexed_at) VALUES (?, ?, ?)'
  ).run(filePath, mtimeMs, Date.now());
}

export function getAllVectors(db: Database.Database): { chunkId: number; vector: Float32Array }[] {
  const rows = db.prepare('SELECT chunk_id, vector FROM embeddings').all() as
    { chunk_id: number; vector: Buffer }[];
  return rows.map(row => ({
    chunkId: row.chunk_id,
    vector: new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4),
  }));
}

export function getChunkById(db: Database.Database, id: number): Chunk | undefined {
  const row = db.prepare('SELECT * FROM chunks WHERE id = ?').get(id) as {
    file_path: string;
    heading_context: string | null;
    text: string;
    chunk_index: number;
  } | undefined;

  if (!row) return undefined;

  return {
    text: row.text,
    headingContext: row.heading_context ?? '',
    filePath: row.file_path,
    chunkIndex: row.chunk_index,
  };
}

export function getStats(db: Database.Database): { chunkCount: number; embeddingCount: number } {
  const { count: chunkCount } = db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number };
  const { count: embeddingCount } = db.prepare('SELECT COUNT(*) as count FROM embeddings').get() as { count: number };
  return { chunkCount, embeddingCount };
}
