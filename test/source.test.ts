import { describe, expect, it } from 'vitest';
import { resolveSource } from '../src/source.js';

describe('resolveSource', () => {
  it('detects urls', () => {
    const source = resolveSource('https://example.com/readme.md');
    expect(source.kind).toBe('url');
    expect(source.canWatch).toBe(false);
  });

  it('detects files', () => {
    const source = resolveSource('README.md');
    expect(source.kind).toBe('file');
    expect(source.canWatch).toBe(true);
  });
});
