import * as fs from 'fs';

export interface Chunk {
  text: string;
  headingContext: string;
  filePath: string;
  chunkIndex: number;
}

export interface ChunkConfig {
  maxChunkChars?: number;  // default: 800
  overlap?: number;        // default: 200
}

function parseHeadingLevel(line: string): number {
  const match = line.match(/^(\*+)\s/);
  return match ? match[1].length : 0;
}

function buildHeadingContext(headings: string[]): string {
  return headings.join(' > ');
}

function splitWithOverlap(text: string, maxChunkChars: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxChunkChars;

    if (end >= text.length) {
      chunks.push(text.slice(start));
      break;
    }

    // Find word boundary: walk back from end until whitespace
    while (end > start && text[end] !== ' ' && text[end] !== '\n') {
      end--;
    }
    if (end === start) {
      // No word boundary found, hard cut
      end = start + maxChunkChars;
    }

    chunks.push(text.slice(start, end));
    start = end - overlap;

    // Move start forward past whitespace
    while (start < text.length && (text[start] === ' ' || text[start] === '\n')) {
      start++;
    }
  }

  return chunks;
}

export function chunkFile(filePath: string, config: ChunkConfig = {}): Chunk[] {
  const maxChunkChars = config.maxChunkChars ?? 800;
  const overlap = config.overlap ?? 200;

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  // headings[i] holds the current heading text at level (i+1)
  const headings: string[] = [];
  let currentLines: string[] = [];
  let accumulatedText = '';

  function emitAccumulated() {
    const text = accumulatedText.trim();
    accumulatedText = '';
    if (!text) return;

    const headingContext = buildHeadingContext(headings);

    function emitChunk(chunkText: string) {
      chunks.push({
        text: headingContext ? `${headingContext}\n${chunkText}` : chunkText,
        headingContext,
        filePath,
        chunkIndex: chunkIndex++,
      });
    }

    if (text.length <= maxChunkChars) {
      emitChunk(text);
    } else {
      const parts = splitWithOverlap(text, maxChunkChars, overlap);
      for (const part of parts) {
        emitChunk(part);
      }
    }
  }

  function finishParagraph() {
    const text = currentLines.join('\n').trim();
    currentLines = [];
    if (!text) return;

    if (accumulatedText && (accumulatedText.length + 2 + text.length) > maxChunkChars) {
      emitAccumulated();
    }
    accumulatedText = accumulatedText ? accumulatedText + '\n\n' + text : text;
  }

  let inProperties = false;

  for (const line of lines) {
    if (line.trim() === ':PROPERTIES:') { inProperties = true; continue; }
    if (inProperties) {
      if (line.trim() === ':END:') inProperties = false;
      continue;
    }

    const level = parseHeadingLevel(line);

    if (level > 0) {
      finishParagraph();
      emitAccumulated();
      // Truncate heading stack to current level and set current heading
      headings.splice(level - 1);
      headings[level - 1] = line.trim();
    } else if (line.trim() === '') {
      finishParagraph();
    } else {
      currentLines.push(line);
    }
  }

  finishParagraph();
  emitAccumulated();

  return chunks;
}
