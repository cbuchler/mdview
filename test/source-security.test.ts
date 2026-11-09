import { execFile as execFileCallback } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readBoundedBytes } from '../src/bounded-reader.js';
import { loadSource, resolveSource } from '../src/source.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});

const execFile = promisify(execFileCallback);
const sourceUrl = new URL('../src/source.ts', import.meta.url).href;
const options = { maxInputBytes: 4, timeoutMs: 1000 };
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryFile(bytes: Uint8Array): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mdview-source-'));
  dirs.push(dir);
  const filename = path.join(dir, 'input.md');
  await writeFile(filename, bytes);
  return filename;
}

async function throughAdapter(adapter: string, chunks: Uint8Array[], cap = 4) {
  if (adapter === 'file') {
    const filename = await temporaryFile(Buffer.concat(chunks));
    return loadSource(resolveSource(filename), { ...options, maxInputBytes: cap });
  }
  if (adapter === 'stdin') {
    const stream = Readable.from(chunks, { objectMode: false });
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(stream as typeof process.stdin);
    return loadSource(resolveSource('-'), { ...options, maxInputBytes: cap });
  }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  }))));
  return loadSource(resolveSource('https://example.test/input'), { ...options, maxInputBytes: cap });
}

// Exercise decoding once; adapters below only check their byte-stream wiring.
describe('shared byte decoder (#16)', () => {
  const decode = (chunks: Uint8Array[], cap = 4) => {
    const pending = [...chunks];
    return readBoundedBytes(async () => pending.shift(), 'fixture', cap);
  };

  it.each([
    ['empty', [], '', 0, false],
    ['below cap', ['abc'], 'abc', 3, false],
    ['exact cap', ['abcd'], 'abcd', 4, false],
    ['cap plus one', ['abcde'], 'abcd', 4, true],
    ['oversized chunk', ['x'.repeat(256 * 1024)], 'xxxx', 4, true],
    ['several chunks', ['a', 'bc', 'd', 'e'], 'abcd', 4, true],
    ['exact cap split', ['a', 'bc', 'd'], 'abcd', 4, false],
    ['controls', ['a\u0000\u001bb'], 'ab', 4, false],
  ] as const)('%s', async (_name, chunks, text, bytesRead, truncated) => {
    const result = await decode(chunks.map((chunk) => Buffer.from(chunk)));
    expect(result.text).toBe(text);
    expect(result.bytesRead).toBe(bytesRead);
    expect(Boolean(result.warning)).toBe(truncated);
    expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(4);
  });

  it.each(['界', '😀'])('keeps only complete %s characters at every cap', async (point) => {
    const bytes = Buffer.from(point + point);
    for (let cap = 0; cap <= bytes.length; cap++) {
      const result = await decode([bytes], cap);
      expect(result.text).toBe(point.repeat(Math.floor(cap / Buffer.byteLength(point))));
      expect(result.bytesRead).toBe(cap);
      expect(Boolean(result.warning)).toBe(cap < bytes.length);
      expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(cap);
    }
  });

  it('decodes multibyte text split at every byte boundary', async () => {
    const bytes = Buffer.from('界😀é');
    for (let boundary = 1; boundary < bytes.length; boundary++) {
      const result = await decode([bytes.subarray(0, boundary), bytes.subarray(boundary)], bytes.length);
      expect(result.text).toBe('界😀é');
      expect(result.bytesRead).toBe(bytes.length);
      expect(result.warning).toBeUndefined();
    }
  });

  it('bounds malformed UTF-8 replacement expansion and drops incomplete tails', async () => {
    const result = await decode([Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff])]);
    expect(result.text).toBe('�');
    expect(result.bytesRead).toBe(4);
    expect(result.warning).toBeDefined();
    expect((await decode([Buffer.from([0x61, 0xf0, 0x9f])])).text).toBe('a');
  });
});

describe.each(['file', 'stdin', 'url'])('%s byte-budget integration', (adapter) => {
  it.each([
    ['exact cap', '界a', false],
    ['overflow', '界ab', true],
  ] as const)('preserves UTF-8 and reports %s correctly', async (_name, input, truncated) => {
    const bytes = Buffer.from(input);
    const result = await throughAdapter(adapter, [bytes.subarray(0, 1), bytes.subarray(1)]);
    expect(result.text).toBe('界a');
    expect(result.bytesRead).toBe(4);
    expect(Boolean(result.warning)).toBe(truncated);
  });
});

it('requests at most remaining bytes plus lookahead and caps collector output', async () => {
  const bytes = Buffer.from('abcde');
  let offset = 0;
  const result = await readBoundedBytes(async (max) => {
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThanOrEqual(4 - Math.min(offset, 4) + 1);
    const chunk = bytes.subarray(offset, offset + Math.min(max, 2));
    offset += chunk.length;
    return chunk.length ? chunk : undefined;
  }, 'fixture', 4);
  expect(result).toMatchObject({ text: 'abcd', bytesRead: 4, warning: 'Input truncated to 4 bytes' });
});

it.runIf(process.platform === 'linux')('bounds a real stat-zero /proc regular file', async () => {
  const result = await loadSource(resolveSource('/proc/version'), options);
  expect(result.bytesRead).toBe(4);
  expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(4);
  expect(result.warning).toBeDefined();
});

it('bounds a file grown after descriptor metadata, and closes the descriptor', async () => {
  const filename = await temporaryFile(Buffer.from('a'));
  const actualHandle = await open(filename, constants.O_RDONLY | constants.O_NONBLOCK);
  const close = vi.spyOn(actualHandle, 'close');
  const originalStat = actualHandle.stat.bind(actualHandle);
  vi.spyOn(actualHandle, 'stat').mockImplementationOnce(async () => {
    const stats = await originalStat();
    await writeFile(filename, 'abcdefghijk');
    return stats;
  });
  vi.mocked(open).mockResolvedValueOnce(actualHandle);
  const result = await loadSource(resolveSource(filename), options);
  expect(result).toMatchObject({ text: 'abcd', bytesRead: 4, warning: 'Input truncated to 4 bytes' });
  expect(close).toHaveBeenCalledOnce();
});

it.each(['stat', 'read'] as const)('closes a descriptor after %s failure', async (method) => {
  const filename = await temporaryFile(Buffer.from('abc'));
  const actualHandle = await open(filename, constants.O_RDONLY | constants.O_NONBLOCK);
  const close = vi.spyOn(actualHandle, 'close');
  vi.spyOn(actualHandle, method).mockRejectedValueOnce(new Error(`${method} failed`));
  vi.mocked(open).mockResolvedValueOnce(actualHandle);
  await expect(loadSource(resolveSource(filename), options)).rejects.toThrow(`${method} failed`);
  expect(close).toHaveBeenCalledOnce();
});

it.each([false, true])('handles a rejected file close with prior read failure=%s', async (readFails) => {
  const filename = await temporaryFile(Buffer.from('abc'));
  const actualHandle = await open(filename, constants.O_RDONLY | constants.O_NONBLOCK);
  const actualClose = actualHandle.close.bind(actualHandle);
  const close = vi.spyOn(actualHandle, 'close').mockImplementationOnce(async () => {
    await actualClose();
    throw new Error('close failed');
  });
  if (readFails) vi.spyOn(actualHandle, 'read').mockRejectedValueOnce(new Error('read failed'));
  vi.mocked(open).mockResolvedValueOnce(actualHandle);
  await expect(loadSource(resolveSource(filename), options)).rejects.toThrow(readFails ? 'read failed' : 'close failed');
  expect(close).toHaveBeenCalledOnce();
});

it('propagates stdin failure and destroys the owned iterator', async () => {
  const stream = new Readable({ read() { this.destroy(new Error('stdin failed')); } });
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(stream as typeof process.stdin);
  await expect(loadSource(resolveSource('-'), options)).rejects.toThrow('stdin failed');
  expect(stream.destroyed).toBe(true);
});

it('cleans up stdin after overflow and EOF', async () => {
  for (const text of ['abc', 'abcde']) {
    const stream = Readable.from([Buffer.from(text)], { objectMode: false });
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(stream as typeof process.stdin);
    await loadSource(resolveSource('-'), options);
    expect(stream.destroyed).toBe(true);
  }
});

it.each([false, true])('handles rejected stdin iterator cleanup with prior read failure=%s', async (readFails) => {
  const stream = Readable.from([]);
  const cleanup = vi.fn(async () => { throw new Error('iterator cleanup failed'); });
  const iterator = {
    next: async () => {
      if (readFails) throw new Error('iterator read failed');
      return { done: true as const, value: undefined };
    },
    return: cleanup,
    [Symbol.asyncIterator]() { return this; },
    async [Symbol.asyncDispose]() { await cleanup(); },
  };
  vi.spyOn(stream, Symbol.asyncIterator).mockReturnValue(iterator);
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(stream as typeof process.stdin);
  await expect(loadSource(resolveSource('-'), options)).rejects.toThrow(readFails ? 'iterator read failed' : 'iterator cleanup failed');
  expect(cleanup).toHaveBeenCalledOnce();
});

it.runIf(process.platform === 'linux')('rejects directory, FIFO and device inputs without blocking or leaking descriptors', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mdview-special-'));
  dirs.push(dir);
  const fifo = path.join(dir, 'pipe');
  await execFile('mkfifo', [fifo], { timeout: 2000 });
  const script = `
    import { readdir } from 'node:fs/promises';
    import { loadSource, resolveSource } from ${JSON.stringify(sourceUrl)};
    const before = (await readdir('/proc/self/fd')).length;
    for (const filename of ${JSON.stringify([dir, fifo, '/dev/null'])}) {
      for (let i = 0; i < 4; i++) {
        try { await loadSource(resolveSource(filename), ${JSON.stringify(options)}); throw new Error('unexpected success'); }
        catch (error) { if (!error.message.includes('Unsupported file type')) throw error; }
      }
    }
    const after = (await readdir('/proc/self/fd')).length;
    if (after > before) throw new Error('descriptor leak: ' + before + ' -> ' + after);
    console.log('special files rejected; descriptors closed');
  `;
  const result = await execFile(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { timeout: 5000, maxBuffer: 8192 });
  expect(result.stdout).toContain('special files rejected; descriptors closed');
});

// Unread HTTP work must stop even when cancellation itself fails.
describe('URL cleanup (#20)', () => {
  function install(body: ReadableStream<Uint8Array> | null, status = 200) {
    let signal: AbortSignal;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      signal = init.signal;
      return { ok: status < 400, status, statusText: status === 200 ? 'OK' : 'Failure', body };
    }));
    return () => signal!;
  }

  it('cancels overflow, releases its lock and aborts unfinished fetch work', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(Buffer.from('abcde')); }, cancel });
    const signal = install(body);
    expect((await loadSource(resolveSource('https://example.test'), options)).text).toBe('abcd');
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(signal().aborted).toBe(true);
  });

  it('releases normal EOF without abort or cancellation', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(Buffer.from('abcd')); c.close(); }, cancel });
    const signal = install(body);
    expect((await loadSource(resolveSource('https://example.test'), options)).warning).toBeUndefined();
    expect(cancel).not.toHaveBeenCalled();
    expect(body.locked).toBe(false);
    expect(signal().aborted).toBe(false);
  });

  it.each(['reject', 'never'] as const)('does not await a cancellation that will %s', async (kind) => {
    const cancel = vi.fn(() => kind === 'reject' ? Promise.reject(new Error('cleanup failed')) : new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(Buffer.from('abcde')); }, cancel });
    const signal = install(body);
    const result = await loadSource(resolveSource('https://example.test'), options);
    expect(result.text).toBe('abcd');
    expect(signal().aborted).toBe(true);
    expect(body.locked).toBe(false);
  });

  it('cancels an HTTP error body without acquiring a reader or hiding the HTTP error', async () => {
    const cancel = vi.fn(() => Promise.reject(new Error('cleanup failed')));
    const body = new ReadableStream<Uint8Array>({ cancel });
    const signal = install(body, 503);
    await expect(loadSource(resolveSource('https://example.test'), options)).rejects.toThrow('HTTP 503 Failure');
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(signal().aborted).toBe(true);
  });

  it('preserves a body read error and releases the reader lock', async () => {
    const body = new ReadableStream<Uint8Array>({ pull(c) { c.error(new Error('body failed')); } });
    const signal = install(body);
    await expect(loadSource(resolveSource('https://example.test'), options)).rejects.toThrow('body failed');
    expect(body.locked).toBe(false);
    expect(signal().aborted).toBe(true);
  });

  it('preserves fetch rejection and clears the timer', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch failed'); }));
      await expect(loadSource(resolveSource('https://example.test'), options)).rejects.toThrow('fetch failed');
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('treats an absent body as empty without calling text()', async () => {
    const signal = install(null);
    expect(await loadSource(resolveSource('https://example.test'), options)).toMatchObject({ text: '', bytesRead: 0 });
    expect(signal().aborted).toBe(false);
  });

  it('waits for EOF at the exact cap, then times out and cancels a stalled body', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(Buffer.from('abcd')); }, cancel });
    const signal = install(body);
    await expect(loadSource(resolveSource('https://example.test'), { ...options, timeoutMs: 20 })).rejects.toThrow('timed out');
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(signal().aborted).toBe(true);
  });

  it('preserves timeout despite never-settling cancellation', async () => {
    const body = new ReadableStream<Uint8Array>({ cancel() { return new Promise<void>(() => {}); } });
    const signal = install(body);
    await expect(loadSource(resolveSource('https://example.test'), { ...options, timeoutMs: 20 })).rejects.toThrow('timed out');
    expect(signal().aborted).toBe(true);
    expect(body.locked).toBe(false);
  });

  it('preserves read failure when nonstandard reader cleanup throws synchronously', async () => {
    const reader = {
      read: vi.fn(async () => { throw new Error('primary read failure'); }),
      cancel: vi.fn(() => { throw new Error('cancel failed'); }),
      releaseLock: vi.fn(() => { throw new Error('release failed'); }),
    };
    let signal: AbortSignal;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      signal = init.signal;
      return { ok: true, body: { getReader: () => reader } };
    }));
    await expect(loadSource(resolveSource('https://example.test'), options)).rejects.toThrow('primary read failure');
    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
    expect(signal!.aborted).toBe(true);
  });
});

it('closes real never-ending HTTP responses and exits within a hard process bound (#20)', async () => {
  const script = `
    import assert from 'node:assert/strict';
    import http from 'node:http';
    import { once } from 'node:events';
    import { loadSource, resolveSource } from ${JSON.stringify(sourceUrl)};
    const sockets = new Set();
    const closures = new Map();
    const server = http.createServer((req, res) => {
      const closed = once(res, 'close');
      closures.set(req.url, closed);
      if (req.url === '/http-error') res.writeHead(503);
      res.write(req.url === '/exact' ? 'abcd' : 'x'.repeat(100));
    });
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    let guard;
    const deadline = new Promise((_, reject) => {
      guard = setTimeout(() => reject(new Error('response/socket closure deadline exceeded')), 3500);
    });
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const base = 'http://127.0.0.1:' + server.address().port;
      const work = async () => {
        const overflow = await loadSource(resolveSource(base + '/overflow'), { maxInputBytes: 4, timeoutMs: 1000 });
        assert.equal(overflow.text, 'xxxx');
        assert.equal(overflow.bytesRead, 4);
        assert.ok(overflow.warning);
        await closures.get('/overflow');
        await assert.rejects(loadSource(resolveSource(base + '/exact'), { maxInputBytes: 4, timeoutMs: 100 }), /timed out/);
        await closures.get('/exact');
        await assert.rejects(loadSource(resolveSource(base + '/http-error'), { maxInputBytes: 4, timeoutMs: 1000 }), /HTTP 503/);
        await closures.get('/http-error');
      };
      await Promise.race([work(), deadline]);
      console.log('overflow, exact-cap timeout, HTTP error: response/socket closure observed');
    } finally {
      clearTimeout(guard);
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    }
  `;
  const result = await execFile(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { timeout: 6000, maxBuffer: 8192 });
  expect(result.stdout).toContain('response/socket closure observed');
}, 8000);
