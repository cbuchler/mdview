import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';
import { render } from 'ink';
import { expect, it, vi } from 'vitest';
import { App } from '../src/app.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { RenderSupervisor } from '../src/render-supervisor.js'
import * as sources from '../src/source.js';

const deepMarkdown = '# Rejected title\n\n' + '> '.repeat(2000) + 'Rejected body';

async function mount(markdownText: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mdview-depth-app-'));
  const file = path.join(directory, 'sample.md');
  await writeFile(file, markdownText);
  let frame = '';
  const stdout = Object.assign(new Writable({
    write(chunk, _encoding, callback) {
      const text = stripVTControlCharacters(chunk.toString());
      // Inspect only the newest complete Ink frame, never accumulated output.
      if (text.includes('q quit')) frame = text;
      callback();
    },
  }), { columns: 100, rows: 12, isTTY: true });
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const app = render(<App source={sources.resolveSource(file)} config={{ ...DEFAULT_CONFIG, padding: 0, refreshIntervalMs: 20 }} />, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true, patchConsole: false, exitOnCtrlC: false,
  });
  return {
    frame: () => frame,
    save: (text: string) => writeFile(file, text),
    resize: (width: number) => { stdout.columns = width; stdout.emit('resize'); },
    quit: async () => {
      let exited = false;
      void app.waitUntilExit().then(() => { exited = true; });
      stdin.write('q');
      await vi.waitFor(() => expect(exited).toBe(true));
    },
    cleanup: async () => {
      app.unmount();
      app.cleanup();
      stdin.destroy();
      stdout.destroy();
      await rm(directory, { recursive: true, force: true });
      vi.restoreAllMocks();
    },
  };
}

it('keeps invalid initial content mounted, recovers on a valid save, and quits', async () => {
  const app = await mount(deepMarkdown);
  try {
    await vi.waitFor(() => expect(app.frame()).toContain('Markdown nesting exceeds'), { timeout: 3000 });
    expect(app.frame()).not.toContain('Rejected title');
    expect(app.frame()).not.toContain('Rejected body');
    expect(app.frame()).toContain('q quit');
    app.resize(60);
    await vi.waitFor(() => expect(app.frame().split('\n')[0].length).toBeLessThanOrEqual(60));
    expect(app.frame()).toContain('Markdown nesting exceeds');
    await app.save('# Recovered\n\nRecovered content');
    await vi.waitFor(() => expect(app.frame()).toContain('# Recovered'), { timeout: 3000 });
    expect(app.frame()).toContain('Recovered content');
    expect(app.frame()).not.toContain('Markdown nesting exceeds');
    await app.quit();
  } finally {
    await app.cleanup();
  }
}, 10000);

it('quits while an initial rendering error is still displayed', async () => {
  vi.spyOn(RenderSupervisor.prototype, 'render').mockRejectedValue(new Error('Initial render failure'))
  const app = await mount('# Cannot render');
  try {
    await vi.waitFor(() => expect(app.frame()).toContain('Initial render failure'));
    expect(app.frame()).not.toContain('# Cannot render');
    await app.quit();
  } finally {
    await app.cleanup();
  }
});

it('retains validated title/content after a hostile save, reflows that content on resize, and recovers', async () => {
  const app = await mount('# Original\n\n' + 'Safe content '.repeat(12));
  try {
    await vi.waitFor(() => expect(app.frame()).toContain('# Original'), { timeout: 3000 });
    await app.save(deepMarkdown);
    await vi.waitFor(() => expect(app.frame()).toContain('Markdown nesting exceeds'), { timeout: 3000 });
    expect(app.frame()).toContain('# Original');
    expect(app.frame()).toContain('Safe content');
    expect(app.frame()).not.toContain('Rejected');
    app.resize(40);
    await vi.waitFor(() => expect(app.frame().split('\n')[0].length).toBeLessThanOrEqual(40));
    await vi.waitFor(() => expect(app.frame().split('\n').filter((line) => line.includes('Safe content')).length, app.frame()).toBeGreaterThan(2), { timeout: 3000 })
    expect(app.frame()).toContain('Markdown nesting exceeds');
    expect(app.frame()).toContain('# Original');
    expect(app.frame()).toContain('Safe content');
    expect(app.frame().split('\n')).toHaveLength(12);
    await app.save('# Recovered\n\nFresh content');
    await vi.waitFor(() => expect(app.frame()).toContain('# Recovered'), { timeout: 3000 });
    expect(app.frame()).toContain('Fresh content');
    expect(app.frame()).not.toContain('Markdown nesting exceeds');
    expect(app.frame()).not.toContain('Original');
    await app.quit();
  } finally {
    await app.cleanup();
  }
}, 10000);

it('keeps last-good content when the supervisor rejects reloads and reflow, and sanitizes its errors', async () => {
  const renderDocument = RenderSupervisor.prototype.render
  const renderer = vi.spyOn(RenderSupervisor.prototype, 'render').mockImplementation(function (this: RenderSupervisor, text, options, maxInputBytes) {
    if (text.includes('RENDER_FAILURE') || options.width === 40) {
      return Promise.reject(new Error('Forced render failure\u001b[31m'))
    }
    return renderDocument.call(this, text, options, maxInputBytes)
  });
  const loader = vi.spyOn(sources, 'loadSource');
  const app = await mount('# LastGood\n\nKnown good body');
  try {
    await vi.waitFor(() => expect(app.frame()).toContain('# LastGood'), { timeout: 3000 });
    const initialLoads = loader.mock.calls.length;
    app.resize(40);
    await vi.waitFor(() => expect(app.frame()).toContain('Forced render failure'));
    expect(app.frame()).toContain('# LastGood');
    expect(app.frame()).toContain('Known good body');
    expect(app.frame()).not.toContain('[31m');
    expect(loader).toHaveBeenCalledTimes(initialLoads);
    await app.save('# Wrong title\n\nRENDER_FAILURE');
    await vi.waitFor(() => expect(loader.mock.calls.length).toBeGreaterThan(initialLoads), { timeout: 3000 });
    await vi.waitFor(() => expect(renderer.mock.calls.some(([text]) => text.includes('RENDER_FAILURE'))).toBe(true));
    expect(app.frame()).toContain('# LastGood');
    expect(app.frame()).toContain('Known good body');
    expect(app.frame()).not.toContain('Wrong title');
    app.resize(100);
    await vi.waitFor(() => expect(app.frame().split('\n')[0].length).toBeGreaterThan(40));
    expect(app.frame()).toContain('Forced render failure');
    await app.save('# Healthy\n\nWorking again');
    await vi.waitFor(() => expect(app.frame()).toContain('# Healthy'), { timeout: 3000 });
    expect(app.frame()).not.toContain('Forced render failure');
    await app.quit();
  } finally {
    await app.cleanup();
  }
}, 10000);

it('does not let an older source read replace a newer rendered save', async () => {
  const loadSource = sources.loadSource
  const app = await mount('# Original\n\nOriginal content')
  try {
    await vi.waitFor(() => expect(app.frame()).toContain('# Original'), { timeout: 3000 })
    let finishOld!: (result: Awaited<ReturnType<typeof loadSource>>) => void
    const loader = vi.spyOn(sources, 'loadSource').mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
    await app.save('# Older\n\nOld save')
    await vi.waitFor(() => expect(finishOld).toBeTypeOf('function'))
    loader.mockImplementation(loadSource)
    await app.save('# Latest\n\nLatest content')
    await vi.waitFor(() => expect(app.frame()).toContain('# Latest'), { timeout: 3000 })
    finishOld({ text: '# Stale\n\nForbidden old content', displayName: 'stale.md', bytesRead: 35 })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(app.frame()).toContain('# Latest')
    expect(app.frame()).not.toContain('Forbidden')
  } finally {
    await app.cleanup()
  }
}, 10000)
