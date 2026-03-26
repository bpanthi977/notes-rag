import * as path from 'path';
import { IngestProgress } from './rag_ingest';

const SPINNER_FRAMES = ['|', '/', '-', '\\'];

export function createSpinner(message: string): { stop: () => void } {
  let frame = 0;
  const lineLen = message.length + 4;

  const timer = setInterval(() => {
    process.stdout.write(`\r${SPINNER_FRAMES[frame++ % SPINNER_FRAMES.length]} ${message}`);
  }, 100);

  return {
    stop() {
      clearInterval(timer);
      process.stdout.write('\r' + ' '.repeat(lineLen) + '\r');
    },
  };
}

export function createProgressReporter(filesTotal: number): {
  update: (progress: IngestProgress) => void;
  stop: () => void;
} {
  const BAR_WIDTH = 30;
  let lastLineLen = 0;

  function render(stage: string, filesDone: number, currentFile: string) {
    const fraction = filesTotal > 0 ? filesDone / filesTotal : 0;
    const filled = Math.round(fraction * BAR_WIDTH);
    const bar = '#'.repeat(filled) + '.'.repeat(BAR_WIDTH - filled);
    const fileName = currentFile ? path.basename(currentFile) : '';
    const label = fileName ? `${stage} | ${fileName}` : stage;
    const line = `\r[${bar}] ${filesDone}/${filesTotal} | ${label}`;
    const padded = line + ' '.repeat(Math.max(0, lastLineLen - line.length));
    lastLineLen = line.length;
    process.stdout.write(padded);
  }

  return {
    update(progress: IngestProgress) {
      render(progress.stage, progress.filesDone, progress.currentFile);
    },
    stop() {
      process.stdout.write('\r' + ' '.repeat(lastLineLen + 4) + '\r');
    },
  };
}
