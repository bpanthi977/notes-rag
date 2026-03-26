import * as fs from 'fs';
import * as path from 'path';

export interface Chunk {
  text: string;
  headingContext: string;
  filePath: string;
  chunkIndex: number;
}

const MAX_CHUNK_CHARS = 800;
const WINDOW_SIZE = 800;
const OVERLAP = 200;

function parseHeadingLevel(line: string): number {
  const match = line.match(/^(\*+)\s/);
  return match ? match[1].length : 0;
}

function buildHeadingContext(headings: string[]): string {
  return headings.join(' > ');
}

function splitWithOverlap(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + WINDOW_SIZE;

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
      end = start + WINDOW_SIZE;
    }

    chunks.push(text.slice(start, end));
    start = end - OVERLAP;

    // Move start forward past whitespace
    while (start < text.length && (text[start] === ' ' || text[start] === '\n')) {
      start++;
    }
  }

  return chunks;
}

export function chunkFile(filePath: string): Chunk[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  // headings[i] holds the current heading text at level (i+1)
  const headings: string[] = [];
  let paragraphLines: string[] = [];

  function flushParagraph() {
    const text = paragraphLines.join('\n').trim();
    paragraphLines = [];

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

    if (text.length <= MAX_CHUNK_CHARS) {
      emitChunk(text);
    } else {
      const parts = splitWithOverlap(text);
      for (const part of parts) {
        emitChunk(part);
      }
    }
  }

  for (const line of lines) {
    const level = parseHeadingLevel(line);

    if (level > 0) {
      flushParagraph();
      // Truncate heading stack to current level and set current heading
      headings.splice(level - 1);
      headings[level - 1] = line.trim();
    } else if (line.trim() === '') {
      flushParagraph();
    } else {
      paragraphLines.push(line);
    }
  }

  flushParagraph();

  return chunks;
}

export function chunkDirectory(dir: string): Chunk[] {
  const allChunks: Chunk[] = [];

  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.org')) {
        allChunks.push(...chunkFile(fullPath));
      }
    }
  }

  walk(dir);
  return allChunks;
}
