import { createReadStream, existsSync } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import type { LoadResult, ResolvedSource } from './types.js';
import { sanitizeMarkdownText } from './utils.js';

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

export async function sourceExists(source: ResolvedSource): Promise<boolean> {
  if (source.kind !== 'file') {
    return true;
  }
  return existsSync(source.input);
}

async function readFromFile(filePath: string, maxInputBytes: number): Promise<LoadResult> {
  const fileStats = await stat(filePath);
  if (fileStats.size > maxInputBytes) {
    const handle = createReadStream(filePath, { encoding: 'utf8', highWaterMark: Math.min(maxInputBytes, 64 * 1024) });
    return readFromStream(handle, path.basename(filePath), maxInputBytes, `Input truncated to ${maxInputBytes} bytes`);
  }

  const text = sanitizeMarkdownText(await readFile(filePath, 'utf8'));
  return {
    text,
    displayName: path.basename(filePath),
    bytesRead: Buffer.byteLength(text, 'utf8'),
  };
}

async function readFromStream(
  stream: NodeJS.ReadableStream | Readable,
  displayName: string,
  maxInputBytes: number,
  warning?: string,
): Promise<LoadResult> {
  const chunks: string[] = [];
  let bytesRead = 0;

  for await (const chunk of stream) {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    bytesRead += Buffer.byteLength(text, 'utf8');
    chunks.push(text);
    if (bytesRead > maxInputBytes) {
      break;
    }
  }

  const raw = chunks.join('');
  return {
    text: sanitizeMarkdownText(raw.slice(0, maxInputBytes)),
    displayName,
    warning: warning ?? (bytesRead > maxInputBytes ? `Input truncated to ${maxInputBytes} bytes` : undefined),
    bytesRead: Math.min(bytesRead, maxInputBytes),
  };
}

async function readFromUrl(url: string, timeoutMs: number, maxInputBytes: number): Promise<LoadResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'mdview/0.1.0',
        accept: 'text/markdown,text/plain,text/*;q=0.9,*/*;q=0.1',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      const text = sanitizeMarkdownText(await response.text());
      return {
        text: text.slice(0, maxInputBytes),
        displayName: url,
        bytesRead: Buffer.byteLength(text, 'utf8'),
      };
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      total += value.byteLength;
      chunks.push(value);
      if (total > maxInputBytes) {
        break;
      }
    }

    const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)).slice(0));
    const text = sanitizeMarkdownText(buffer.toString('utf8').slice(0, maxInputBytes));
    return {
      text,
      displayName: url,
      warning: total > maxInputBytes ? `Input truncated to ${maxInputBytes} bytes` : undefined,
      bytesRead: Math.min(total, maxInputBytes),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected source kind: ${String(value)}`);
}
