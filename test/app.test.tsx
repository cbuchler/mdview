import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';
import { render } from 'ink';
import { expect, it, vi } from 'vitest';
import { App } from '../src/app.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { resolveSource } from '../src/source.js';

it('reflows on resize without input and reloads saved and atomically replaced files', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-app-'));
  const file = path.join(directory, 'sample.md');
  const markdown = '# Original\n\n```js\nconst message = "a long code line that wraps when the viewport becomes narrow";\n```\n\n| Name | Description |\n|---|---|\n| Example | A lengthy table cell that must fit the available width |\n';
  await writeFile(file, markdown);
  let frame = '';
  const stdout = Object.assign(new Writable({
    write(chunk, _encoding, callback) {
      const text = stripVTControlCharacters(chunk.toString());
      if (text.includes('quit')) frame = text;
      callback();
    },
  }), { columns: 100, rows: 30, isTTY: true });
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const initialListeners = stdout.listenerCount('resize');
  const app = render(<App source={resolveSource(file)} config={{ ...DEFAULT_CONFIG, refreshIntervalMs: 30 }} />, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true, patchConsole: false, exitOnCtrlC: false,
  });
  const codeBorder = () => frame.split('\n').find((line) => line.includes('┌ js'))?.trim();
  try {
    await vi.waitFor(() => expect(codeBorder()?.length).toBe(98));
    stdout.columns = 40;
    stdout.rows = 24;
    stdout.emit('resize');
    await vi.waitFor(() => {
      expect(codeBorder()?.length).toBe(38)
      expect(frame).toContain('available width')
    });
    expect(frame.split('\n')).toHaveLength(24);
    expect(frame).toContain('Description');
    expect(frame).toContain('available width');

    stdout.columns = 100;
    stdout.rows = 30;
    stdout.emit('resize');
    await vi.waitFor(() => expect(codeBorder()?.length).toBe(98));
    expect(frame.split('\n')).toHaveLength(30);

    await writeFile(file, markdown.replace('Original', 'Saved'));
    await vi.waitFor(() => expect(frame).toContain('# Saved'), { timeout: 3000 });
    await writeFile(`${file}.tmp`, markdown.replace('Original', 'Replaced'));
    await rename(`${file}.tmp`, file);
    await vi.waitFor(() => expect(frame).toContain('# Replaced'), { timeout: 3000 });
  } finally {
    app.unmount();
    app.cleanup();
    stdin.destroy();
    stdout.destroy();
    await rm(directory, { recursive: true, force: true });
  }
  expect(stdout.listenerCount('resize')).toBe(initialListeners);
}, 10000);
