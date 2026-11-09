import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MAX_MARKDOWN_DEPTH, validateMarkdownDepth } from '../src/markdown-depth.js';
import { renderMarkdownDocument } from '../src/markdown.js';
import { resolveTheme } from '../src/theme.js';

vi.mock('unified', async (importOriginal) => {
  const actual = await importOriginal<typeof import('unified')>();
  return {
    ...actual,
    unified: () => {
      const processor = actual.unified();
      const parse = processor.parse.bind(processor);
      processor.parse = ((...args: Parameters<typeof parse>) => {
        if (args[0] === 'MOCK_PARSER_STACK') throw new RangeError('Maximum call stack size exceeded');
        if (args[0] === 'MOCK_PARSER_OTHER') throw new Error('Unexpected parser failure');
        if (args[0] === 'MOCK_PARSER_RANGE') throw new RangeError('Invalid array length');
        return parse(...args);
      }) as typeof processor.parse;
      return processor;
    },
  };
});

const renderDocument = (text: string) => renderMarkdownDocument(text, {
  width: 80, wrap: true, padding: 0, theme: resolveTheme('github'),
  syntaxTheme: resolveTheme('dracula'), sourceName: 'depth.md',
});
const depthMessage = `Markdown nesting exceeds the supported depth limit (${MAX_MARKDOWN_DEPTH}).`;

describe('Markdown AST depth budget', () => {
  it('accepts root-relative depth 128 and rejects 129, including paragraph and text edges', () => {
    expect(() => renderDocument('> '.repeat(126) + 'x')).not.toThrow();
    expect(() => renderDocument('> '.repeat(127) + 'x')).toThrow(depthMessage);
  });

  it.each([
    ['nested lists', Array.from({ length: 64 }, (_, index) => '  '.repeat(index) + '- x').join('\n')],
    ['mixed quote/list children', '> '.repeat(124) + '- **x**'],
    ['inline strong/emphasis', '*'.repeat(254) + 'x' + '*'.repeat(254)],
    ['inline-heavy H1 before title inference', '# ' + '*'.repeat(254) + 'x' + '*'.repeat(254)],
    ['table-cell inline children', '| a |\n|---|\n| ' + '*'.repeat(250) + 'x' + '*'.repeat(250) + ' |'],
  ])('guards %s', (_label, markdown) => {
    expect(() => renderDocument(markdown)).toThrow(depthMessage);
  });

  it('validates all child-bearing node types iteratively, including unknown future nodes', () => {
    const types = ['root', 'blockquote', 'list', 'listItem', 'heading', 'table', 'tableRow', 'tableCell', 'link', 'emphasis', 'strong', 'delete', 'futureNode'];
    type Node = { type: string; children?: Node[] };
    let root: Node = { type: 'text' };
    for (let index = 0; index < 128; index += 1) root = { type: types[index % types.length], children: [root] };
    expect(() => validateMarkdownDepth(root)).not.toThrow();
    expect(() => validateMarkdownDepth({ children: [root] })).toThrow(depthMessage);
    for (let index = 0; index < 20_000; index += 1) root = { type: 'futureNode', children: [root] };
    expect(() => validateMarkdownDepth(root)).toThrow(depthMessage);
  });

  it('accepts markers inside code, escaped markers, and shallow inline content', () => {
    for (const markdown of [
      '```text\n' + '> '.repeat(2000) + '\n' + '*'.repeat(400) + '\n```',
      '\\> '.repeat(2000) + '\\*'.repeat(400),
      '# A [linked *title*](https://example.com)\n\n- **item**\n\n| a | b |\n|---|---|\n| *c* | d |',
    ]) expect(() => renderDocument(markdown)).not.toThrow();
  });

  it('translates parser stack overflow while preserving unrelated parser failures', () => {
    expect(() => renderDocument('MOCK_PARSER_STACK')).toThrow(depthMessage);
    expect(() => renderDocument('MOCK_PARSER_OTHER')).toThrow('Unexpected parser failure');
    expect(() => renderDocument('MOCK_PARSER_RANGE')).toThrow('Invalid array length');
  });

  it.each([
    ['original quote reproducer', '> '.repeat(2000) + 'x'],
    ['deep inline reproducer', '*'.repeat(400) + 'x' + '*'.repeat(400)],
  ])('rejects %s in a bounded plain CLI process without partial output or stack trace', async (_label, input) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-depth-cli-'));
    try {
      const child = spawnSync(process.execPath, [
        '--max-old-space-size=96', '--import', 'tsx', 'src/main.ts',
        '--config', path.join(directory, 'missing.yml'),
      ], {
        cwd: path.resolve(import.meta.dirname, '..'), input, encoding: 'utf8',
        env: { ...process.env, NODE_NO_WARNINGS: '1' }, timeout: 5000, maxBuffer: 4096,
      });
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(1);
      expect(child.stdout).toBe('');
      expect(child.stderr).toBe(`Error: ${depthMessage}\n`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 7000);
});
