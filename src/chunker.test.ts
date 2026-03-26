import { splitWithOverlap } from './chunker';

describe('splitWithOverlap', () => {
  it('does not infinite loop when a long word spans multiple chunk boundaries', () => {
    // Reproduces the flush.org bug: a short prefix followed by a very long
    // "word" (URL with no spaces) causes the word-boundary walk-back to always
    // land on the same space, making start regress each iteration.
    const longWord = 'x'.repeat(2000);
    const text = 'hello ' + longWord;

    const chunks = splitWithOverlap(text, 800, 200);

    expect(chunks.length).toBeGreaterThan(0);
    // Verify the full text is covered
    const combined = chunks.join('');
    expect(combined).toContain('hello');
    expect(combined).toContain(longWord.slice(0, 100));
  });
});
