import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';
import React from 'react';
import { render } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/app.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { renderDocumentAsPlainText, renderMarkdownDocument } from '../src/markdown.js';
import { resolveSource } from '../src/source.js';
import { resolveTheme } from '../src/theme.js';
import { widthOf } from '../src/utils.js';
import type { RenderSegmentStyle } from '../src/types.js'

const theme = resolveTheme('tempus-rift');
const documentFor = (markdown: string, width: number, wrap = false) => renderMarkdownDocument(markdown, {
  width, wrap, padding: 0, theme, syntaxTheme: resolveTheme('dracula'), sourceName: 'test.md',
});

describe('no-wrap prose', () => {
  it('renders long prose once even in a one-column viewport', () => {
    const markdown = 'word '.repeat(5000);
    const document = documentFor(markdown, 1);
    expect(renderDocumentAsPlainText(document)).toBe(markdown.trimEnd());
    expect(document.lines).toHaveLength(1);
  });

  it('retains the styles and order of text crossing the viewport boundary', () => {
    const document = documentFor('normal **bold text** *italic text* [linked text](https://example.com) tail', 1);
    expect(document.lines).toHaveLength(1);
    expect(renderDocumentAsPlainText(document)).toBe('normal bold text italic text linked text tail')
    const styledText = (matches: (style: RenderSegmentStyle) => boolean) =>
      document.lines.flat().filter(({ style }) => style && matches(style)).map(({ text }) => text).join('')
    expect(styledText((style) => style.bold === true)).toBe('bold text')
    expect(styledText((style) => style.italic === true)).toBe('italic text')
    expect(styledText((style) => style.underline === true && style.color === theme.link)).toBe('linked text')
  });

  it('preserves explicit soft and hard line breaks, Unicode, and styles across lines', () => {
    const document = documentFor('**first\nsecond** and\n界 👩‍💻  \nlast\n', 1);
    expect(renderDocumentAsPlainText(document)).toBe('first\nsecond and\n界 👩‍💻\nlast');
    expect(document.lines.slice(0, 2).map((line) => line.filter(({ style }) => style?.bold).map(({ text }) => text).join('')))
      .toEqual(['first', 'second'])
    expect(document.lines).toHaveLength(4);
  });

  it('keeps paragraph spacing and ignores trailing source newlines as before', () => {
    expect(renderDocumentAsPlainText(documentFor('first\n\nsecond\n\n', 1))).toBe('first\n\nsecond');
    expect(renderDocumentAsPlainText(documentFor('', 1))).toBe('No markdown content found.');
  });

  it('continues reflowing wrapped prose, code fences, and tables', () => {
    expect(documentFor('word '.repeat(20), 20, true).lines.length).toBeGreaterThan(1);
    const blocks = '```js\nconst message = "long content that still wraps";\n```\n\n| Name | Description |\n|---|---|\n| 界 | a long cell that still wraps |';
    const wrapped = documentFor(blocks, 20, true);
    const unwrapped = documentFor(blocks, 20);
    expect(unwrapped.lines).toEqual(wrapped.lines);
    expect(unwrapped.lines.every((line) => widthOf(line.map((part) => part.text).join('')) <= 20)).toBe(true);
  });

  it('bounds redirected CLI output under a heap, time, and output budget', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-nowrap-cli-'));
    const markdown = 'word '.repeat(5000);
    try {
      const child = spawnSync(process.execPath, [
        '--max-old-space-size=96', '--import', 'tsx', 'src/main.ts',
        '--no-wrap', '--padding', '0', '--no-history', '--config', path.join(directory, 'missing.yml'),
      ], {
        cwd: path.resolve(import.meta.dirname, '..'), input: markdown, encoding: 'utf8',
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
        timeout: 5000, maxBuffer: 100_000,
      });
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(0);
      expect(child.stderr).toBe('');
      expect(child.stdout).toBe(`${markdown.trimEnd()}\n`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 7000);

  it('clips a narrow Ink frame while keeping the footer and layout visible', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-nowrap-app-'));
    const file = path.join(directory, 'sample.md');
    await writeFile(file, `${'word '.repeat(20)}HIDDEN-END`);
    let frame = '';
    const stdout = Object.assign(new Writable({
      write(chunk, _encoding, callback) {
        const text = stripVTControlCharacters(chunk.toString());
        if (text.includes('q quit')) frame = text;
        callback();
      },
    }), { columns: 20, rows: 8, isTTY: true });
    const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
    const app = render(React.createElement(App, {
      source: resolveSource(file), config: { ...DEFAULT_CONFIG, wrap: false, watch: false, padding: 0 },
    }), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      debug: true, patchConsole: false, exitOnCtrlC: false,
    });
    try {
      await vi.waitFor(() => expect(frame).toContain('word word'), { timeout: 3000 })
      const rows = frame.split('\n');
      expect(rows).toHaveLength(8);
      expect(rows.every((line) => widthOf(line) <= 20)).toBe(true);
      expect(rows[7]).toContain('q quit');
      expect(frame).not.toContain('╭')
      expect(frame).not.toContain('HIDDEN-END');
    } finally {
      app.unmount();
      app.cleanup();
      stdin.destroy();
      stdout.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
