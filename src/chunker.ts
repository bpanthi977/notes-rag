import * as fs from 'fs';
import { DEFAULT_MAX_CHARS_IN_CHUNK, DEFAULT_MIN_OVERLAP_FOR_CHUNK } from './constants';

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

export function splitWithOverlap(text: string, maxChunkChars: number, overlap: number): string[] {
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

    const prevStart = start;
    chunks.push(text.slice(start, end));
    start = end - overlap;

    // Guarantee forward progress: if overlap >= (end - prevStart), start would
    // not advance past prevStart, causing an infinite loop (e.g. a long URL
    // with no spaces keeps the word-boundary at the same position each iteration).
    if (start <= prevStart) {
      start = end;
    }

    // Move start forward past whitespace
    while (start < text.length && (text[start] === ' ' || text[start] === '\n')) {
      start++;
    }
  }

  return chunks;
}

export function chunkFile(filePath: string, config: ChunkConfig = {}): Chunk[] {
  const maxChunkChars = config.maxChunkChars ?? DEFAULT_MAX_CHARS_IN_CHUNK;
  const overlap = config.overlap ?? DEFAULT_MIN_OVERLAP_FOR_CHUNK;

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
    const headingPrefix = headingContext ? headingContext.length + 1 : 0; // +1 for '\n'
    const effectiveMax = maxChunkChars - headingPrefix;

    function emitChunk(chunkText: string) {
      chunks.push({
        text: headingContext ? `${headingContext}\n${chunkText}` : chunkText,
        headingContext,
        filePath,
        chunkIndex: chunkIndex++,
      });
    }

    if (text.length <= effectiveMax) {
      emitChunk(text);
    } else {
      const parts = splitWithOverlap(text, effectiveMax, overlap);
      for (const part of parts) {
        emitChunk(part);
      }
    }
  }

  function finishParagraph() {
    const text = currentLines.join('\n').trim();
    currentLines = [];
    if (!text) return;

    const headingCtxLen = buildHeadingContext(headings).length;
    const effectiveMax = maxChunkChars - (headingCtxLen > 0 ? headingCtxLen + 1 : 0);
    if (accumulatedText && (accumulatedText.length + 2 + text.length) > effectiveMax) {
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
