import { describe, expect, it, vi } from 'vitest'
import { unified } from 'unified'
import { renderMarkdownDocument } from '../src/markdown.js';
import { resolveTheme } from '../src/theme.js';
import { widthOf } from '../src/utils.js';

describe('renderMarkdownDocument', () => {
  const renderLines = (markdown: string, width: number, padding = 1) => renderMarkdownDocument(markdown, {
    width, padding, wrap: true,
    theme: resolveTheme('tempus-rift'), syntaxTheme: resolveTheme('dracula'), sourceName: 'test.md',
  }).lines.map((line) => line.map((segment) => segment.text).join(''));

  it('reuses parsing for resize, reparses edits, and retains only the latest document', () => {
    const parse = vi.spyOn(Object.getPrototypeOf(unified()), 'parse')
    const first = '# Resize fixture\n\n' + 'Readable content '.repeat(20)
    const second = '# Edited fixture\n\nFresh content'
    try {
      const wide = renderLines(first, 100)
      const narrow = renderLines(first, 30)
      expect(narrow.length).toBeGreaterThan(wide.length)
      expect(parse).toHaveBeenCalledTimes(1)
      expect(renderLines(second, 30).join('\n')).toContain('Fresh content')
      expect(parse).toHaveBeenCalledTimes(2)
      renderLines(first, 100)
      expect(parse).toHaveBeenCalledTimes(3)
    } finally {
      parse.mockRestore()
    }
  })

  it.each([20, 24, 40, 80, 120])('fits table borders and padded cells into %i columns', (width) => {
    const lines = renderLines('| Name | Description | State |\n|---|---|---|\n| 界界 | A lengthy description with averylongwordthatmustwrap | Ready |', width);
    expect(lines.every((line) => widthOf(line) <= width - 2)).toBe(true);
    expect(lines.join('\n')).toContain('界界');
    expect(lines.join('').replace(/\s|[│]/g, '')).toContain('averylongwordthatmustwrap');
  });

  it('stacks cells with their headers when a grid cannot fit', () => {
    const lines = renderLines('| First | Second | Third | Fourth |\n|---|---|---|---|\n| one | two | three | four |', 20);
    expect(lines.join('\n')).toContain('First: one');
    expect(lines.join('\n')).toContain('Fourth: four');
    expect(lines.every((line) => widthOf(line) <= 18)).toBe(true);
  });

  it.each([20, 40, 80])('reflows nested code and long fence labels into %i columns', (width) => {
    const lines = renderLines('> ```averylonglanguagelabelthatexceedstheviewport\n> const message = "a long code line that needs wrapping in a narrow terminal";\n> ```', width);
    expect(lines.every((line) => widthOf(line) <= width - 2)).toBe(true);
    expect(lines.join('').replace(/[│ ]/g, '')).toContain('alongcodelinethatneedswrappinginanarrowterminal');
  });

  it('uses fewer code rows as the terminal widens', () => {
    const markdown = '```js\nconst message = "a long code line that needs wrapping in a narrow terminal";\n```';
    expect(renderLines(markdown, 30).length).toBeGreaterThan(renderLines(markdown, 100).length);
  });

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
