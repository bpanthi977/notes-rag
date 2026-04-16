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
      chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
      model    TEXT NOT NULL,
      vector   BLOB NOT NULL,
      PRIMARY KEY (chunk_id, model)
    );

    CREATE TABLE IF NOT EXISTS file_index (
      file_path   TEXT PRIMARY KEY,
      mtime_ms    INTEGER NOT NULL,
      indexed_at  INTEGER NOT NULL
    );
  `);

  // Migrate embeddings table from single-column PK (chunk_id) to composite PK (chunk_id, model)
  const pkCols = (db.pragma('table_info(embeddings)') as { pk: number; name: string }[])
    .filter(c => c.pk > 0).map(c => c.name);
  if (pkCols.length === 1 && pkCols[0] === 'chunk_id') {
    db.transaction(() => {
      db.pragma('foreign_keys = OFF');
      db.exec(`
        CREATE TABLE embeddings_new (
          chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
          model    TEXT NOT NULL,
          vector   BLOB NOT NULL,
          PRIMARY KEY (chunk_id, model)
        );
        INSERT OR IGNORE INTO embeddings_new SELECT chunk_id, model, vector FROM embeddings;
        DROP TABLE embeddings;
        ALTER TABLE embeddings_new RENAME TO embeddings;
      `);
      db.pragma('foreign_keys = ON');
    })();
  }

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
    'INSERT OR REPLACE INTO embeddings (chunk_id, model, vector) VALUES (?, ?, ?)'
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
  hashes: string[],
  model: string
): Map<string, Float32Array> {
  const result = new Map<string, Float32Array>();
  if (hashes.length === 0) return result;

  const placeholders = hashes.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT c.content_hash, e.vector
    FROM chunks c
    JOIN embeddings e ON c.id = e.chunk_id
    WHERE e.model = ? AND c.content_hash IN (${placeholders})
  `).all(model, ...hashes) as { content_hash: string; vector: Buffer }[];

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

export function getFileIndex(db: Database.Database, notesDir?: string): Map<string, number> {
  const glob = notesDir ? notesDir + '/*' : '*';
  const rows = db.prepare('SELECT file_path, mtime_ms FROM file_index WHERE file_path GLOB ?').all(glob) as
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

export function deleteFile(db: Database.Database, filePath: string): void {
  db.transaction(() => {
    db.prepare('DELETE FROM chunks WHERE file_path = ?').run(filePath);
    db.prepare('DELETE FROM file_index WHERE file_path = ?').run(filePath);
  })();
}

export function getAllVectors(db: Database.Database, embeddingModel: string): { chunkId: number; vector: Float32Array }[] {
  const rows = db.prepare('SELECT chunk_id, vector FROM embeddings WHERE model = ?').all([embeddingModel]) as
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

export function getFilesIndexedForModel(
  db: Database.Database,
  notesDir: string,
  model: string
): Set<string> {
  const rows = db.prepare(`
    SELECT DISTINCT c.file_path
    FROM chunks c
    JOIN embeddings e ON c.id = e.chunk_id
    WHERE e.model = ? AND c.file_path GLOB ?
  `).all(model, notesDir + '/*') as { file_path: string }[];
  return new Set(rows.map(r => r.file_path));
}

export function getStats(db: Database.Database, notesDir?: string): { chunkCount: number; embeddingCount: number; indexedFileCount: number } {
  const glob = notesDir ? notesDir + '/*' : '*';
  const row = db.prepare(`
    SELECT
      COUNT(DISTINCT fi.file_path) AS indexedFileCount,
      COUNT(DISTINCT c.id)        AS chunkCount,
      COUNT(DISTINCT e.chunk_id)  AS embeddingCount
    FROM file_index fi
    LEFT JOIN chunks c ON c.file_path = fi.file_path
    LEFT JOIN embeddings e ON e.chunk_id = c.id
    WHERE fi.file_path GLOB ?
  `).get(glob) as { chunkCount: number; embeddingCount: number; indexedFileCount: number };
  return row;
}
