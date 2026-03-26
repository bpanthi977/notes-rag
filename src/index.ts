import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { OpenRouter } from '@openrouter/sdk';
import { initDB, getStats } from './store';
import { getFilesToIndex, ingestFiles } from './rag_ingest';
import { walkOrgFiles } from './utils';
import { query } from './rag_query';
import { createSpinner } from './ui';

function resolveNotesDir(): string {
  if (process.argv[2]) return process.argv[2];
  const cwd = path.basename(process.cwd());
  if (cwd === 'notes' || cwd === 'Notes') return process.cwd();
  return path.join(process.cwd(), 'notes');
}

function printStats(db: ReturnType<typeof initDB>, notesDir: string): void {
  const { chunkCount, embeddingCount, indexedFileCount } = getStats(db);
  const totalFiles = walkOrgFiles(notesDir).length;
  console.log(`${indexedFileCount}/${totalFiles} files indexed, ${chunkCount} chunks, ${embeddingCount} embeddings.`);
}

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('Error: OPENROUTER_API_KEY environment variable is not set.');
    process.exit(1);
  }

  const resolvedDir = resolveNotesDir();

  if (!fs.existsSync(resolvedDir)) {
    console.error(`Error: Notes directory not found: ${resolvedDir}`);
    console.error('Set a notes directory by passing it as an argument: npx ts-node src/index.ts <notes-dir>');
    process.exit(1);
  }

  const notesDir = fs.realpathSync(resolvedDir);

  const db = initDB('data/vector-store.db');
  const client = new OpenRouter({ apiKey });

  console.log(`Notes: ${notesDir}`);
  printStats(db, notesDir);
  console.log('Commands: :ingest | :quit');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt('> ');
  rl.prompt();

  rl.on('close', () => {
    db.close();
    console.log('\nBye!');
  });

  rl.on('line', async (input) => {
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
        printStats(db, notesDir);
      }
      rl.prompt();
      return;
    }

    if (line) {
      const spinner = createSpinner('Thinking...');
      try {
	const answer = await query(line, db, client);
	spinner.stop();
	console.log(answer);
      } catch (err) {
	spinner.stop();
	console.error('Error:', err instanceof Error ? err.message : err);
      }
    }

    rl.prompt();
  });
}

main();
