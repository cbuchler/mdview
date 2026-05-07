import { describe, expect, it } from 'vitest';
import { formatCliError } from '../src/errors.js';

describe('formatCliError', () => {
  it('adds a usage hint for CLI mistakes', () => {
    expect(formatCliError(new Error('Unknown flag: --wat'))).toContain('Run `mdview --help` for usage.');
    expect(formatCliError(new Error('Config error in /tmp/config.yml:\n- wrap: expected a boolean'))).toContain('Run `mdview --help` for usage.');
    expect(formatCliError(new Error('Cannot combine --print-config and --init-config.'))).toContain('Run `mdview --help` for usage.');
  });

  it('keeps non-usage errors concise', () => {
    expect(formatCliError(new Error('Failed to open file'))).toBe('Error: Failed to open file');
  });
});
