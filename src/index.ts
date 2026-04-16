import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { OpenRouter } from '@openrouter/sdk';
import { initDB, getStats } from './store';
import { getFilesToIndex, ingestFiles } from './rag_ingest';
import { walkFiles, FileFilters } from './utils';
import { query, formatCitationNumbers, ConversationTurn, Citation } from './rag_query';
import { createProgressReporter, createSpinner } from './ui';

function parseArgs() {
  const recursive = process.argv.includes('--recursive');
  const excludePatterns: string[] = [];
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--exclude' && process.argv[i + 1]) {
      excludePatterns.push(process.argv[++i]);
    }
  }
  const fileFilters: FileFilters = { extensions: ['.org', '.pdf'], recursive, exclude: excludePatterns };
  return fileFilters;
}

function resolveNotesDir(): string {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (args[0]) return args[0];
  const cwd = path.basename(process.cwd());
  if (cwd === 'notes' || cwd === 'Notes') return process.cwd();
  return path.join(process.cwd(), 'notes');
}

function printStats(db: ReturnType<typeof initDB>, notesDir: string, fileFilters: FileFilters): void {
  const { chunkCount, embeddingCount, indexedFileCount } = getStats(db, notesDir);
  const totalFiles = walkFiles(notesDir, fileFilters).length;
  const staleCount = getFilesToIndex(notesDir, db, fileFilters, false).length;
  const staleStr = staleCount > 0 ? ` (${staleCount} stale)` : '';
  console.log(`${indexedFileCount}/${totalFiles} files indexed${staleStr}, ${chunkCount} chunks, ${embeddingCount} embeddings.`);
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
    console.error('Usage: npx ts-node src/index.ts [--recursive] [<notes-dir>]');
    process.exit(1);
  }

  const notesDir = fs.realpathSync(resolvedDir);

  const db = initDB(path.join(os.homedir(), '.cache/notes-rag/vector-store.db'));
  const client = new OpenRouter({ apiKey });

  console.log(`Notes: ${notesDir}`);
  const fileFilters: FileFilters = parseArgs(); 
  printStats(db, notesDir, fileFilters);
  console.log('Commands: :ingest | :clear | :sources | :quit');
  const history: ConversationTurn[] = [];
  let lastCitations: Citation[] = [];

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
      const files = getFilesToIndex(notesDir, db, fileFilters, false);
      if (files.length === 0) {
        console.log('Nothing to ingest.');
      } else {

        await ingestFiles(files, db, client, {
	  progressBarCreator: createProgressReporter
	});
        printStats(db, notesDir, fileFilters);
      }
      rl.prompt();
      return;
    }

    if (line === ':clear') {
      history.length = 0;
      lastCitations = [];
      console.clear();
      console.log(`Notes: ${notesDir}`);
      printStats(db, notesDir, fileFilters);
      console.log('Commands: :ingest | :clear | :sources | :quit');
      rl.prompt();
      return;
    }

    if (line === ':sources') {
      if (lastCitations.length === 0) {
        console.log('No sources from previous answer.');
      } else {
        for (const { numbers, filePath, chunks } of lastCitations) {
          console.log(`\n${formatCitationNumbers(numbers)} ${path.basename(filePath)}`);
          for (const { number, text } of chunks) {
            console.log(`\n[${number}]\n${text}`);
          }
        }
      }
      rl.prompt();
      return;
    }

    if (line) {
      const spinner = createSpinner('Thinking...');
      let spinnerStopped = false;
      const stopSpinner = () => {
        if (!spinnerStopped) { spinnerStopped = true; spinner.stop(); }
      };
      try {
        const result = await query(line, db, client, {
          history,
          onStart: () => { stopSpinner(); process.stdout.write('\n'); },
          onChunk: (chunk) => process.stdout.write(chunk.replace(/\r/g, '')),
        });
        stopSpinner();
        process.stdout.write('\n');
        lastCitations = result.citations;
        if (result.citations.length > 0) {
          console.log('\nSources:');
          for (const { numbers, filePath } of result.citations) {
            console.log(`  ${formatCitationNumbers(numbers)} ${path.basename(filePath)}`);
          }
        }
        history.push({ question: line, answer: result.answer });
      } catch (err) {
        stopSpinner();
        console.error('Error:', err instanceof Error ? err.message : err);
      }
    }

    rl.prompt();
  });
}

main();
