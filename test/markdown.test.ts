import { describe, expect, it } from 'vitest';
import { renderMarkdownDocument } from '../src/markdown.js';
import { resolveTheme } from '../src/theme.js';

describe('renderMarkdownDocument', () => {
  it('renders headings, lists, code, and tables', () => {
    const result = renderMarkdownDocument(
      '# Title\n\n- item one\n- item two\n\n```js\nconst answer = 42\nconsole.log("hello")\n```\n\n| a | b |\n|---|---|\n| c | d |\n',
      {
        width: 80,
        theme: resolveTheme('tempus-rift'),
        wrap: true,
        padding: 1,
        syntaxTheme: resolveTheme('dracula'),
        sourceName: 'README.md',
      },
    );

    const text = result.lines.map((line) => line.map((segment) => segment.text).join('')).join('\n');
    expect(text).toContain('Title');
    expect(text).toContain('item one');
    expect(text).toContain('console.log');
    expect(text).toContain('a');

    const codeLine = result.lines.find((line) => line.some((segment) => segment.text.includes('const')));
    expect(codeLine?.some((segment) => segment.style?.bold)).toBe(true);
    expect(codeLine?.some((segment) => segment.style?.color === resolveTheme('dracula').accent)).toBe(true);
  });
});
