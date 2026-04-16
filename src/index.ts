import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { initDB, getStats } from './store';
import { getFilesToIndex, ingestFiles } from './rag_ingest';
import { walkFiles, FileFilters } from './utils';
import { query, formatCitationNumbers, ConversationTurn, Citation } from './rag_query';
import { createProgressReporter, createSpinner } from './ui';
import { parseModelSpec, makeEmbeddingClient, makeChatClient } from './providers';
import { DEFAULT_EMBEDDING_MODEL, DEFAULT_CHAT_MODEL } from './constants';

function resolveNotesDir(argv: string[]): string {
  const args = argv.slice(2).filter(a => !a.startsWith('--'));
  if (args[0]) return args[0];
  const cwd = path.basename(process.cwd());
  if (cwd === 'notes' || cwd === 'Notes') return process.cwd();
  return path.join(process.cwd(), 'notes');
}

function parseArgs() {
  const remainingArgs = [...process.argv];

  let index = remainingArgs.indexOf('--recursive');
  const recursive = index != -1;
  if (recursive) remainingArgs.splice(index, 1);

  const excludePatterns: string[] = [];
  while ((index = remainingArgs.indexOf('--exclude'), index != -1)) {
    if (remainingArgs[index + 1]) {
      excludePatterns.push(remainingArgs[index+1]);
      remainingArgs.splice(index, 2)
    }
  }
  let embeddingModelRaw = DEFAULT_EMBEDDING_MODEL;
  index = remainingArgs.indexOf('--embedding-model');
  if (index !== -1 && remainingArgs[index + 1]) {
    embeddingModelRaw = remainingArgs[index + 1];
    remainingArgs.splice(index, 2);
  }

  let chatModelRaw = DEFAULT_CHAT_MODEL;
  index = remainingArgs.indexOf('--chat-model');
  if (index !== -1 && remainingArgs[index + 1]) {
    chatModelRaw = remainingArgs[index + 1];
    remainingArgs.splice(index, 2);
  }

  const fileFilters: FileFilters = { extensions: ['.org', '.pdf'], recursive, exclude: excludePatterns };
  const notesDir = fs.realpathSync(resolveNotesDir(remainingArgs));
  return {
    fileFilters,
    notesDir,
    embeddingSpec: parseModelSpec(embeddingModelRaw),
    chatSpec: parseModelSpec(chatModelRaw),
  };
}


function printStats(db: ReturnType<typeof initDB>, notesDir: string, fileFilters: FileFilters, embeddingModel: string): void {
  const { chunkCount, embeddingCount, indexedFileCount } = getStats(db, notesDir);
  const totalFiles = walkFiles(notesDir, fileFilters).length;
  const staleCount = getFilesToIndex(notesDir, db, fileFilters, embeddingModel, false).length;
  const staleStr = staleCount > 0 ? ` (${staleCount} stale)` : '';
  console.log(`${indexedFileCount}/${totalFiles} files indexed${staleStr}, ${chunkCount} chunks, ${embeddingCount} embeddings.`);
}

async function main() {
  const { fileFilters, notesDir, embeddingSpec, chatSpec } = parseArgs();

  const needsOpenRouter = embeddingSpec.provider === 'openrouter' || chatSpec.provider === 'openrouter';
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (needsOpenRouter && !apiKey) {
    console.error('Error: OPENROUTER_API_KEY environment variable is not set (required for openrouter provider).');
    process.exit(1);
  }

  if (!fs.existsSync(notesDir)) {
    console.error(`Error: Notes directory not found: ${notesDir}`);
    console.error('Usage: npx ts-node src/index.ts [--recursive] [--embedding-model <spec>] [--chat-model <spec>] [<notes-dir>]');
    process.exit(1);
  }

  const db = initDB(path.join(os.homedir(), '.cache/notes-rag/vector-store.db'));
  const embeddingClient = makeEmbeddingClient(embeddingSpec, apiKey ?? undefined);
  const chatClient = makeChatClient(chatSpec, apiKey ?? undefined);

  console.log(`Notes: ${notesDir}`);

  printStats(db, notesDir, fileFilters, embeddingSpec.model);
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
      const files = getFilesToIndex(notesDir, db, fileFilters, embeddingSpec.model, false);
      if (files.length === 0) {
        console.log('Nothing to ingest.');
      } else {

        await ingestFiles(files, db, embeddingClient, embeddingSpec.model, {
	  progressBarCreator: createProgressReporter
	});
        printStats(db, notesDir, fileFilters, embeddingSpec.model);
      }
      rl.prompt();
      return;
    }

    if (line === ':clear') {
      history.length = 0;
      lastCitations = [];
      console.clear();
      console.log(`Notes: ${notesDir}`);
      printStats(db, notesDir, fileFilters, embeddingSpec.model);
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
        const result = await query(line, db, embeddingClient, embeddingSpec.model, chatClient, {
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
