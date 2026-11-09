import { constants } from 'node:fs'
import { open } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import path from 'node:path';
import type { LoadResult, ResolvedSource } from './types.js';
import { readBoundedBytes } from './bounded-reader.js';
import { VERSION } from './version.js';

export function resolveSource(input: string | undefined): ResolvedSource {
  if (!input || input === '-') {
    return {
      kind: 'stdin',
      input: input ?? '-',
      displayName: 'stdin',
      canWatch: false,
    };
  }

  if (/^https?:\/\//i.test(input)) {
    return {
      kind: 'url',
      input,
      displayName: input,
      canWatch: false,
    };
  }

  return {
    kind: 'file',
    input: path.resolve(input),
    displayName: path.basename(input),
    canWatch: true,
  };
}

export async function loadSource(source: ResolvedSource, options: { timeoutMs: number; maxInputBytes: number }): Promise<LoadResult> {
  switch (source.kind) {
    case 'stdin':
      return readFromStream(process.stdin, source.displayName, options.maxInputBytes);
    case 'file':
      return readFromFile(source.input, options.maxInputBytes);
    case 'url':
      return readFromUrl(source.input, options.timeoutMs, options.maxInputBytes);
    default:
      return assertNever(source.kind);
  }
}

async function readFromFile(filePath: string, maxInputBytes: number): Promise<LoadResult> {
  // Nonblocking open prevents a FIFO from hanging before its type can be checked.
  // Checking the opened descriptor also avoids a path-stat/open replacement race.
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
  return withCleanup(async () => {
    if (!(await handle.stat()).isFile()) {
      throw new Error(`Unsupported file type: ${filePath} (expected a regular file)`);
    }
    return await readBoundedBytes(async (maxBytes) => {
      const buffer = Buffer.allocUnsafe(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, null);
      return bytesRead ? buffer.subarray(0, bytesRead) : undefined;
    }, path.basename(filePath), maxInputBytes);
  }, () => handle.close());
}

async function readFromStream(
  stream: NodeJS.ReadableStream | Readable,
  displayName: string,
  maxInputBytes: number,
): Promise<LoadResult> {
  const iterator = stream[Symbol.asyncIterator]();
  return withCleanup(async () => {
    return await readBoundedBytes(async () => {
      const { done, value } = await iterator.next();
      if (done) return undefined;
      return typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
    }, displayName, maxInputBytes);
  }, async () => {
    // Node's iterator return destroys a stream on early completion and cleans up
    // its listeners on EOF/error. There is only one cleanup owner per adapter.
    await iterator.return?.();
  });
}

async function readFromUrl(url: string, timeoutMs: number, maxInputBytes: number): Promise<LoadResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`URL request timed out after ${timeoutMs} ms`)), timeoutMs);
  let body: ReadableStream<Uint8Array> | null | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let consumed = false;

  try {
    const response = await withAbort(fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': `mdview/${VERSION}`,
        accept: 'text/markdown,text/plain,text/*;q=0.9,*/*;q=0.1',
      },
    }), controller.signal);
    body = response.body;
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    if (!body) {
      consumed = true;
      return await readBoundedBytes(async () => undefined, url, maxInputBytes);
    }
    reader = body.getReader();
    return await readBoundedBytes(async () => {
      const { done, value } = await withAbort(reader!.read(), controller.signal);
      if (done) {
        consumed = true;
        return undefined;
      }
      return value;
    }, url, maxInputBytes);
  } finally {
    if (!consumed) {
      // Cancellation may throw, reject, or never settle. Observe rejection but
      // never await it: abort is the network backstop and must start promptly.
      try {
        const cancellation = reader ? reader.cancel() : body?.cancel();
        void cancellation?.catch(() => {});
      } catch {
        // Cleanup must preserve the primary read/HTTP error or truncated result.
      }
      controller.abort();
    }
    try {
      reader?.releaseLock();
    } catch {
      // A faulty reader's cleanup must not replace the primary outcome either.
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Also bounds custom readers whose pending read does not honor fetch's signal. */
async function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason);
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

/** Report close failures on success, while preserving the original read error. */
async function withCleanup<T>(operation: () => Promise<T>, cleanup: () => Promise<unknown>): Promise<T> {
  let failed = false;
  try {
    return await operation();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      await cleanup();
    } catch (error) {
      if (!failed) throw error;
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected source kind: ${String(value)}`);
}
