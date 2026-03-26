import * as path from 'path';
import * as readline from 'readline';
import { OpenRouter } from '@openrouter/sdk';
import { initDB, getStats } from './store';
import { getFilesToIndex, ingestFiles } from './rag_ingest';
import { query } from './rag_query';

function resolveNotesDir(): string {
  if (process.argv[2]) return process.argv[2];
  const cwd = path.basename(process.cwd());
  if (cwd === 'notes' || cwd === 'Notes') return process.cwd();
  return path.join(process.cwd(), 'notes');
}

function printStats(db: ReturnType<typeof initDB>): void {
  const { chunkCount, embeddingCount } = getStats(db);
  console.log(`${chunkCount} chunks, ${embeddingCount} embeddings indexed.`);
}

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('Error: OPENROUTER_API_KEY environment variable is not set.');
    process.exit(1);
  }

  const notesDir = resolveNotesDir();
  const db = initDB('data/vector-store.db');
  const client = new OpenRouter({ apiKey });

  printStats(db);
  console.log('Commands: :ingest | :quit');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  rl.on('close', () => {
    db.close();
    console.log('\nBye!');
  });

  const ask = () => rl.question('> ', async (input) => {
    const line = input.trim();

    if (line === ':quit' || line === ':exit') {
      rl.close();
      return;
    }

    if (line === ':ingest') {
      const files = getFilesToIndex(notesDir, db);
      if (files.length === 0) {
        console.log('Nothing to ingest.');
      } else {
        await ingestFiles(files, db, client);
        printStats(db);
      }
      ask();
      return;
    }

    if (line) {
      try {
        const answer = await query(line, db, client);
        console.log(answer);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
      }
    }

    ask();
  });
}

main();
