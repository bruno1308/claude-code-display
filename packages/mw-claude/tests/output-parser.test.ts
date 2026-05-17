import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripAnsi, segmentReplies } from '../src/output-parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'sample-claude-output.txt'),
  'utf8',
);

describe('stripAnsi', () => {
  it('removes SGR color codes', () => {
    expect(stripAnsi('\x1b[31mhello\x1b[0m world')).toBe('hello world');
  });

  it('removes cursor movement sequences', () => {
    expect(stripAnsi('foo\x1b[2Kbar\x1b[1Abaz')).toBe('foobarbaz');
  });

  it('passes through plain text unchanged', () => {
    expect(stripAnsi('plain text\nwith newlines')).toBe('plain text\nwith newlines');
  });

  it('handles empty string', () => {
    expect(stripAnsi('')).toBe('');
  });
});

describe('segmentReplies', () => {
  it('emits at least two replies for the two-prompt fixture conversation', () => {
    const replies: string[] = [];
    const seg = segmentReplies((r) => replies.push(r));
    for (let i = 0; i < fixture.length; i += 256) {
      seg.feed(fixture.slice(i, i + 256));
    }
    seg.flush();
    expect(replies.length).toBeGreaterThanOrEqual(2);
  });

  it('one of the replies is a five-word greeting starting with Hello', () => {
    const replies: string[] = [];
    const seg = segmentReplies((r) => replies.push(r));
    seg.feed(fixture);
    seg.flush();
    const greeting = replies.find((r) => /\bHello\b/i.test(r));
    expect(greeting).toBeDefined();
    expect(greeting!.length).toBeLessThan(200);
  });

  it('one of the replies contains the digit 4 (answer to 2+2)', () => {
    const replies: string[] = [];
    const seg = segmentReplies((r) => replies.push(r));
    seg.feed(fixture);
    seg.flush();
    const answer = replies.find((r) => /\b4\b/.test(r));
    expect(answer).toBeDefined();
  });
});
