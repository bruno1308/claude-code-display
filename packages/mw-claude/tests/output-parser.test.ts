import { describe, it, expect } from 'vitest';
import { stripAnsi } from '../src/output-parser.js';

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
